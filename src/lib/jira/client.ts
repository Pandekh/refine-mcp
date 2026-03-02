export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  issuetype: { name: string; iconUrl?: string };
  priority: { name: string; iconUrl?: string } | null;
  status: { name: string };
  assignee: { displayName: string; avatarUrls?: Record<string, string> } | null;
  reporter: { displayName: string } | null;
  labels: string[];
  storyPoints: number | null;
  sprint: { name: string; id: number } | null;
  epic: { key: string; name: string } | null;
  components: { name: string }[];
  issueLinks: { type: string; key: string; summary: string }[];
  created: string;
  updated: string;
  project: { key: string; name: string };
}

async function jiraFetch(path: string, options?: RequestInit) {
  const baseUrl = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_TOKEN;

  if (!baseUrl || !email || !apiToken) {
    throw new Error("Jira not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN env vars.");
  }

  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const res = await fetch(`${baseUrl}/rest/api/3${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(`Jira API error ${res.status}: ${text}`);
  }

  // Read body as text first — avoids "Unexpected end of JSON input" when
  // Jira returns 204 or an empty 200 body without content-length header.
  const text = await res.text();

  if (!text) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

import { adfToMarkdown } from "./adf-to-markdown";

function mapIssue(raw: Record<string, unknown>): JiraTicket {
  const fields = raw.fields as Record<string, unknown>;

  const sprint = (() => {
    const customSprint = fields["customfield_10020"] as { name: string; id: number }[] | null;

    if (customSprint && customSprint.length > 0) {
      const active = customSprint.find(
        (s) => (s as unknown as { state: string }).state === "active"
      );
      const s = active ?? customSprint[customSprint.length - 1];

      return { name: s.name, id: s.id };
    }

    return null;
  })();

  const epic = (() => {
    const epicKey = fields["customfield_10014"] as string | null;

    if (epicKey) {
      return { key: epicKey, name: epicKey };
    }

    return null;
  })();

  const storyPoints =
    (fields["customfield_10028"] as number | null) ??
    (fields["story_points"] as number | null) ??
    null;

  const links = ((fields.issuelinks as Array<Record<string, unknown>>) || []).map((link) => {
    const outward = link.outwardIssue as Record<string, unknown> | undefined;
    const inward = link.inwardIssue as Record<string, unknown> | undefined;
    const related = outward ?? inward;
    const linkType = link.type as { outward: string; inward: string };

    return {
      type: outward ? linkType.outward : linkType.inward,
      key: related ? (related.key as string) : "",
      summary: related
        ? ((related.fields as Record<string, unknown>)?.summary as string) || ""
        : "",
    };
  });

  return {
    id: raw.id as string,
    key: raw.key as string,
    summary: (fields.summary as string) || "",
    description: adfToMarkdown(fields.description),
    issuetype: fields.issuetype as { name: string; iconUrl?: string },
    priority: fields.priority as { name: string; iconUrl?: string } | null,
    status: fields.status as { name: string },
    assignee: fields.assignee as JiraTicket["assignee"],
    reporter: fields.reporter as JiraTicket["reporter"],
    labels: (fields.labels as string[]) || [],
    storyPoints,
    sprint,
    epic,
    components: (fields.components as { name: string }[]) || [],
    issueLinks: links,
    created: (fields.created as string) || "",
    updated: (fields.updated as string) || "",
    project: fields.project as { key: string; name: string },
  };
}

export async function getTicket(ticketId: string): Promise<JiraTicket> {
  const raw = (await jiraFetch(
    `/issue/${ticketId}?expand=names&fields=summary,description,issuetype,priority,status,assignee,reporter,labels,components,issuelinks,created,updated,project,customfield_10020,customfield_10014,customfield_10028,story_points`
  )) as Record<string, unknown>;

  return mapIssue(raw);
}

export async function searchTickets(jql: string, maxResults = 20): Promise<JiraTicket[]> {
  const data = (await jiraFetch(`/search/jql`, {
    method: "POST",
    body: JSON.stringify({
      jql,
      maxResults,
      fields: [
        "summary",
        "description",
        "issuetype",
        "priority",
        "status",
        "assignee",
        "reporter",
        "labels",
        "components",
        "issuelinks",
        "created",
        "updated",
        "project",
        "customfield_10020",
        "customfield_10014",
        "customfield_10028",
      ],
    }),
  })) as { issues: Record<string, unknown>[] };

  return (data.issues ?? []).map(mapIssue);
}

import { markdownToAdf } from "./markdown-to-adf";

function textToAdf(text: string) {
  return markdownToAdf(text);
}

export async function updateTicketFields(
  ticketId: string,
  updates: {
    summary?: string;
    description?: string;
    labels?: string[];
    storyPoints?: number;
  }
) {
  const fields: Record<string, unknown> = {};

  if (updates.summary !== undefined) {
    fields.summary = updates.summary;
  }

  if (updates.description !== undefined) {
    fields.description = textToAdf(updates.description);
  }

  if (updates.labels !== undefined) {
    fields.labels = updates.labels;
  }

  if (updates.storyPoints !== undefined) {
    fields["customfield_10028"] = updates.storyPoints;
  }

  if (Object.keys(fields).length > 0) {
    await jiraFetch(`/issue/${ticketId}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }
}

export async function createTicket(opts: {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  priority?: string;
  labels?: string[];
  components?: string[];
  epicKey?: string;
  storyPoints?: number;
}): Promise<{ key: string; id: string }> {
  const fields: Record<string, unknown> = {
    project: { key: opts.projectKey },
    issuetype: { name: opts.issueType },
    summary: opts.summary,
    description: textToAdf(opts.description),
  };

  if (opts.priority) {
    fields.priority = { name: opts.priority };
  }

  if (opts.labels?.length) {
    fields.labels = opts.labels;
  }

  if (opts.components?.length) {
    fields.components = opts.components.map((name) => ({ name }));
  }

  if (opts.epicKey) {
    fields["customfield_10014"] = opts.epicKey;
  }

  if (opts.storyPoints != null) {
    fields["customfield_10028"] = opts.storyPoints;
  }

  const data = (await jiraFetch("/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  })) as { key: string; id: string };

  return { key: data.key, id: data.id };
}

// ── Metadata endpoints ──────────────────────────────────────────

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export async function listProjects(): Promise<JiraProject[]> {
  const data = (await jiraFetch("/project?recent=50&orderBy=name")) as Array<{
    id: string;
    key: string;
    name: string;
  }>;

  return data.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
  }));
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export async function listIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const data = (await jiraFetch(`/project/${projectKey}/statuses`)) as Array<{
    id: string;
    name: string;
    subtask: boolean;
  }>;

  return data.map((t) => ({
    id: t.id,
    name: t.name,
    subtask: t.subtask,
  }));
}

export interface JiraPriority {
  id: string;
  name: string;
}

export async function listPriorities(): Promise<JiraPriority[]> {
  const data = (await jiraFetch("/priority")) as Array<{ id: string; name: string }>;

  return data.filter((p) => p.name !== "empty").map((p) => ({ id: p.id, name: p.name }));
}

export interface JiraComponent {
  id: string;
  name: string;
}

export async function listComponents(projectKey: string): Promise<JiraComponent[]> {
  const data = (await jiraFetch(`/project/${projectKey}/components`)) as Array<{
    id: string;
    name: string;
  }>;

  return data.map((c) => ({
    id: c.id,
    name: c.name,
  }));
}

export interface JiraEpic {
  key: string;
  summary: string;
  status: string;
}

export async function listEpics(projectKey: string): Promise<JiraEpic[]> {
  const data = (await jiraFetch("/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql: `project=${projectKey} AND issuetype=Epic AND status != Done ORDER BY updated DESC`,
      maxResults: 50,
      fields: ["summary", "status"],
    }),
  })) as { issues: Array<{ key: string; fields: { summary: string; status: { name: string } } }> };

  return (data.issues ?? []).map((i) => ({
    key: i.key,
    summary: i.fields.summary || "",
    status: i.fields.status?.name || "",
  }));
}

export function isJiraConfigured(): boolean {
  return !!(process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_TOKEN);
}
