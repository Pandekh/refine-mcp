import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { verifyRepo, ensureCloned } from "../clone";

// Error thrown by execFileSync when git clone fails (network/auth)
const GIT_CLONE_ERROR = /Command failed/i;

// ── URL validation ────────────────────────────────────────────────────────────

describe("verifyRepo — rejects unsupported URLs", () => {
  it("throws on SSH URL", () => {
    expect(() => verifyRepo("git@github.com:org/repo.git")).toThrow(
      /Only HTTPS repository URLs are supported/
    );
  });

  it("throws when no token is configured", () => {
    vi.stubEnv("GITLAB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITLAB_URL", "");

    expect(() => verifyRepo("https://github.com/org/repo")).toThrow(/No token configured/);
  });
});

describe("ensureCloned — rejects unsupported URLs", () => {
  it("throws on SSH URL", async () => {
    await expect(ensureCloned("git@gitlab.com:org/repo.git")).rejects.toThrow(
      /Only HTTPS repository URLs are supported/
    );
  });

  it("throws when no token is configured", async () => {
    vi.stubEnv("GITLAB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITLAB_URL", "");

    await expect(ensureCloned("https://gitlab.com/org/repo")).rejects.toThrow(
      /No token configured/
    );
  });
});

// ── Token injection logic ─────────────────────────────────────────────────────

describe("ensureCloned — token matching", () => {
  beforeEach(() => {
    vi.stubEnv("GITLAB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITLAB_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GITHUB_TOKEN → github.com", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    // Token injected — fails at git clone, not at our validation
    await expect(ensureCloned("https://github.com/org/nonexistent-xyz")).rejects.toThrow(
      GIT_CLONE_ERROR
    );
  });

  it("GITLAB_TOKEN alone → gitlab.com only", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat_test");
    await expect(ensureCloned("https://gitlab.com/org/nonexistent-xyz")).rejects.toThrow(
      GIT_CLONE_ERROR
    );
  });

  it("GITLAB_TOKEN alone → rejects github.com", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat_test");
    await expect(ensureCloned("https://github.com/org/repo")).rejects.toThrow(
      /No token configured/
    );
  });

  it("GITLAB_TOKEN alone → rejects private instance (not gitlab.com)", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat_test");
    await expect(ensureCloned("https://gitlab.company.com/org/repo")).rejects.toThrow(
      /No token configured/
    );
  });

  it("GITLAB_TOKEN + GITLAB_URL → matching private instance", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat_test");
    vi.stubEnv("GITLAB_URL", "https://gitlab.company.com");
    await expect(ensureCloned("https://gitlab.company.com/org/nonexistent-xyz")).rejects.toThrow(
      GIT_CLONE_ERROR
    );
  });

  it("GITLAB_TOKEN + GITLAB_URL → rejects non-matching host", async () => {
    vi.stubEnv("GITLAB_TOKEN", "glpat_test");
    vi.stubEnv("GITLAB_URL", "https://gitlab.company.com");
    await expect(ensureCloned("https://other.company.com/org/repo")).rejects.toThrow(
      /No token configured/
    );
  });
});
