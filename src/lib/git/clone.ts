import { execFileSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import os from "os";

const REPOS_DIR = path.join(os.tmpdir(), "refine-repos");

function repoHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** Strip embedded credentials from URL for hashing */
function canonicalUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//");
}

/**
 * Inject a PAT into an HTTPS clone URL from env vars. Returns null if no
 * matching token is configured.
 *
 *   GITHUB_TOKEN              → github.com
 *   GITLAB_TOKEN + GITLAB_URL → private GitLab instance at that URL
 *   GITLAB_TOKEN alone        → gitlab.com
 */
function injectToken(url: string): string | null {
  if (!url.startsWith("https://")) {
    return null;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabBaseUrl = process.env.GITLAB_URL;

  try {
    const { hostname } = new URL(url);

    if (githubToken && hostname === "github.com") {
      return url.replace("https://", `https://oauth2:${githubToken}@`);
    }

    if (gitlabToken && gitlabBaseUrl) {
      const gitlabHost = new URL(gitlabBaseUrl).hostname;

      if (hostname === gitlabHost) {
        return url.replace("https://", `https://oauth2:${gitlabToken}@`);
      }
    }

    if (gitlabToken && hostname === "gitlab.com") {
      return url.replace("https://", `https://oauth2:${gitlabToken}@`);
    }
  } catch {
    /* invalid URL */
  }

  if (gitlabToken) {
    try {
      if (new URL(url).hostname === "gitlab.com") {
        return url.replace("https://", `https://oauth2:${gitlabToken}@`);
      }
    } catch {
      /* invalid URL */
    }
  }

  return null;
}

/**
 * Resolve an authed HTTPS URL or throw a descriptive error.
 * SSH URLs and token-less HTTPS URLs are rejected.
 */
function requireAuthedUrl(repoUrl: string): string {
  if (!repoUrl.startsWith("https://")) {
    throw new Error(
      `Only HTTPS repository URLs are supported (got: ${repoUrl}).\n` +
        `Set GITLAB_TOKEN or GITHUB_TOKEN and provide an HTTPS URL.`
    );
  }

  const authed = injectToken(repoUrl);

  if (!authed) {
    throw new Error(
      `No token configured for ${repoUrl}.\n` +
        `  github.com       → set GITHUB_TOKEN\n` +
        `  gitlab.com       → set GITLAB_TOKEN\n` +
        `  private GitLab   → set GITLAB_TOKEN + GITLAB_URL=https://your-instance.com`
    );
  }

  return authed;
}

/**
 * Verify a repo URL is accessible without cloning it.
 * Throws a user-friendly error on failure.
 */
export function verifyRepo(repoUrl: string): void {
  const authedUrl = requireAuthedUrl(repoUrl);

  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", authedUrl], {
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch {
    throw new Error(
      `Repository not found or inaccessible: ${repoUrl}\n` +
        `Call search_repos with the service name to find the correct URL.`
    );
  }
}

/** Ensure a repo is cloned locally and up-to-date. Returns the path to the repo. */
export async function ensureCloned(repoUrl: string): Promise<string> {
  mkdirSync(REPOS_DIR, { recursive: true });

  const hash = repoHash(canonicalUrl(repoUrl));
  const repoPath = path.join(REPOS_DIR, hash);
  const authedUrl = requireAuthedUrl(repoUrl);

  if (existsSync(path.join(repoPath, ".git"))) {
    try {
      // Refresh token in case it rotated
      execFileSync("git", ["-C", repoPath, "remote", "set-url", "origin", authedUrl], {
        stdio: "pipe",
        timeout: 10_000,
      });
      execFileSync("git", ["-C", repoPath, "fetch", "--depth", "1", "origin"], {
        stdio: "pipe",
        timeout: 60_000,
      });
      execFileSync("git", ["-C", repoPath, "merge", "--ff-only", "FETCH_HEAD"], {
        stdio: "pipe",
        timeout: 10_000,
      });
      return repoPath;
    } catch {
      // fallback: re-clone from scratch
      rmSync(repoPath, { recursive: true, force: true });
    }
  }

  execFileSync("git", ["clone", "--depth", "1", "--single-branch", authedUrl, repoPath], {
    stdio: "pipe",
    timeout: 120_000,
  });

  return repoPath;
}

/** Remove a specific cloned repo */
export function removeClone(repoUrl: string): void {
  const repoPath = path.join(REPOS_DIR, repoHash(canonicalUrl(repoUrl)));

  if (existsSync(repoPath)) {
    rmSync(repoPath, { recursive: true, force: true });
  }
}
