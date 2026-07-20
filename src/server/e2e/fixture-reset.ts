import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { executeBuiltInGit } from "../backup/git-command";
import { initializeDatabase } from "../db";
import type { ResetFixtureRequest } from "./control-types";
import {
  createFixtureConfig,
  E2E_CONFIG_FILE,
  E2E_DATABASE_PATH,
  E2E_PROJECT_PATH,
  E2E_ROOT,
  E2E_STORE_PATH,
  loadE2eConfig,
} from "./fixture-support";

export async function resetE2eFixture(
  fixture: ResetFixtureRequest["fixture"],
): Promise<void> {
  const config = createFixtureConfig(fixture === "backup_git");
  await rm(E2E_ROOT, { recursive: true, force: true });
  await Promise.all([
    mkdir(E2E_STORE_PATH, { recursive: true }),
    mkdir(dirname(E2E_DATABASE_PATH), { recursive: true }),
  ]);
  await writeFile(E2E_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  if (fixture === "backup_git") {
    await initializeFixtureGitRepository();
  }

  const connection = initializeDatabase(loadE2eConfig());
  connection.close();
}

export async function inspectFixtureGitState(
  contentRelativePath: string,
): Promise<{
  commitCount: number;
  commitMessage: string;
  gitStatus: string;
  trackedContent: string;
}> {
  const commitCount = Number.parseInt(
    (await runFixtureGit(["rev-list", "--count", "HEAD"])).trim(),
    10,
  );
  return {
    commitCount: Number.isFinite(commitCount) ? commitCount : 0,
    commitMessage: (await runFixtureGit(["log", "-1", "--format=%s"])).trimEnd(),
    gitStatus: (await runFixtureGit(["status", "--porcelain", "--", "store"])).trimEnd(),
    trackedContent: await runFixtureGit([
      "show",
      `HEAD:store/${contentRelativePath}`,
    ]),
  };
}

async function initializeFixtureGitRepository(): Promise<void> {
  await runFixtureGit(["init", "--initial-branch=main"]);
  for (const [key, value] of [
    ["user.name", "TRAUMA E2E"],
    ["user.email", "trauma-e2e@example.invalid"],
    ["commit.gpgSign", "false"],
  ] as const) {
    await runFixtureGit(["config", key, value]);
  }
}

function createFixtureGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function runFixtureGit(args: readonly string[]): Promise<string> {
  const result = await executeBuiltInGit(args, {
    cwd: E2E_PROJECT_PATH,
    env: createFixtureGitEnvironment(),
  });
  return String(result.stdout);
}
