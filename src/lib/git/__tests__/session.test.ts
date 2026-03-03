import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

import {
  repoNamesForUrls,
  getSession,
  listSessions,
  dropSession,
  touchSession,
} from "../session";

// ── repoNamesForUrls ──────────────────────────────────────────────────────────

describe("repoNamesForUrls", () => {
  it("extracts name from URL", () => {
    expect(repoNamesForUrls(["https://github.com/org/auth-service"])).toEqual(["auth-service"]);
  });

  it("strips .git suffix", () => {
    expect(repoNamesForUrls(["https://github.com/org/auth-service.git"])).toEqual([
      "auth-service",
    ]);
  });

  it("deduplicates same-name repos with suffix", () => {
    const urls = [
      "https://gitlab.com/org-a/auth-service",
      "https://gitlab.com/org-b/auth-service",
      "https://gitlab.com/org-c/auth-service",
    ];

    expect(repoNamesForUrls(urls)).toEqual(["auth-service", "auth-service_2", "auth-service_3"]);
  });

  it("handles multiple different repos", () => {
    const urls = [
      "https://github.com/org/auth-service",
      "https://github.com/org/payment-service",
    ];

    expect(repoNamesForUrls(urls)).toEqual(["auth-service", "payment-service"]);
  });
});

// ── session CRUD ──────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.join(os.tmpdir(), "refine-sessions");

function seedSession(id: string, repos: string[], lastAccessedAt?: string) {
  const sessionDir = path.join(SESSIONS_DIR, id);

  mkdirSync(sessionDir, { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    id,
    repos,
    createdAt: now,
    lastAccessedAt: lastAccessedAt ?? now,
  };

  writeFileSync(path.join(sessionDir, "meta.json"), JSON.stringify(meta));
}

describe("getSession", () => {
  it("returns null for non-existent session", () => {
    expect(getSession("sess_nonexistent")).toBeNull();
  });

  it("reads a seeded session", () => {
    const id = "sess_test01";

    seedSession(id, ["https://github.com/org/repo"]);

    const session = getSession(id);

    expect(session).not.toBeNull();
    expect(session!.id).toBe(id);
    expect(session!.repos).toEqual(["https://github.com/org/repo"]);
    expect(session!.path).toBe(path.join(SESSIONS_DIR, id));

    dropSession(id);
  });

  it("returns null for corrupted meta.json", () => {
    const id = "sess_corrupt";
    const sessionDir = path.join(SESSIONS_DIR, id);

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, "meta.json"), "not json");

    expect(getSession(id)).toBeNull();

    dropSession(id);
  });
});

describe("listSessions", () => {
  beforeEach(() => {
    seedSession("sess_list_a", ["https://github.com/org/a"], "2024-01-01T10:00:00.000Z");
    seedSession("sess_list_b", ["https://github.com/org/b"], "2024-01-02T10:00:00.000Z");
  });

  afterEach(() => {
    dropSession("sess_list_a");
    dropSession("sess_list_b");
  });

  it("returns seeded sessions", () => {
    const sessions = listSessions();
    const ids = sessions.map((s) => s.id);

    expect(ids).toContain("sess_list_a");
    expect(ids).toContain("sess_list_b");
  });

  it("sorts by lastAccessedAt descending", () => {
    const sessions = listSessions().filter((s) =>
      ["sess_list_a", "sess_list_b"].includes(s.id)
    );

    expect(sessions[0].id).toBe("sess_list_b");
    expect(sessions[1].id).toBe("sess_list_a");
  });
});

describe("dropSession", () => {
  it("removes an existing session and returns true", () => {
    const id = "sess_drop01";

    seedSession(id, ["https://github.com/org/repo"]);

    expect(dropSession(id)).toBe(true);
    expect(existsSync(path.join(SESSIONS_DIR, id))).toBe(false);
  });

  it("returns false for non-existent session", () => {
    expect(dropSession("sess_nope")).toBe(false);
  });
});

describe("touchSession", () => {
  it("updates lastAccessedAt", () => {
    const id = "sess_touch01";

    seedSession(id, ["https://github.com/org/repo"], "2020-01-01T00:00:00.000Z");

    const before = getSession(id)!.lastAccessedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00.000Z"));
    touchSession(id);
    vi.useRealTimers();

    const after = getSession(id)!.lastAccessedAt;

    expect(after).not.toBe(before);
    expect(new Date(after).getFullYear()).toBe(2025);

    dropSession(id);
  });

  it("does nothing for non-existent session", () => {
    expect(() => touchSession("sess_ghost")).not.toThrow();
  });
});
