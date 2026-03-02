import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getTicket,
  searchTickets,
  updateTicketFields,
  createTicket,
  listProjects,
  type JiraTicket,
} from "@/lib/jira/client";

const log = (...args: unknown[]) =>
  process.stderr.write(`[refine] ${args.map(String).join(" ")}\n`);

// ── Helpers ──────────────────────────────────────────────────────────────────

interface EnrichInput {
  key?: string;
  summary: string;
  description: string;
  issuetype?: string;
  priority?: string;
  labels?: string[];
  components?: string[];
}

function ticketToEnrichInput(
  ticket: JiraTicket,
  context: string
): EnrichInput & { context: string } {
  return {
    key: ticket.key,
    summary: ticket.summary,
    description: ticket.description ?? "",
    context,
    issuetype: ticket.issuetype.name,
    priority: ticket.priority?.name ?? undefined,
    labels: ticket.labels,
    components: ticket.components.map((c) => c.name),
  };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerJiraTools(server: McpServer): void {
  // ── get_ticket ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_ticket",
    {
      description:
        "Fetch a Jira ticket by key or URL. Returns all fields: summary, description, status, priority, type, sprint, epic, assignee, labels, components, story points, linked issues.\n\nAfter loading: present the ticket to the user and ask what they want to do (enrich description, explore code, create related ticket, etc.). If they mention services or repos, call search_repos and SUGGEST exploring — don't call explore_repo automatically.",
      inputSchema: {
        key: z.string().describe("Jira ticket key (e.g. PROJ-1234) or full Jira URL"),
      },
    },
    async ({ key }, { signal }) => {
      log("get_ticket", key);
      let ticketKey: string;

      if (key.includes("/browse/")) {
        ticketKey = key.split("/browse/")[1].split(/[?#]/)[0].trim();
      } else if (key.includes("selectedIssue=")) {
        ticketKey = new URL(key).searchParams.get("selectedIssue") ?? key;
      } else {
        ticketKey = key.trim();
      }

      const ticket = await getTicket(ticketKey);

      signal?.throwIfAborted();

      return { content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  // ── search_tickets ──────────────────────────────────────────────────────────
  server.registerTool(
    "search_tickets",
    {
      description:
        'Search Jira tickets using JQL (Jira Query Language).\n\nUse cases:\n- Check for duplicates before creating: `project = YOUR_PROJECT AND summary ~ "login" ORDER BY created DESC`\n- Find related resolved tickets for context: `project = YOUR_PROJECT AND status = Done AND component = "auth-service" ORDER BY updated DESC`\n- Find tickets in same epic: `"Epic Link" = PROJ-100`\n- Current sprint: `project = YOUR_PROJECT AND sprint in openSprints() ORDER BY priority DESC`',
      inputSchema: {
        jql: z.string().describe("JQL query string"),
        maxResults: z.number().optional().describe("Max results (default 10, max 50)"),
      },
    },
    async ({ jql, maxResults }, { signal }) => {
      log("search_tickets", jql);
      const tickets = await searchTickets(jql, Math.min(maxResults ?? 10, 50));

      signal?.throwIfAborted();

      return { content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }] };
    }
  );

  // ── list_projects ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_projects",
    {
      description:
        "List accessible Jira projects (key + name). Call when the user doesn't know or hasn't specified the project key for ticket creation.",
      inputSchema: {},
    },
    async (_, { signal }) => {
      log("list_projects");
      const projects = await listProjects();

      signal?.throwIfAborted();

      return {
        content: [
          {
            type: "text",
            text: projects.map((p) => `${p.key}  ${p.name}`).join("\n"),
          },
        ],
      };
    }
  );

  // ── update_ticket ───────────────────────────────────────────────────────────
  server.registerTool(
    "update_ticket",
    {
      description:
        "Update fields of an existing Jira ticket. Description accepts markdown — auto-converted to Atlassian Document Format.\n\nIMPORTANT: Always show the user what will change and get explicit confirmation before calling this tool. Never update silently.",
      inputSchema: {
        key: z.string().describe("Jira ticket key, e.g. PROJ-1234"),
        summary: z.string().optional().describe("New ticket title"),
        description: z.string().optional().describe("New description (markdown)"),
        labels: z.array(z.string()).optional().describe("Replace label list"),
        storyPoints: z.number().optional().describe("Story point estimate"),
      },
    },
    async ({ key, ...updates }, { signal }) => {
      log("update_ticket", key, JSON.stringify(Object.keys(updates)));
      signal?.throwIfAborted();
      await updateTicketFields(key, updates);

      return {
        content: [{ type: "text", text: `${key} updated successfully.` }],
      };
    }
  );

  // ── create_ticket ───────────────────────────────────────────────────────────
  server.registerTool(
    "create_ticket",
    {
      description:
        "Create a new Jira ticket. Description accepts markdown.\n\nUC2 final step. Before calling:\n1. You have project key, issue type, title, and description ready\n2. Show the user a preview of what will be created\n3. Get confirmation\n\nFor a good description: use business context the user provided + explore_repo output (if user requested exploration).",
      inputSchema: {
        projectKey: z.string().describe("Project key, e.g. PROJ"),
        issueType: z.string().describe('Issue type: "Story", "Bug", "Task", "Epic"'),
        summary: z.string().describe("Ticket title"),
        description: z.string().optional().describe("Description in markdown"),
        priority: z.string().optional().describe('"Highest", "High", "Medium", "Low"'),
        labels: z.array(z.string()).optional(),
        components: z.array(z.string()).optional(),
        epicKey: z.string().optional().describe("Parent epic key, e.g. PROJ-100"),
        storyPoints: z.number().optional(),
      },
    },
    async ({ projectKey, issueType, summary, description = "", ...rest }, { signal }) => {
      log("create_ticket", projectKey, issueType, summary);
      signal?.throwIfAborted();
      const result = await createTicket({
        projectKey,
        issueType,
        summary,
        description,
        ...rest,
      });

      return { content: [{ type: "text", text: `Created ${result.key}` }] };
    }
  );

  // ── enrich_ticket ───────────────────────────────────────────────────────────
  server.registerTool(
    "enrich_ticket",
    {
      description: `Prepare a Jira ticket for enrichment. Returns the full ticket data + any extra context formatted for you to write an improved description and acceptance criteria.

After calling this tool, YOU must generate:

**Description** — write like a senior engineer's handoff note:
1. Why something is broken/missing and who it affects (1–2 sentences)
2. How the relevant code is set up — where the fix lives and why
3. What specifically changes — for config/constant changes include a short snippet (3–6 lines)
4. Non-obvious constraints or test gotchas — only if genuinely non-obvious

Headers (##): only for a real shift in the story. Calibrate length to complexity:
- Config/list entry change: ~100 words
- Small bug fix or feature: ~200–300 words
- Multi-file change: ~400–500 words
Tone: descriptive, not instructional. No filler. Don't repeat the ticket title.

**Acceptance Criteria** — 2–5 items, each a concrete observable outcome:
- [ ] criterion
Avoid vague statements like "the feature works correctly".

After writing both, show the user the result and ask for confirmation before calling update_ticket.`,
      inputSchema: {
        key: z.string().describe("Jira ticket key, e.g. PROJ-1234"),
        context: z
          .string()
          .optional()
          .describe(
            "Additional context: business requirements, meeting notes, or explore_repo output"
          ),
      },
    },
    async ({ key, context = "" }, { signal }) => {
      log("enrich_ticket", key, context ? `+context(${context.length}chars)` : "no context");
      signal?.throwIfAborted();
      const ticket = await getTicket(key);

      signal?.throwIfAborted();
      const input = ticketToEnrichInput(ticket, context);

      const lines: string[] = [
        `Ticket: ${input.key}`,
        `Title: ${input.summary}`,
        `Type: ${input.issuetype ?? "—"}`,
        `Priority: ${input.priority ?? "—"}`,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        `Labels: ${input.labels?.join(", ") || "—"}`,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        `Components: ${input.components?.join(", ") || "—"}`,
        ``,
        `Current description:`,
        input.description || "(empty)",
      ];

      if (context.trim()) {
        lines.push(``, `Additional context:`, context.trim());
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
