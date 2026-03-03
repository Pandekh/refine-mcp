import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { randomBytes } from "crypto";
import path from "path";
import os from "os";

import { ensureCloned } from "./clone";

const SESSIONS_DIR = path.join(os.tmpdir(), "refine-sessions");

export interface SessionMeta {
  id: string;
  repos: string[];
  createdAt: string;
  lastAccessedAt: string;
}

export interface Session extends SessionMeta {
  path: string;
}

function newSessionId(): string {
  return `sess_${randomBytes(4).toString("hex")}`;
}

function repoName(url: string): string {
  return (
    url
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") ?? url
  );
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }

  let i = 2;

  while (used.has(`${base}_${i}`)) {
    i++;
  }

  return `${base}_${i}`;
}

/** Compute unique directory names for a list of repo URLs. */
export function repoNamesForUrls(urls: string[]): string[] {
  const used = new Set<string>();

  return urls.map((url) => {
    const name = uniqueName(repoName(url), used);

    used.add(name);

    return name;
  });
}

/**
 * Create a session: clone all repos in parallel, symlink them into the
 * session directory so a single agent can navigate across all of them.
 */
export async function createSession(urls: string[]): Promise<Session> {
  mkdirSync(SESSIONS_DIR, { recursive: true });

  const id = newSessionId();
  const sessionDir = path.join(SESSIONS_DIR, id);

  mkdirSync(sessionDir, { recursive: true });

  const repoPaths = await Promise.all(urls.map((url) => ensureCloned(url)));
  const names = repoNamesForUrls(urls);

  for (let i = 0; i < urls.length; i++) {
    symlinkSync(repoPaths[i], path.join(sessionDir, names[i]));
  }

  const now = new Date().toISOString();
  const meta: SessionMeta = { id, repos: urls, createdAt: now, lastAccessedAt: now };

  writeFileSync(path.join(sessionDir, "meta.json"), JSON.stringify(meta, null, 2));

  return { ...meta, path: sessionDir };
}

/** Read session metadata. Returns null if session does not exist. */
export function getSession(id: string): Session | null {
  const sessionDir = path.join(SESSIONS_DIR, id);
  const metaPath = path.join(sessionDir, "meta.json");

  if (!existsSync(metaPath)) {
    return null;
  }

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SessionMeta;

    return { ...meta, path: sessionDir };
  } catch {
    return null;
  }
}

/** Update lastAccessedAt for a session. */
export function touchSession(id: string): void {
  const metaPath = path.join(SESSIONS_DIR, id, "meta.json");

  if (!existsSync(metaPath)) {
    return;
  }

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SessionMeta;

    meta.lastAccessedAt = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // ignore
  }
}

/** List all sessions, most recently accessed first. */
export function listSessions(): Session[] {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const sessions: Session[] = [];

  try {
    for (const entry of readdirSync(SESSIONS_DIR)) {
      const session = getSession(entry);

      if (session) {
        sessions.push(session);
      }
    }
  } catch {
    // ignore
  }

  return sessions.sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt));
}

/**
 * Remove a session directory. Does NOT delete cached repo clones in the
 * shared pool — those are managed separately by ensureCloned / removeClone.
 * Returns true if the session existed and was removed.
 */
export function dropSession(id: string): boolean {
  const sessionDir = path.join(SESSIONS_DIR, id);

  if (!existsSync(sessionDir)) {
    return false;
  }

  rmSync(sessionDir, { recursive: true, force: true });

  return true;
}
