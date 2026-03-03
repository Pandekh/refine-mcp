// @openai/codex-sdk is ESM-only — imported dynamically inside explore_repo handler

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ensureCloned, verifyRepo } from "@/lib/git/clone";

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

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerGitTools(server: McpServer): void {
  // ── search_repos ────────────────────────────────────────────────────────────
  server.registerTool(
    "search_repos",
    {
      description:
        "Search for repositories on GitLab/GitHub by service name or keyword. Returns verified repo URLs.\n\n⚠️ ALWAYS call this before explore_repo. Never pass a guessed or invented URL to explore_repo — only use URLs returned by this tool.\n\nWorkflow:\n1. User mentions a service name → call search_repos(service name)\n2. Show results to the user and ask which one to explore\n3. After user confirms → call explore_repo with the chosen URL\n\nAlso accepts a direct URL — validates and returns it as-is.",
      inputSchema: {
        query: z
          .string()
          .describe("Service name, keyword, or a full repo URL (https://... or git@...)"),
      },
    },
    async ({ query }, { signal }) => {
      log("search_repos", query);

      // Direct URL — return as-is without searching
      if (query.startsWith("http") || query.startsWith("git@")) {
        const name =
          query
            .split("/")
            .pop()
            ?.replace(/\.git$/, "") ?? query;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify([{ provider: "url", name, url: query }], null, 2),
            },
          ],
        };
      }

      const results = [
        ...(await searchGitLab(query, signal)),
        ...(await searchGitHub(query, signal)),
      ];

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
  );

  // ── explore_repo ────────────────────────────────────────────────────────────
  server.registerTool(
    "explore_repo",
    {
      description:
        "Clone a git repository and explore its codebase with an AI agent. Returns a structured Technical Context (relevant files, key functions, architecture notes, implementation hints). Use the output as the `context` parameter in enrich_ticket.\n\n⛔ NEVER call this with a guessed or invented URL. Only use URLs from search_repos.\n\n⛔ DO NOT call this automatically. Required workflow:\n1. Call search_repos to get the correct repo URL\n2. Show results to user, ask which repo to explore\n3. Call explore_repo ONLY after user explicitly confirms (e.g. 'yes', 'explore it', 'go ahead')\n\nIf this tool returns an access error, call search_repos with a more specific query to find the right URL.\n\nAuth: automatically uses GITLAB_TOKEN / GITHUB_TOKEN env vars.",
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
