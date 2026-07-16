import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withGitPathspecFile<T>(
  paths: readonly string[],
  callback: (pathspecFile: string) => Promise<T>,
): Promise<T> {
  for (const path of paths) {
    if (path.includes("\0")) {
      throw new Error("git pathspec cannot contain a NUL byte");
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "trauma-git-pathspec-"));
  const pathspecFile = join(directory, "paths");
  try {
    const literalPathspecs = paths.map((path) => `:(literal)${path}`);
    await writeFile(pathspecFile, `${literalPathspecs.join("\0")}\0`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return await callback(pathspecFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function getGitPathspecFileArgs(pathspecFile: string): string[] {
  return [
    `--pathspec-from-file=${pathspecFile}`,
    "--pathspec-file-nul",
  ];
}
