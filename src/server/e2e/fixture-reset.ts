import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { executeBuiltInGit } from "../backup/git-command";
import { loadTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { ResetFixtureRequest } from "./control-types";
import {
  createFixtureConfig,
  E2E_PROJECT_PATH,
  resolveE2eFixtureLayout,
} from "./fixture-support";

export async function resetE2eFixture(
  fixture: ResetFixtureRequest["fixture"],
  options: { root?: string } = {},
): Promise<void> {
  const layout = resolveE2eFixtureLayout(options.root);
  const config = createFixtureConfig(fixture === "backup_git");
  await rm(layout.root, { recursive: true, force: true });
  await Promise.all([
    mkdir(layout.storePath, { recursive: true }),
    mkdir(dirname(layout.databasePath), { recursive: true }),
  ]);
  await writeFile(
    layout.configFile,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );

  if (fixture === "backup_git") {
    await initializeFixtureGitRepository(layout.projectPath);
  }

  const connection = initializeDatabase(
    loadTraumaConfig({ configPath: layout.configFile }),
  );
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

async function initializeFixtureGitRepository(
  projectPath: string,
): Promise<void> {
  await runFixtureGit(["init", "--initial-branch=main"], projectPath);
  for (const [key, value] of [
    ["user.name", "TRAUMA E2E"],
    ["user.email", "trauma-e2e@example.invalid"],
    ["commit.gpgSign", "false"],
  ] as const) {
    await runFixtureGit(["config", key, value], projectPath);
  }
}

function createFixtureGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function runFixtureGit(
  args: readonly string[],
  projectPath = E2E_PROJECT_PATH,
): Promise<string> {
  const result = await executeBuiltInGit(args, {
    cwd: projectPath,
    env: createFixtureGitEnvironment(),
  });
  return String(result.stdout);
}
