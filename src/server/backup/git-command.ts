import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISABLED_GIT_HOOKS_CONFIG = `core.hooksPath=${devNull}`;

interface BuiltInGitCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export function executeBuiltInGit(
  args: readonly string[],
  options: BuiltInGitCommandOptions,
) {
  return execFileAsync(
    "git",
    ["-c", DISABLED_GIT_HOOKS_CONFIG, ...args],
    options,
  );
}
