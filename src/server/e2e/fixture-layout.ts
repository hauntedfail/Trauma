import { join, resolve } from "node:path";

import type { TraumaConfig } from "../config";

export interface E2eFixtureLayout {
  configFile: string;
  databasePath: string;
  projectPath: string;
  root: string;
  storePath: string;
}

export function resolveE2eFixtureLayout(
  root = resolve(process.cwd(), ".trauma/e2e"),
): E2eFixtureLayout {
  const projectPath = join(root, "project");
  return {
    configFile: join(root, "trauma.config.json"),
    databasePath: join(root, "runtime/trauma.sqlite"),
    projectPath,
    root,
    storePath: join(projectPath, "store"),
  };
}

const defaultLayout = resolveE2eFixtureLayout();

export const E2E_ROOT = defaultLayout.root;
export const E2E_CONFIG_FILE = defaultLayout.configFile;
export const E2E_PROJECT_PATH = defaultLayout.projectPath;
export const E2E_STORE_PATH = defaultLayout.storePath;
export const E2E_DATABASE_PATH = defaultLayout.databasePath;

export function createFixtureConfig(gitEnabled: boolean): TraumaConfig {
  return {
    storePath: "./project/store",
    projectPath: "./project",
    databasePath: "./runtime/trauma.sqlite",
    backup: {
      git: {
        enabled: gitEnabled,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: gitEnabled
          ? "e2e {action} {memoryId}"
          : "backup memory {memoryId}",
      },
    },
  };
}
