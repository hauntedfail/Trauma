import { join, resolve } from "node:path";

import { loadTraumaConfig, type TraumaConfig } from "../config";
import { writeMemoryContent } from "../store";

export const E2E_ROOT = resolve(process.cwd(), ".trauma/e2e");
export const E2E_CONFIG_FILE = join(E2E_ROOT, "trauma.config.json");
export const E2E_PROJECT_PATH = join(E2E_ROOT, "project");
export const E2E_STORE_PATH = join(E2E_PROJECT_PATH, "store");
export const E2E_DATABASE_PATH = join(E2E_ROOT, "runtime/trauma.sqlite");

export const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";
export const SECOND_READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102";
export const TOC_SCROLL_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103";
export const BROWSE_DELETE_MEMORY_ID = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef901";
export const PAGINATION_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f177";

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

export function loadE2eConfig() {
  return loadTraumaConfig({ configPath: E2E_CONFIG_FILE });
}

export function readerMemoryRow(
  memoryId: string,
  title: string,
  url: string,
  now: Date,
) {
  return {
    id: memoryId,
    url,
    title,
    description: "Reader fixture",
    faviconUrl: null,
    contentPath: `memories/${memoryId}/CONTENT.md`,
    extractionStatus: "success" as const,
    extractionError: null,
    backupStatus: "disabled" as const,
    lastBackupAt: null,
    lastBackupError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function writeFixtureMemoryContent(
  config: ReturnType<typeof loadE2eConfig>,
  memoryId: string,
  title: string,
  url: string,
  markdown: string,
  capturedAt = "2026-05-09T00:00:00.000Z",
): Promise<void> {
  await writeMemoryContent({
    config,
    memoryId,
    frontmatter: {
      id: memoryId,
      url,
      title,
      capturedAt,
      extractionStatus: "success",
    },
    markdown,
  });
}
