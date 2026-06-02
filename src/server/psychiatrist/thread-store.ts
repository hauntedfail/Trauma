import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ResolvedTraumaConfig } from "../config";
import type {
  PsychiatristContextSnapshotManifest,
  PsychiatristPairAssistant,
  PsychiatristThreadManifest,
  PsychiatristThreadPair,
} from "./types";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PairRevisionRow {
  assistant_response?: string;
  context_snapshot_path?: string;
  created_at: string;
  pair_id: string;
  response_markdown_path?: string;
  revision_kind: "pending" | "completed" | "failed" | "canceled" | "stale";
  source_citations?: Array<{ source_id: string; title: string; url: string }>;
  status: PsychiatristThreadPair["status"];
  thread_id: string;
  turn_id: string;
  updated_at: string;
  user_prompt: string;
}

export class PsychiatristThreadStoreError extends Error {
  constructor(
    public readonly code:
      | "invalid_id"
      | "thread_not_found"
      | "pair_not_found"
      | "orphan_assistant_response",
    message: string,
  ) {
    super(message);
    this.name = "PsychiatristThreadStoreError";
  }
}

export async function createPsychiatristThread(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  manifest: PsychiatristThreadManifest;
}): Promise<void> {
  validateSafeId(input.manifest.memoryId);
  validateSafeId(input.manifest.threadId);
  const directory = threadDirectory(input.config, input.manifest);
  await mkdir(directory, { recursive: true });
  await writeJsonAtomic(
    join(directory, "THREAD.json"),
    serializeThreadManifest(input.manifest),
  );
  await writeFileAtomic(join(directory, "THREAD.md"), renderThreadMarkdown([]));
}

export async function appendPendingPair(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  contextSnapshot: PsychiatristContextSnapshotManifest;
  pairId: string;
  prompt: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  validateSafeId(input.pairId);
  validateSafeId(input.turnId);
  const loaded = await loadPsychiatristThread({
    config: input.config,
    threadId: input.threadId,
  });
  const pairDirectoryPath = pairDirectory(input.config, loaded.manifest, input.pairId);
  await mkdir(pairDirectoryPath, { recursive: true });
  const promptPath = posix.join(
    "memories",
    loaded.manifest.memoryId,
    "threads",
    input.threadId,
    "pairs",
    input.pairId,
    "PROMPT.md",
  );
  const contextPath = posix.join(
    "memories",
    loaded.manifest.memoryId,
    "threads",
    input.threadId,
    "pairs",
    input.pairId,
    "CONTEXT.json",
  );
  await writeFileAtomic(join(pairDirectoryPath, "PROMPT.md"), input.prompt);
  await writeJsonAtomic(join(pairDirectoryPath, "CONTEXT.json"), {
    content_hash: input.contextSnapshot.contentHash,
    context_snapshot_id: input.contextSnapshot.contextSnapshotId,
    lang_code: input.contextSnapshot.langCode,
    memory_id: input.contextSnapshot.memoryId,
    policy_version: input.contextSnapshot.policyVersion,
    selected_section_anchors: input.contextSnapshot.selectedSectionAnchors,
    selected_section_hashes: input.contextSnapshot.selectedSectionHashes,
    translation_output_hash: input.contextSnapshot.translationOutputHash,
    user_prompt: input.contextSnapshot.userPrompt,
    variant_kind: input.contextSnapshot.variantKind,
  });
  await appendPairRevision(input.config, loaded.manifest, {
    context_snapshot_path: contextPath,
    created_at: new Date().toISOString(),
    pair_id: input.pairId,
    revision_kind: "pending",
    status: "pending",
    thread_id: input.threadId,
    turn_id: input.turnId,
    updated_at: new Date().toISOString(),
    user_prompt: input.prompt,
  });
  await rewriteThreadMarkdown(input.config, loaded.manifest);
  void promptPath;
}

export async function appendAssistantResponse(input: {
  assistantResponse: string;
  citations: PsychiatristPairAssistant["citations"];
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  threadId: string;
}): Promise<void> {
  const loaded = await loadPsychiatristThread({
    config: input.config,
    threadId: input.threadId,
  });
  const pending = loaded.pairs.find((pair) =>
    pair.pairId === input.pairId && pair.assistant === undefined
  );
  if (pending === undefined) {
    throw new PsychiatristThreadStoreError(
      "pair_not_found",
      "Cannot append assistant response without a matching pending pair.",
    );
  }

  const pairDirectoryPath = pairDirectory(input.config, loaded.manifest, input.pairId);
  await mkdir(pairDirectoryPath, { recursive: true });
  await writeFileAtomic(join(pairDirectoryPath, "RESPONSE.md"), input.assistantResponse);
  const responsePath = posix.join(
    "memories",
    loaded.manifest.memoryId,
    "threads",
    input.threadId,
    "pairs",
    input.pairId,
    "RESPONSE.md",
  );
  await appendPairRevision(input.config, loaded.manifest, {
    assistant_response: input.assistantResponse,
    created_at: pending.user.createdAt,
    pair_id: input.pairId,
    response_markdown_path: responsePath,
    revision_kind: "completed",
    source_citations: input.citations.map((citation) => ({
      source_id: citation.sourceId,
      title: citation.title,
      url: citation.url,
    })),
    status: "completed",
    thread_id: input.threadId,
    turn_id: pending.turnId,
    updated_at: new Date().toISOString(),
    user_prompt: pending.user.content,
  });
  await rewriteThreadMarkdown(input.config, loaded.manifest);
}

export async function loadPsychiatristThread(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  threadId: string;
}): Promise<{
  manifest: PsychiatristThreadManifest;
  pairs: PsychiatristThreadPair[];
}> {
  validateSafeId(input.threadId);
  const manifest = await findThreadManifest(input.config, input.threadId);
  if (manifest === undefined) {
    throw new PsychiatristThreadStoreError(
      "thread_not_found",
      "Psychiatrist thread was not found.",
    );
  }
  const rows = await readPairRevisionRows(input.config, manifest);
  return {
    manifest,
    pairs: reducePairRows(rows),
  };
}

function serializeThreadManifest(manifest: PsychiatristThreadManifest) {
  return {
    active_content_hash: manifest.activeContentHash,
    codex_thread_id: manifest.codexThreadId,
    created_at: manifest.createdAt,
    lang_code: manifest.langCode,
    memory_id: manifest.memoryId,
    policy_version: manifest.policyVersion,
    source_hash: manifest.sourceHash,
    status: manifest.status,
    thread_id: manifest.threadId,
    translation_output_hash: manifest.translationOutputHash,
    updated_at: manifest.updatedAt,
    variant_kind: manifest.variantKind,
  };
}

function parseThreadManifest(value: unknown): PsychiatristThreadManifest {
  if (!isRecord(value)) {
    throw new PsychiatristThreadStoreError("thread_not_found", "Invalid THREAD.json.");
  }
  return {
    activeContentHash: readRequiredString(value, "active_content_hash"),
    codexThreadId: readOptionalString(value, "codex_thread_id"),
    createdAt: readRequiredString(value, "created_at"),
    langCode: readOptionalString(value, "lang_code"),
    memoryId: readRequiredString(value, "memory_id"),
    policyVersion: readRequiredString(value, "policy_version"),
    sourceHash: readRequiredString(value, "source_hash"),
    status: readRequiredString(value, "status") as PsychiatristThreadManifest["status"],
    threadId: readRequiredString(value, "thread_id"),
    translationOutputHash: readOptionalString(value, "translation_output_hash"),
    updatedAt: readRequiredString(value, "updated_at"),
    variantKind: readRequiredString(value, "variant_kind") as "source" | "translation",
  };
}

async function findThreadManifest(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  threadId: string,
): Promise<PsychiatristThreadManifest | undefined> {
  const root = join(resolve(config.storePath), "memories");
  let glob;
  try {
    glob = new Bun.Glob(`*/threads/${threadId}/THREAD.json`);
  } catch {
    throw new PsychiatristThreadStoreError("invalid_id", "Invalid thread id.");
  }
  for await (const relativePath of glob.scan({ cwd: root })) {
    const raw = JSON.parse(await readFile(join(root, relativePath), "utf8"));
    return parseThreadManifest(raw);
  }
  return undefined;
}

async function readPairRevisionRows(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
): Promise<PairRevisionRow[]> {
  const path = join(threadDirectory(config, manifest), "PAIRS.jsonl");
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return content.trim() === ""
    ? []
    : content.trim().split("\n").map((line) => JSON.parse(line) as PairRevisionRow);
}

function reducePairRows(rows: PairRevisionRow[]): PsychiatristThreadPair[] {
  const pairs = new Map<string, PsychiatristThreadPair>();
  for (const row of rows) {
    pairs.set(row.pair_id, {
      ...(row.assistant_response === undefined
        ? {}
        : {
          assistant: {
            citations: (row.source_citations ?? []).map((citation) => ({
              sourceId: citation.source_id,
              title: citation.title,
              url: citation.url,
            })),
            completedAt: row.updated_at,
            content: row.assistant_response,
          },
        }),
      pairId: row.pair_id,
      status: row.status,
      turnId: row.turn_id,
      user: {
        content: row.user_prompt,
        createdAt: row.created_at,
      },
    });
  }
  return [...pairs.values()];
}

async function appendPairRevision(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
  row: PairRevisionRow,
): Promise<void> {
  await appendFile(
    join(threadDirectory(config, manifest), "PAIRS.jsonl"),
    `${JSON.stringify(row)}\n`,
    "utf8",
  );
}

async function rewriteThreadMarkdown(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
): Promise<void> {
  const rows = await readPairRevisionRows(config, manifest);
  await writeFileAtomic(
    join(threadDirectory(config, manifest), "THREAD.md"),
    renderThreadMarkdown(reducePairRows(rows)),
  );
}

function renderThreadMarkdown(pairs: PsychiatristThreadPair[]): string {
  return [
    "# Psychiatrist Thread",
    "",
    ...pairs.flatMap((pair) => [
      `## User prompt ${pair.pairId}`,
      "",
      pair.user.content,
      "",
      ...(pair.assistant === undefined
        ? [`Status: ${pair.status}`, ""]
        : ["## Psychiatrist response", "", pair.assistant.content, ""]),
    ]),
  ].join("\n");
}

function threadDirectory(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
): string {
  return join(
    resolve(config.storePath),
    "memories",
    manifest.memoryId,
    "threads",
    manifest.threadId,
  );
}

function pairDirectory(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
  pairId: string,
): string {
  return join(threadDirectory(config, manifest), "pairs", pairId);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
}

function validateSafeId(id: string): void {
  if (!UUID_V7_PATTERN.test(id)) {
    throw new PsychiatristThreadStoreError("invalid_id", "Expected UUID v7 id.");
  }
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new PsychiatristThreadStoreError("thread_not_found", `Missing ${key}.`);
  }
  return field;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
