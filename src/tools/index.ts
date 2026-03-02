/**
 * Refine MCP tools — shared between stdio server and HTTP route.
 *
 * ─────────────────────────────────────────────────────────────────
 * USE CASES
 * ─────────────────────────────────────────────────────────────────
 *
 * UC1 · Enrich an existing Jira ticket
 *   1. get_ticket(key)                    — load ticket + quality score
 *   2. [optional] search_tickets(jql)     — find similar/related tickets
 *   3. [optional, ON USER REQUEST ONLY]
 *        search_repos(name) → explore_repo(url, question)
 *   4. YOU write the improved description + AC using all gathered context
 *   5. update_ticket(key, fields)         — save to Jira after confirmation
 *
 * UC2 · Create a new ticket from scratch
 *   1. Collect from user: title, business context, affected services / repo URLs
 *   2. list_projects()                    — if project key unknown
 *   3. search_tickets(jql)               — check for duplicates
 *   4. [optional, ON USER REQUEST ONLY]
 *        search_repos(name) → explore_repo(url, question)
 *   5. YOU write the description + AC using all gathered context
 *   6. create_ticket(...)                 — save after confirmation
 *
 * ─────────────────────────────────────────────────────────────────
 * CRITICAL RULE FOR explore_repo
 * ─────────────────────────────────────────────────────────────────
 * NEVER call explore_repo automatically.
 * NEVER call explore_repo with a guessed or invented URL.
 * Always call search_repos FIRST to get a verified URL, then ASK:
 *   "Want me to explore [repo URL] to find the relevant code?"
 * Call explore_repo ONLY after the user explicitly confirms.
 * ─────────────────────────────────────────────────────────────────
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerJiraTools } from "./jira";
import { registerGitTools } from "./git";

export function registerTools(server: McpServer): void {
  registerJiraTools(server);
  registerGitTools(server);
}
