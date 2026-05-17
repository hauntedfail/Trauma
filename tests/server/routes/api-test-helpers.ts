import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";

import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import type { ResolvedTraumaConfig } from "../../../src/server/config";

export const routeMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f401";
export const routeNow = new Date("2026-05-14T00:00:00.000Z");

export function createApiEvent(
  request: Request,
  params: Record<string, string> = {},
): APIEvent {
  return {
    request,
    params,
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}

export async function writeRouteConfig(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        projectPath: "./data",
        storePath: "./data/storage",
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: false,
            remote: "origin",
            branch: "main",
            push: false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

export function loadRouteConfig(configPath: string): ResolvedTraumaConfig {
  process.env.TRAUMA_CONFIG_PATH = configPath;
  return loadTraumaConfig({ configPath });
}

export async function seedRouteMemory(
  config: ResolvedTraumaConfig,
  input: {
    memoryId?: string;
    contentPath?: string;
    title?: string;
  } = {},
): Promise<void> {
  const memoryId = input.memoryId ?? routeMemoryId;
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: `https://example.com/${memoryId}`,
      title: input.title ?? "Route Memory",
      description: null,
      faviconUrl: null,
      contentPath: input.contentPath ?? `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: routeNow,
      updatedAt: routeNow,
    });
  } finally {
    connection.close();
  }
}
