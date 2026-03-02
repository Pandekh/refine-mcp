# refine-mcp

MCP server for Jira ticket enrichment and codebase exploration via Claude Desktop / Cursor.

## Tools

| Tool | Description |
|------|-------------|
| `get_ticket` | Fetch a Jira ticket by key or URL |
| `search_tickets` | Search tickets with JQL |
| `list_projects` | List accessible Jira projects |
| `update_ticket` | Update ticket fields (summary, description, labels, story points) |
| `create_ticket` | Create a new ticket |
| `enrich_ticket` | Prepare ticket data for AI-generated description + acceptance criteria |
| `search_repos` | Search GitLab/GitHub repos by name |
| `explore_repo` | Clone a repo and explore it with an AI agent (requires `OPENAI_API_KEY`) |

## Setup

### 1. Install via npx (from GitHub)

No installation needed — add to your MCP config and it builds on first run:

```json
{
  "mcpServers": {
    "refine": {
      "command": "npx",
      "args": ["github:Pandekh/refine-mcp"],
      "env": {
        "JIRA_URL": "https://your-org.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_TOKEN": "your-jira-api-token",

        "GITHUB_TOKEN": "ghp_...",

        "GITLAB_URL": "https://gitlab.com",
        "GITLAB_TOKEN": "glpat_...",

        "OPENAI_API_KEY": "sk-...",
        "CODEX_MODEL": "gpt-4.1",
        "CODEX_REASONING_EFFORT": "low"
      }
    }
  }
}
```

### 2. Run locally (dev)

```bash
git clone https://github.com/Pandekh/refine-mcp.git
cd refine-mcp
npm install
npm run build
```

Then in your MCP config:

```json
{
  "mcpServers": {
    "refine-dev": {
      "command": "node",
      "args": ["/absolute/path/to/refine-mcp/bin/refine-mcp.js"],
      "env": {
        "JIRA_URL": "...",
        "JIRA_EMAIL": "...",
        "JIRA_TOKEN": "..."
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_URL` | Yes | Your Jira base URL, e.g. `https://org.atlassian.net` |
| `JIRA_EMAIL` | Yes | Jira account email |
| `JIRA_TOKEN` | Yes | Jira API token (create at id.atlassian.com) |
| `GITHUB_TOKEN` | Optional | GitHub personal access token (for `search_repos` / `explore_repo`) |
| `GITLAB_URL` | Optional | GitLab instance URL, e.g. `https://gitlab.com` |
| `GITLAB_TOKEN` | Optional | GitLab personal access token |
| `OPENAI_API_KEY` | Optional | Required for `explore_repo` (uses OpenAI Codex agent) |
| `CODEX_MODEL` | Optional | Codex model, default `gpt-5.1` |
| `CODEX_REASONING_EFFORT` | Optional | `minimal`\|`low`\|`medium`\|`high`\|`xhigh`, default `low` |
