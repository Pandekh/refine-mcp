// @openai/codex-sdk is ESM-only — imported dynamically inside explore_repo / explore_session handlers

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ensureCloned, verifyRepo } from "@/lib/git/clone";
import {
  createSession,
  dropSession,
  getSession,
  listSessions,
  repoNamesForUrls,
  touchSession,
} from "@/lib/git/session";

const log = (...args: unknown[]) =>
  process.stderr.write(`[refine] ${args.map(String).join(" ")}\n`);

// ── Repo search helpers ───────────────────────────────────────────────────────

type RepoResult = {
  provider: string;
  name: string;
  path: string;
  url: string;
  description?: string;
};

async function searchGitLab(query: string, signal?: AbortSignal): Promise<RepoResult[]> {
  const base = process.env.GITLAB_URL;
  const token = process.env.GITLAB_TOKEN;

  if (!base || !token) {
    return [];
  }

  try {
    const res = await fetch(
      `${base}/api/v4/search?scope=projects&search=${encodeURIComponent(query)}&per_page=10`,
      { headers: { Authorization: `Bearer ${token}` }, signal }
    );

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as Array<{
      name: string;
      path_with_namespace: string;
      http_url_to_repo: string;
      description?: string;
    }>;

    return data.map((p) => ({
      provider: "gitlab",
      name: p.name,
      path: p.path_with_namespace,
      url: p.http_url_to_repo,
      description: p.description ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function searchGitHub(query: string, signal?: AbortSignal): Promise<RepoResult[]> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return [];
  }

  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
      {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
        signal,
      }
    );

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as {
      items: Array<{ name: string; full_name: string; clone_url: string; description?: string }>;
    };

    return (data.items ?? []).map((r) => ({
      provider: "github",
      name: r.name,
      path: r.full_name,
      url: r.clone_url,
      description: r.description ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function resolveQuery(
  query: string,
  signal?: AbortSignal
): Promise<{ query: string; results: RepoResult[] }> {
  // Direct URL — return as-is without searching
  if (query.startsWith("http") || query.startsWith("git@")) {
    const name =
      query
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") ?? query;

    return { query, results: [{ provider: "url", name, path: name, url: query }] };
  }

  const results = [...(await searchGitLab(query, signal)), ...(await searchGitHub(query, signal))];

  return { query, results };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerGitTools(server: McpServer): void {
  // ── search_repos ────────────────────────────────────────────────────────────
  server.registerTool(
    "search_repos",
    {
      description:
        "Search for repositories on GitLab/GitHub by service name or keyword. Accepts a single query or an array of queries — all searched in parallel.\n\n⚠️ ALWAYS call this before explore_repo or create_session. Never pass a guessed or invented URL — only use URLs returned by this tool.\n\nWorkflow:\n1. User mentions service names → call search_repos([name1, name2, ...])\n2. Show results, ask user which repos to use\n3. After confirmation → call create_session(urls) or explore_repo(url)\n\nAlso accepts direct URLs — validates and returns them as-is.",
      inputSchema: {
        queries: z
          .union([z.string(), z.array(z.string())])
          .describe(
            "Service name(s), keyword(s), or direct repo URL(s). String or array of strings."
          ),
      },
    },
    async ({ queries }, { signal }) => {
      const queryList = Array.isArray(queries) ? queries : [queries];

      log("search_repos", queryList.join(", "));

      const resolved = await Promise.all(queryList.map((q) => resolveQuery(q, signal)));

      signal?.throwIfAborted();

      // Single query — return flat array for backward compat
      if (resolved.length === 1) {
        const { query, results } = resolved[0];

        if (results.length === 0) {
          const missing: string[] = [];

          if (!process.env.GITLAB_URL || !process.env.GITLAB_TOKEN) {
            missing.push("GITLAB_TOKEN + GITLAB_URL");
          }

          if (!process.env.GITHUB_TOKEN) {
            missing.push("GITHUB_TOKEN");
          }

          return {
            content: [
              {
                type: "text",
                text: `No repositories found for "${query}".${missing.length ? ` Not configured: ${missing.join(", ")}.` : ""}`,
              },
            ],
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      // Multiple queries — return grouped by query
      const grouped: Record<string, RepoResult[]> = {};

      for (const { query, results } of resolved) {
        grouped[query] = results;
      }

      return { content: [{ type: "text", text: JSON.stringify(grouped, null, 2) }] };
    }
  );

  // ── create_session ──────────────────────────────────────────────────────────
  server.registerTool(
    "create_session",
    {
      description:
        "Create a multi-repo exploration session. Clones all repos in parallel into a shared workspace so a single Codex agent can navigate all of them at once.\n\n⚠️ Only use URLs from search_repos — never invented URLs.\n\nWorkflow:\n1. search_repos([name1, name2]) → get verified URLs\n2. Show results to user, confirm which repos\n3. create_session(urls) → get session_id\n4. explore_session(session_id, question)",
      inputSchema: {
        urls: z
          .array(z.string())
          .describe("Repository HTTPS URLs from search_repos. At least one required."),
      },
    },
    async ({ urls }, { signal }) => {
      log("create_session", urls.join(", "));
      signal?.throwIfAborted();

      const session = await createSession(urls);

      signal?.throwIfAborted();

      const names = repoNamesForUrls(urls);
      const repoList = names.map((n, i) => `  ${n}  (${urls[i]})`).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Session created: ${session.id}\n\nRepos:\n${repoList}\n\nUse explore_session("${session.id}", "your question") to start exploring.`,
          },
        ],
      };
    }
  );

  // ── explore_session ─────────────────────────────────────────────────────────
  server.registerTool(
    "explore_session",
    {
      description:
        "Explore all repos in a session with a single Codex agent. The agent navigates the session directory where all repos are available as subdirectories — it can search, compare, and reason across all of them simultaneously.\n\nRefreshes all repos (git pull) before starting.\n\nReturns Technical Context — use as `context` in enrich_ticket.\n\n⛔ Only use session_id from create_session or list_sessions.",
      inputSchema: {
        session_id: z.string().describe("Session ID from create_session or list_sessions"),
        question: z
          .string()
          .describe(
            "What to find. Be specific about which repos and what you're looking for. Example: 'In auth-service and payment-service, where is JWT validation implemented and what would need to change to add a new claim type?'"
          ),
      },
    },
    async ({ session_id, question }, { signal }) => {
      log("explore_session", session_id);
      log("explore_session question:", question);

      const session = getSession(session_id);

      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: `Session "${session_id}" not found. Use list_sessions to see active sessions or create_session to start a new one.`,
            },
          ],
          isError: true,
        };
      }

      touchSession(session_id);
      signal?.throwIfAborted();

      // Refresh all repos before exploring
      log("explore_session refreshing repos...");
      await Promise.all(session.repos.map((url) => ensureCloned(url)));

      signal?.throwIfAborted();

      const names = repoNamesForUrls(session.repos);
      const repoList = names.join(", ");
      const agentQuestion = `You are exploring a workspace that contains the following repositories: ${repoList}.\n\n${question}`;

      const { Codex } = await import("@openai/codex-sdk");
      const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY });
      const thread = codex.startThread({
        model: process.env.CODEX_MODEL ?? "gpt-5.1",
        modelReasoningEffort: (process.env.CODEX_REASONING_EFFORT ?? "low") as
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh",
        workingDirectory: session.path,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      });

      log("explore_session starting codex agent in", session.path);
      const turn = await thread.run(agentQuestion);

      log(`explore_session done, response length: ${turn.finalResponse?.length ?? 0}`);

      return {
        content: [
          {
            type: "text",
            text:
              turn.finalResponse?.trim() || "No relevant code found. Try a more specific question.",
          },
        ],
      };
    }
  );

  // ── list_sessions ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_sessions",
    {
      description: "List all active exploration sessions with their repos and last access time.",
      inputSchema: {},
    },
    async () => {
      log("list_sessions");

      const sessions = listSessions();

      if (sessions.length === 0) {
        return {
          content: [{ type: "text", text: "No active sessions. Use create_session to start one." }],
        };
      }

      const lines = sessions.map((s) => {
        const names = repoNamesForUrls(s.repos);
        const accessed = new Date(s.lastAccessedAt).toLocaleString();

        return `${s.id}  [${names.join(", ")}]  last accessed: ${accessed}`;
      });

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ── drop_session ────────────────────────────────────────────────────────────
  server.registerTool(
    "drop_session",
    {
      description:
        "Remove an exploration session and free its disk space. Does NOT delete cached repo clones — those are reused across sessions.",
      inputSchema: {
        session_id: z.string().describe("Session ID to remove"),
      },
    },
    async ({ session_id }) => {
      log("drop_session", session_id);

      const removed = dropSession(session_id);

      return {
        content: [
          {
            type: "text",
            text: removed ? `Session ${session_id} removed.` : `Session "${session_id}" not found.`,
          },
        ],
      };
    }
  );

  // ── explore_repo ────────────────────────────────────────────────────────────
  server.registerTool(
    "explore_repo",
    {
      description:
        "Clone a git repository and explore its codebase with an AI agent. Returns a structured Technical Context (relevant files, key functions, architecture notes, implementation hints). Use the output as the `context` parameter in enrich_ticket.\n\nFor exploring multiple repos at once, prefer create_session + explore_session.\n\n⛔ NEVER call this with a guessed or invented URL. Only use URLs from search_repos.\n\n⛔ DO NOT call this automatically. Required workflow:\n1. Call search_repos to get the correct repo URL\n2. Show results to user, ask which repo to explore\n3. Call explore_repo ONLY after user explicitly confirms (e.g. 'yes', 'explore it', 'go ahead')\n\nIf this tool returns an access error, call search_repos with a more specific query to find the right URL.\n\nAuth: automatically uses GITLAB_TOKEN / GITHUB_TOKEN env vars.",
      inputSchema: {
        url: z
          .string()
          .describe("Repository HTTPS URL — must come from search_repos, not invented"),
        question: z
          .string()
          .describe(
            "What to find. Be specific: 'Where is QES signature validation implemented and which files need to change to add a new signature type?' rather than just 'find QES'."
          ),
      },
    },
    async ({ url, question }, { signal }) => {
      log("explore_repo", url);
      log("explore_repo question:", question);
      signal?.throwIfAborted();

      log("explore_repo verifying access...");
      try {
        verifyRepo(url);
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }

      let repoPath: string;

      try {
        log("explore_repo cloning...");
        repoPath = await ensureCloned(url);
        log("explore_repo cloned to", repoPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        throw new Error(`Could not clone ${url}: ${msg}`, { cause: err });
      }

      signal?.throwIfAborted();

      // Codex CLI is ESM-only — dynamic import avoids CJS/ESM conflict at bundle time
      const { Codex } = await import("@openai/codex-sdk");
      const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY });
      const thread = codex.startThread({
        // CODEX_MODEL: model for the Codex CLI agent (gpt-5.2, gpt-5.1, gpt-4.1, etc.)
        model: process.env.CODEX_MODEL ?? "gpt-5.1",
        // CODEX_REASONING_EFFORT: "minimal"|"low"|"medium"|"high"|"xhigh" (default: "low")
        modelReasoningEffort: (process.env.CODEX_REASONING_EFFORT ?? "low") as
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh",
        workingDirectory: repoPath,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      });

      log("explore_repo starting codex agent...");
      // Don't pass signal — MCP's AbortSignal has a short timeout that kills
      // the Codex subprocess before it finishes. Codex manages its own lifecycle.
      const turn = await thread.run(question);

      log(`explore_repo done, response length: ${turn.finalResponse?.length ?? 0}`);

      return {
        content: [
          {
            type: "text",
            text:
              turn.finalResponse?.trim() || "No relevant code found. Try a more specific question.",
          },
        ],
      };
    }
  );
}
