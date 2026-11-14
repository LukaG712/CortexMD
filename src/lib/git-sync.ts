import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  dateIso: string;
  message: string;
}

export interface VaultGitStatus {
  available: boolean;
  initialized: boolean;
  branch: string;
  changedFiles: string[];
  commits: GitCommitSummary[];
  error?: string;
}

function runGit(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function isGitBinaryAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Initialize a local Git repository inside the vault root if one does not yet exist. */
export function ensureVaultGitRepo(rootPath: string): void {
  fs.mkdirSync(rootPath, { recursive: true });
  const gitDir = path.join(rootPath, ".git");
  if (!fs.existsSync(gitDir)) {
    try {
      runGit(rootPath, ["init", "-b", "main"]);
    } catch {
      runGit(rootPath, ["init"]);
    }
  }
  try {
    const existingName = runGit(rootPath, ["config", "--get", "user.name"]);
    if (!existingName) {
      runGit(rootPath, ["config", "user.name", "CortexMD Vault"]);
    }
  } catch {
    runGit(rootPath, ["config", "user.name", "CortexMD Vault"]);
  }
  try {
    const existingEmail = runGit(rootPath, ["config", "--get", "user.email"]);
    if (!existingEmail) {
      runGit(rootPath, ["config", "user.email", "vault@cortexmd.local"]);
    }
  } catch {
    runGit(rootPath, ["config", "user.email", "vault@cortexmd.local"]);
  }

  // Never track OS temp/trash metadata if present
  const gitignorePath = path.join(rootPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, ".DS_Store\nThumbs.db\n", "utf8");
  }
}

/** Inspect working tree changes and recent Git commits for a vault root directory. */
export function getVaultGitStatusAndLog(rootPath: string, limit = 15): VaultGitStatus {
  if (!isGitBinaryAvailable()) {
    return {
      available: false,
      initialized: false,
      branch: "",
      changedFiles: [],
      commits: [],
      error: "git CLI binary is not installed in this container.",
    };
  }

  const gitDir = path.join(rootPath, ".git");
  if (!fs.existsSync(gitDir)) {
    return {
      available: true,
      initialized: false,
      branch: "",
      changedFiles: [],
      commits: [],
    };
  }

  let branch = "main";
  try {
    branch = runGit(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
  } catch {
    branch = "main";
  }

  let changedFiles: string[] = [];
  try {
    const statusRaw = runGit(rootPath, ["status", "--porcelain"]);
    changedFiles = statusRaw
      ? statusRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  } catch {
    changedFiles = [];
  }

  const commits: GitCommitSummary[] = [];
  try {
    const logRaw = runGit(rootPath, [
      "log",
      `--max-count=${Math.max(1, Math.min(50, limit))}`,
      "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s",
    ]);
    if (logRaw) {
      for (const line of logRaw.split(/\r?\n/)) {
        const parts = line.split("\x1f");
        if (parts.length >= 5) {
          commits.push({
            hash: parts[0],
            shortHash: parts[1],
            author: parts[2],
            dateIso: parts[3],
            message: parts[4],
          });
        }
      }
    }
  } catch {
    // Unborn HEAD (no commits yet)
  }

  return {
    available: true,
    initialized: true,
    branch,
    changedFiles,
    commits,
  };
}

/** Stage all changes in the vault and create a snapshot commit. */
export function createVaultGitCommit(
  rootPath: string,
  customMessage?: string,
): {
  committed: boolean;
  commitHash: string | null;
  message: string;
  changedCount: number;
} {
  if (!isGitBinaryAvailable()) {
    throw new Error("git CLI binary is not installed.");
  }
  ensureVaultGitRepo(rootPath);
  runGit(rootPath, ["add", "-A"]);

  const statusRaw = runGit(rootPath, ["status", "--porcelain"]);
  const changes = statusRaw
    ? statusRaw.split(/\r?\n/).filter((l) => l.trim().length > 0)
    : [];

  if (changes.length === 0) {
    let headHash: string | null = null;
    try {
      headHash = runGit(rootPath, ["rev-parse", "--short", "HEAD"]);
    } catch {
      headHash = null;
    }
    return {
      committed: false,
      commitHash: headHash,
      message: "Working tree clean — nothing new to snapshot.",
      changedCount: 0,
    };
  }

  const msg =
    (customMessage || "").trim().slice(0, 140) ||
    `CortexMD snapshot ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;

  runGit(rootPath, ["commit", "-m", msg]);
  const commitHash = runGit(rootPath, ["rev-parse", "--short", "HEAD"]);
  return {
    committed: true,
    commitHash,
    message: msg,
    changedCount: changes.length,
  };
}
