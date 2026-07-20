import { readFile } from "node:fs/promises";

import { asc, eq } from "drizzle-orm";

import { initializeDatabase, schema } from "../db";
import { resolveMemoryContentPath } from "../store";
import type {
  E2ePersistenceState,
  MutateFixtureStateRequest,
} from "./control-types";
import { inspectFixtureGitState } from "./fixture-reset";
import {
  loadE2eConfig,
  READER_MEMORY_ID,
} from "./fixture-support";

export async function mutateE2eFixtureState(
  mutation: MutateFixtureStateRequest["mutation"],
): Promise<void> {
  const config = loadE2eConfig();
  const connection = initializeDatabase(config);
  try {
    switch (mutation) {
      case "moment_delete_focus_rows":
        await connection.db.insert(schema.moments).values([
          {
            id: "moment-focus-newer",
            memoryId: READER_MEMORY_ID,
            sectionAnchor: "details",
            sectionTitle: "Details",
            sectionLevel: 2,
            sectionPath: "1/1",
            createdAt: new Date("2026-05-09T00:01:00.000Z"),
            updatedAt: new Date("2026-05-09T00:01:00.000Z"),
          },
          {
            id: "moment-focus-older",
            memoryId: READER_MEMORY_ID,
            sectionAnchor: "fixture-reader",
            sectionTitle: "Fixture Reader",
            sectionLevel: 1,
            sectionPath: "1",
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
          },
        ]).run();
        return;
      case "settings_translation_defaults": {
        const now = new Date("2026-05-28T00:00:00.000Z");
        await connection.db.insert(schema.appSettings).values({
          id: "default",
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: "gpt-5.5",
          codexTranslationReasoningEffort: "high",
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: schema.appSettings.id,
          set: {
            translationTargetLanguage: "ja-JP",
            codexTranslationModel: "gpt-5.5",
            codexTranslationReasoningEffort: "high",
            updatedAt: now,
          },
        }).run();
        return;
      }
      case "flashback_warning_insert": {
        const text = "Curated markdown body";
        const startOffset = "# Fixture Reader\n\n".length;
        const now = new Date("2026-05-09T00:02:00.000Z");
        await connection.db.insert(schema.flashbacks).values({
          id: "flashback-warning-authoritative",
          memoryId: READER_MEMORY_ID,
          variantKind: "source",
          langCode: null,
          translationOutputHash: null,
          text,
          prefix: "",
          suffix: " with saved flashback.",
          startOffset,
          endOffset: startOffset + text.length,
          contentHash: null,
          createdAt: now,
          updatedAt: now,
        }).run();
        return;
      }
      case "flashback_warning_unflashback": {
        const updateTime = new Date("2026-05-09T00:03:00.000Z");
        connection.db.transaction((transaction) => {
          transaction.delete(schema.flashbacks)
            .where(eq(schema.flashbacks.id, "flashback-fixture"))
            .run();
          transaction.update(schema.flashbacks)
            .set({
              id: "flashback-deep-authoritative",
              updatedAt: updateTime,
            })
            .where(eq(schema.flashbacks.id, "flashback-deep"))
            .run();
        });
      }
    }
  } finally {
    connection.close();
  }
}

export async function inspectE2eMomentAnchors(): Promise<string[]> {
  const connection = initializeDatabase(loadE2eConfig());
  try {
    return connection.db.select({ value: schema.moments.sectionAnchor })
      .from(schema.moments)
      .orderBy(asc(schema.moments.createdAt))
      .all()
      .map(({ value }) => value);
  } finally {
    connection.close();
  }
}

export async function inspectE2eFlashbackIds(): Promise<string[]> {
  const connection = initializeDatabase(loadE2eConfig());
  try {
    return connection.db.select({ value: schema.flashbacks.id })
      .from(schema.flashbacks)
      .orderBy(asc(schema.flashbacks.id))
      .all()
      .map(({ value }) => value);
  } finally {
    connection.close();
  }
}

export async function inspectE2ePersistenceState(
  memoryId: string,
): Promise<E2ePersistenceState> {
  const config = loadE2eConfig();
  const connection = initializeDatabase(config);
  let memory;
  try {
    memory = await connection.repositories.memories.findById(memoryId);
  } finally {
    connection.close();
  }

  let commitCount = 0;
  let commitMessage: string | null = null;
  let fileContent: string | null = null;
  let gitStatus: string | null = null;
  let trackedContent: string | null = null;
  if (memory !== undefined) {
    const contentPath = resolveMemoryContentPath(config, memoryId);
    fileContent = await readFile(contentPath.absolutePath, "utf8");
    try {
      const gitState = await inspectFixtureGitState(contentPath.relativePath);
      commitCount = gitState.commitCount;
      commitMessage = gitState.commitMessage;
      gitStatus = gitState.gitStatus;
      trackedContent = gitState.trackedContent;
    } catch {
      commitCount = 0;
    }
  }

  return {
    backupStatus: memory?.backupStatus ?? null,
    commitCount,
    commitMessage,
    extractionError: memory?.extractionError ?? null,
    extractionStatus: memory?.extractionStatus ?? null,
    fileContent,
    gitStatus,
    id: memory?.id ?? null,
    title: memory?.title ?? null,
    trackedContent,
    url: memory?.url ?? null,
  };
}
