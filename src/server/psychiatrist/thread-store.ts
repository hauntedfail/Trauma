import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ResolvedTraumaConfig } from "../config";
import type {
  PsychiatristContextSection,
  PsychiatristContextSnapshotManifest,
  PsychiatristPairAssistant,
  PsychiatristThreadManifest,
  PsychiatristThreadPair,
} from "./types";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const threadMutationQueues = new Map<string, Promise<void>>();

export type PsychiatristTurnTerminalStatus = "canceled" | "completed" | "failed";

interface PairRevisionRow {
  assistant_response?: string;
  context_snapshot_path?: string;
  created_at: string;
  pair_id: string;
  response_markdown_path?: string;
  revision_kind: "pending" | "completed" | "failed" | "canceled" | "stale";
  regenerated_from_turn_id?: string;
  source_citations?: Array<{ source_id: string; title: string; url: string }>;
  status: PsychiatristThreadPair["status"];
  stream_path?: string;
  thread_id: string;
  turn_id: string;
  updated_at: string;
  user_prompt: string;
  web_source_policy?: { allowed: boolean; reason: "default_denied" | "user_approved_for_turn" };
}

export class PsychiatristThreadStoreError extends Error {
  constructor(
    public readonly code:
      | "invalid_id"
      | "thread_not_found"
      | "pair_not_found"
      | "orphan_assistant_response"
      | "turn_canceled",
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
    categories: input.contextSnapshot.categories ?? [],
    content_hash: input.contextSnapshot.contentHash,
    context_snapshot_id: input.contextSnapshot.contextSnapshotId,
    lang_code: input.contextSnapshot.langCode,
    memory_id: input.contextSnapshot.memoryId,
    policy_version: input.contextSnapshot.policyVersion,
    relative_path: input.contextSnapshot.relativePath ?? "",
    selected_section_anchors: input.contextSnapshot.selectedSectionAnchors,
    selected_section_hashes: input.contextSnapshot.selectedSectionHashes,
    sections: (input.contextSnapshot.sections ?? []).map((section) => ({
      anchor: section.anchor,
      end_offset: section.endOffset,
      level: section.level,
      markdown: section.markdown,
      path: section.path,
      start_offset: section.startOffset,
      title: section.title,
    })),
    source_url: input.contextSnapshot.sourceUrl ?? "",
    tags: input.contextSnapshot.tags ?? [],
    title: input.contextSnapshot.title ?? "",
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
    stream_path: turnStreamRelativePath(loaded.manifest, input.turnId),
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
  webSourcePolicy?: PairRevisionRow["web_source_policy"];
}): Promise<void> {
  await withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) => pair.pairId === input.pairId);
    if (existing?.status === "canceled") {
      throw new PsychiatristThreadStoreError(
        "turn_canceled",
        "Cannot append assistant response for a canceled turn.",
      );
    }
    const pending = existing?.status === "pending" && existing.assistant === undefined
      ? existing
      : undefined;
    if (pending === undefined) {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot append assistant response without a matching pending pair.",
      );
    }
    await rejectCanceledTurnCompletion(input.config, loaded.manifest, pending.turnId);

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
      stream_path: turnStreamRelativePath(loaded.manifest, pending.turnId),
      thread_id: input.threadId,
      turn_id: pending.turnId,
      updated_at: new Date().toISOString(),
      user_prompt: pending.user.content,
      web_source_policy: input.webSourcePolicy,
    });
    await rewriteThreadMarkdown(input.config, loaded.manifest);
  });
}

export async function appendRegeneratedAssistantResponse(input: {
  assistantResponse: string;
  citations: PsychiatristPairAssistant["citations"];
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  threadId: string;
  turnId: string;
  webSourcePolicy?: PairRevisionRow["web_source_policy"];
}): Promise<void> {
  await withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) => pair.pairId === input.pairId);
    if (existing === undefined || existing.assistant === undefined) {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot regenerate an assistant response without a completed pair.",
      );
    }
    await rejectCanceledTurnCompletion(input.config, loaded.manifest, input.turnId);

    const pairDirectoryPath = pairDirectory(input.config, loaded.manifest, input.pairId);
    await mkdir(pairDirectoryPath, { recursive: true });
    await writeFileAtomic(join(pairDirectoryPath, "RESPONSE.md"), input.assistantResponse);
    await appendPairRevision(input.config, loaded.manifest, {
      assistant_response: input.assistantResponse,
      created_at: existing.user.createdAt,
      pair_id: input.pairId,
      regenerated_from_turn_id: existing.turnId,
      response_markdown_path: pairResponseRelativePath(loaded.manifest, input.pairId),
      revision_kind: "completed",
      source_citations: input.citations.map((citation) => ({
        source_id: citation.sourceId,
        title: citation.title,
        url: citation.url,
      })),
      status: "completed",
      stream_path: turnStreamRelativePath(loaded.manifest, input.turnId),
      thread_id: input.threadId,
      turn_id: input.turnId,
      updated_at: new Date().toISOString(),
      user_prompt: existing.user.content,
      web_source_policy: input.webSourcePolicy,
    });
    await rewriteThreadMarkdown(input.config, loaded.manifest);
  });
}

export async function appendRetriedAssistantResponse(input: {
  assistantResponse: string;
  citations: PsychiatristPairAssistant["citations"];
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  threadId: string;
  turnId: string;
  webSourcePolicy?: PairRevisionRow["web_source_policy"];
}): Promise<void> {
  await withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) => pair.pairId === input.pairId);
    if (existing === undefined || existing.assistant !== undefined || existing.status !== "failed") {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot retry an assistant response without a failed unanswered pair.",
      );
    }
    await rejectCanceledTurnCompletion(input.config, loaded.manifest, input.turnId);

    const pairDirectoryPath = pairDirectory(input.config, loaded.manifest, input.pairId);
    await mkdir(pairDirectoryPath, { recursive: true });
    await writeFileAtomic(join(pairDirectoryPath, "RESPONSE.md"), input.assistantResponse);
    await appendPairRevision(input.config, loaded.manifest, {
      assistant_response: input.assistantResponse,
      created_at: existing.user.createdAt,
      pair_id: input.pairId,
      response_markdown_path: pairResponseRelativePath(loaded.manifest, input.pairId),
      revision_kind: "completed",
      source_citations: input.citations.map((citation) => ({
        source_id: citation.sourceId,
        title: citation.title,
        url: citation.url,
      })),
      status: "completed",
      stream_path: turnStreamRelativePath(loaded.manifest, input.turnId),
      thread_id: input.threadId,
      turn_id: input.turnId,
      updated_at: new Date().toISOString(),
      user_prompt: existing.user.content,
      web_source_policy: input.webSourcePolicy,
    });
    await rewriteThreadMarkdown(input.config, loaded.manifest);
  });
}

export async function markPsychiatristTurnCanceled(input: {
  codexThreadId?: string;
  codexTurnId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  threadId: string;
  turnId: string;
}): Promise<PsychiatristTurnTerminalStatus> {
  return withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) => pair.pairId === input.pairId);
    if (existing === undefined) {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot cancel a turn without a matching pair.",
      );
    }
    const existingTurn = await readTurnRecord(input.config, loaded.manifest, input.turnId);
    const terminalStatus = readTerminalTurnStatus(existingTurn?.status);
    if (terminalStatus !== undefined) {
      return terminalStatus;
    }
    if (existing.assistant !== undefined && existing.turnId === input.turnId) {
      return "completed";
    }
    const now = new Date().toISOString();
    if (existing.assistant === undefined) {
      await appendPairRevision(input.config, loaded.manifest, {
        created_at: existing.user.createdAt,
        pair_id: input.pairId,
        revision_kind: "canceled",
        status: "canceled",
        thread_id: input.threadId,
        turn_id: input.turnId,
        updated_at: now,
        user_prompt: existing.user.content,
      });
    }
    await writeJsonAtomic(join(threadDirectory(input.config, loaded.manifest), "turns", `${input.turnId}.json`), {
      canceled_at: now,
      codex_thread_id: input.codexThreadId,
      codex_turn_id: input.codexTurnId,
      pair_id: input.pairId,
      policy_version: loaded.manifest.policyVersion,
      regenerate_from_turn_id: existing.assistant === undefined ? undefined : existing.turnId,
      safe_error: {
        action: "retry",
        code: "turn_stopped",
        message: "Psychiatrist turn was stopped.",
      },
      status: "canceled",
      thread_id: input.threadId,
      turn_id: input.turnId,
    });
    await rewriteThreadMarkdown(input.config, loaded.manifest);
    return "canceled";
  });
}

export async function recordPsychiatristTurnStarted(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  regenerateFromTurnId?: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  const loaded = await loadPsychiatristThread({
    config: input.config,
    threadId: input.threadId,
  });
  await writeJsonAtomic(join(threadDirectory(input.config, loaded.manifest), "turns", `${input.turnId}.json`), {
    pair_id: input.pairId,
    policy_version: loaded.manifest.policyVersion,
    regenerate_from_turn_id: input.regenerateFromTurnId,
    started_at: new Date().toISOString(),
    status: "started",
    thread_id: input.threadId,
    turn_id: input.turnId,
  });
}

export async function markPsychiatristTurnCompleted(input: {
  codexThreadId?: string;
  codexTurnId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
  regenerateFromTurnId?: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  const loaded = await loadPsychiatristThread({
    config: input.config,
    threadId: input.threadId,
  });
  const turnPath = join(threadDirectory(input.config, loaded.manifest), "turns", `${input.turnId}.json`);
  let existing: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(await readFile(turnPath, "utf8"));
    if (isRecord(raw)) {
      existing = raw;
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (readTerminalTurnStatus(existing.status) !== undefined) {
    return;
  }
  await writeJsonAtomic(turnPath, {
    ...existing,
    codex_thread_id: input.codexThreadId,
    codex_turn_id: input.codexTurnId,
    completed_at: new Date().toISOString(),
    pair_id: input.pairId,
    policy_version: loaded.manifest.policyVersion,
    regenerate_from_turn_id: input.regenerateFromTurnId,
    started_at: typeof existing.started_at === "string" ? existing.started_at : new Date().toISOString(),
    status: "completed",
    thread_id: input.threadId,
    turn_id: input.turnId,
  });
  if (input.codexThreadId !== undefined) {
    await updateThreadManifest(input.config, loaded.manifest, {
      codexThreadId: input.codexThreadId,
    });
  }
}

export async function markPsychiatristTurnFailed(input: {
  codexThreadId?: string;
  codexTurnId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  error: {
    action: "retry";
    code: string;
    message: string;
  };
  pairId: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  await withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) => pair.pairId === input.pairId);
    if (existing === undefined) {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot fail a turn without a matching pair.",
      );
    }
    const existingTurn = await readTurnRecord(input.config, loaded.manifest, input.turnId);
    if (readTerminalTurnStatus(existingTurn?.status) !== undefined) {
      return;
    }
    const now = new Date().toISOString();
    if (existing.assistant === undefined) {
      await appendPairRevision(input.config, loaded.manifest, {
        created_at: existing.user.createdAt,
        pair_id: input.pairId,
        revision_kind: "failed",
        status: "failed",
        thread_id: input.threadId,
        turn_id: input.turnId,
        updated_at: now,
        user_prompt: existing.user.content,
      });
    }
    await writeJsonAtomic(join(threadDirectory(input.config, loaded.manifest), "turns", `${input.turnId}.json`), {
      codex_thread_id: input.codexThreadId,
      codex_turn_id: input.codexTurnId,
      failed_at: now,
      pair_id: input.pairId,
      policy_version: loaded.manifest.policyVersion,
      safe_error: input.error,
      status: "failed",
      thread_id: input.threadId,
      turn_id: input.turnId,
    });
    await rewriteThreadMarkdown(input.config, loaded.manifest);
  });
}

export async function markPsychiatristRegenerateFailed(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  error: {
    action: "retry";
    code: string;
    message: string;
  };
  pairId: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  await withThreadMutationLock(input.config, input.threadId, async () => {
    const loaded = await loadPsychiatristThread({
      config: input.config,
      threadId: input.threadId,
    });
    const existing = loaded.pairs.find((pair) =>
      pair.pairId === input.pairId && pair.assistant !== undefined
    );
    if (existing === undefined) {
      throw new PsychiatristThreadStoreError(
        "pair_not_found",
        "Cannot fail a regenerate turn without a completed pair.",
      );
    }
    const existingTurn = await readTurnRecord(input.config, loaded.manifest, input.turnId);
    if (readTerminalTurnStatus(existingTurn?.status) !== undefined) {
      return;
    }
    await writeJsonAtomic(join(threadDirectory(input.config, loaded.manifest), "turns", `${input.turnId}.json`), {
      failed_at: new Date().toISOString(),
      pair_id: input.pairId,
      policy_version: loaded.manifest.policyVersion,
      regenerate_from_turn_id: existing.turnId,
      safe_error: input.error,
      status: "failed",
      thread_id: input.threadId,
      turn_id: input.turnId,
    });
  });
}

export async function loadPsychiatristPairRegeneration(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  pairId: string;
}): Promise<{
  contextSnapshot: PsychiatristContextSnapshotManifest;
  manifest: PsychiatristThreadManifest;
  pair: PsychiatristThreadPair;
  paths: {
    pairContextRelativePath: string;
    pairPromptRelativePath: string;
    pairResponseRelativePath: string;
    pairRevisionLogRelativePath: string;
    threadManifestRelativePath: string;
    threadMarkdownRelativePath: string;
  };
  prompt: string;
  thread: {
    manifest: PsychiatristThreadManifest;
    pairs: PsychiatristThreadPair[];
  };
}> {
  validateSafeId(input.pairId);
  const root = join(resolve(input.config.storePath), "memories");
  const glob = new Bun.Glob(`*/threads/*/pairs/${input.pairId}/PROMPT.md`);
  const relativePromptPath = glob.scanSync({ cwd: root }).next().value;
  if (typeof relativePromptPath !== "string") {
    throw new PsychiatristThreadStoreError("pair_not_found", "Psychiatrist pair was not found.");
  }
  const parts = relativePromptPath.split("/");
  const memoryId = parts[0];
  const threadId = parts[2];
  if (memoryId === undefined || threadId === undefined) {
    throw new PsychiatristThreadStoreError("pair_not_found", "Psychiatrist pair was not found.");
  }
  const thread = await loadPsychiatristThread({ config: input.config, threadId });
  const pair = thread.pairs.find((candidate) => candidate.pairId === input.pairId);
  if (pair === undefined) {
    throw new PsychiatristThreadStoreError("pair_not_found", "Psychiatrist pair was not found.");
  }
  const prompt = await readFile(join(root, relativePromptPath), "utf8");
  const contextPath = join(pairDirectory(input.config, thread.manifest, input.pairId), "CONTEXT.json");
  const contextSnapshot = parseContextSnapshot(
    JSON.parse(await readFile(contextPath, "utf8")),
  );
  return {
    contextSnapshot,
    manifest: thread.manifest,
    pair,
    paths: {
      pairContextRelativePath: pairContextRelativePath(thread.manifest, input.pairId),
      pairPromptRelativePath: pairPromptRelativePath(thread.manifest, input.pairId),
      pairResponseRelativePath: pairResponseRelativePath(thread.manifest, input.pairId),
      pairRevisionLogRelativePath: pairRevisionLogRelativePath(thread.manifest),
      threadManifestRelativePath: threadManifestRelativePath(thread.manifest),
      threadMarkdownRelativePath: threadMarkdownRelativePath(thread.manifest),
    },
    prompt,
    thread,
  };
}

export async function loadPsychiatristTurnSafeError(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  threadId: string;
  turnId: string;
}): Promise<{ code: string } | undefined> {
  validateSafeId(input.threadId);
  validateSafeId(input.turnId);
  const manifest = await findThreadManifest(input.config, input.threadId);
  if (manifest === undefined) {
    throw new PsychiatristThreadStoreError(
      "thread_not_found",
      "Psychiatrist thread was not found.",
    );
  }
  const turn = await readTurnRecord(input.config, manifest, input.turnId);
  const safeError = isRecord(turn?.safe_error) ? turn.safe_error : undefined;
  return typeof safeError?.code === "string" ? { code: safeError.code } : undefined;
}

export async function loadPsychiatristTurnTerminalStatus(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  threadId: string;
  turnId: string;
}): Promise<PsychiatristTurnTerminalStatus | undefined> {
  validateSafeId(input.threadId);
  validateSafeId(input.turnId);
  const manifest = await findThreadManifest(input.config, input.threadId);
  if (manifest === undefined) {
    throw new PsychiatristThreadStoreError(
      "thread_not_found",
      "Psychiatrist thread was not found.",
    );
  }
  const turn = await readTurnRecord(input.config, manifest, input.turnId);
  const turnStatus = readTerminalTurnStatus(turn?.status);
  if (turnStatus !== undefined) {
    return turnStatus;
  }
  const pairs = reducePairRows(await readPairRevisionRows(input.config, manifest));
  const pair = pairs.find((candidate) => candidate.turnId === input.turnId);
  if (pair?.assistant !== undefined || pair?.status === "completed") {
    return "completed";
  }
  return readTerminalTurnStatus(pair?.status);
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
    pairs: await hydratePairRetryActions(input.config, manifest, reducePairRows(rows)),
  };
}

export async function findLatestPsychiatristThread(input: {
  activeContentHash: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode?: string;
  memoryId: string;
  variantKind: PsychiatristThreadManifest["variantKind"];
}): Promise<{
  manifest: PsychiatristThreadManifest;
  pairs: PsychiatristThreadPair[];
} | undefined> {
  validateSafeId(input.memoryId);
  const root = join(resolve(input.config.storePath), "memories", input.memoryId, "threads");
  let matches: PsychiatristThreadManifest[] = [];
  const glob = new Bun.Glob("*/THREAD.json");
  try {
    for await (const relativePath of glob.scan({ cwd: root })) {
      const raw = JSON.parse(await readFile(join(root, relativePath), "utf8"));
      const manifest = parseThreadManifest(raw);
      if (
        manifest.memoryId === input.memoryId &&
        manifest.activeContentHash === input.activeContentHash &&
        manifest.variantKind === input.variantKind &&
        manifest.langCode === input.langCode &&
        manifest.status !== "stale"
      ) {
        matches.push(manifest);
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  matches = matches.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt)
  );
  const latest = matches[0];
  return latest === undefined
    ? undefined
    : {
      manifest: latest,
      pairs: await hydratePairRetryActions(
        input.config,
        latest,
        reducePairRows(await readPairRevisionRows(input.config, latest)),
      ),
    };
}

export async function markPsychiatristThreadStale(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  threadId: string;
}): Promise<void> {
  const loaded = await loadPsychiatristThread({
    config: input.config,
    threadId: input.threadId,
  });
  await writeJsonAtomic(
    join(threadDirectory(input.config, loaded.manifest), "THREAD.json"),
    serializeThreadManifest({
      ...loaded.manifest,
      status: "stale",
      updatedAt: new Date().toISOString(),
    }),
  );
}

function parseContextSnapshot(value: unknown): PsychiatristContextSnapshotManifest {
  if (!isRecord(value)) {
    throw new PsychiatristThreadStoreError("pair_not_found", "Invalid CONTEXT.json.");
  }
  return {
    categories: readOptionalStringArray(value, "categories"),
    contentHash: readRequiredString(value, "content_hash"),
    contextSnapshotId: readRequiredString(value, "context_snapshot_id"),
    langCode: readOptionalString(value, "lang_code"),
    memoryId: readRequiredString(value, "memory_id"),
    policyVersion: readRequiredString(value, "policy_version"),
    relativePath: readOptionalString(value, "relative_path") ?? "",
    selectedSectionAnchors: readStringArray(value, "selected_section_anchors"),
    selectedSectionHashes: readStringArray(value, "selected_section_hashes"),
    sections: readOptionalContextSections(value, "sections"),
    sourceUrl: readOptionalString(value, "source_url") ?? "",
    tags: readOptionalStringArray(value, "tags"),
    title: readOptionalString(value, "title") ?? "",
    translationOutputHash: readOptionalString(value, "translation_output_hash"),
    userPrompt: readRequiredString(value, "user_prompt"),
    variantKind: readRequiredString(value, "variant_kind") as "source" | "translation",
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

async function hydratePairRetryActions(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
  pairs: PsychiatristThreadPair[],
): Promise<PsychiatristThreadPair[]> {
  const networkRequiredTurns = await readNetworkPermissionRequiredTurns(config, manifest);
  return Promise.all(pairs.map(async (pair) => {
    const retryTurn = networkRequiredTurns
      .filter((turn) => turn.pairId === pair.pairId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (retryTurn === undefined) {
      return pair;
    }
    if (pair.status === "failed" && pair.assistant === undefined && retryTurn.turnId === pair.turnId) {
      return {
        ...pair,
        retryAction: "allow_web_sources",
        retryMode: "first_answer",
        retryTurnId: retryTurn.turnId,
      };
    }
    if (
      pair.assistant !== undefined &&
      retryTurn.regenerateFromTurnId !== undefined &&
      retryTurn.regenerateFromTurnId === pair.turnId
    ) {
      return {
        ...pair,
        retryAction: "allow_web_sources",
        retryMode: "regenerate",
        retryTurnId: retryTurn.turnId,
      };
    }
    return pair;
  }));
}

async function readNetworkPermissionRequiredTurns(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
): Promise<Array<{
  pairId: string;
  regenerateFromTurnId?: string;
  turnId: string;
  updatedAt: string;
}>> {
  const turnsDirectory = join(threadDirectory(config, manifest), "turns");
  const glob = new Bun.Glob("*.json");
  const turns: Array<{
    pairId: string;
    regenerateFromTurnId?: string;
    turnId: string;
    updatedAt: string;
  }> = [];
  try {
    for await (const relativePath of glob.scan({ cwd: turnsDirectory })) {
      const raw = JSON.parse(await readFile(join(turnsDirectory, relativePath), "utf8"));
      if (!isRecord(raw) || raw.status !== "failed" || !isRecord(raw.safe_error)) {
        continue;
      }
      if (raw.safe_error.code !== "network_permission_required") {
        continue;
      }
      const pairId = readOptionalString(raw, "pair_id");
      const turnId = readOptionalString(raw, "turn_id");
      if (pairId === undefined || turnId === undefined) {
        continue;
      }
      turns.push({
        pairId,
        regenerateFromTurnId: readOptionalString(raw, "regenerate_from_turn_id"),
        turnId,
        updatedAt: readOptionalString(raw, "failed_at") ?? readOptionalString(raw, "updated_at") ?? "",
      });
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return turns;
}

function readTerminalTurnStatus(
  status: unknown,
): PsychiatristTurnTerminalStatus | undefined {
  return status === "canceled" || status === "completed" || status === "failed"
    ? status
    : undefined;
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
  await updateThreadManifest(config, manifest, {
    updatedAt: row.updated_at,
  });
}

async function updateThreadManifest(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
  patch: Partial<Pick<PsychiatristThreadManifest, "codexThreadId" | "status" | "updatedAt">>,
): Promise<void> {
  const updated = {
    ...manifest,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await writeJsonAtomic(
    join(threadDirectory(config, manifest), "THREAD.json"),
    serializeThreadManifest(updated),
  );
}

async function readTurnRecord(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
  turnId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(join(threadDirectory(config, manifest), "turns", `${turnId}.json`), "utf8"),
    );
    return isRecord(raw) ? raw : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function rejectCanceledTurnCompletion(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  manifest: PsychiatristThreadManifest,
  turnId: string,
): Promise<void> {
  const existingTurn = await readTurnRecord(config, manifest, turnId);
  if (existingTurn?.status === "canceled") {
    throw new PsychiatristThreadStoreError(
      "turn_canceled",
      "Cannot append an assistant response for a canceled turn.",
    );
  }
}

async function withThreadMutationLock<T>(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  threadId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${resolve(config.storePath)}:${threadId}`;
  const previous = threadMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  threadMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (threadMutationQueues.get(key) === queued) {
      threadMutationQueues.delete(key);
    }
  }
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

function threadMarkdownRelativePath(manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "THREAD.md");
}

function threadManifestRelativePath(manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "THREAD.json");
}

function pairPromptRelativePath(
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
  pairId: string,
): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "pairs", pairId, "PROMPT.md");
}

function pairContextRelativePath(
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
  pairId: string,
): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "pairs", pairId, "CONTEXT.json");
}

function pairResponseRelativePath(
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
  pairId: string,
): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "pairs", pairId, "RESPONSE.md");
}

function pairRevisionLogRelativePath(
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "PAIRS.jsonl");
}

function turnStreamRelativePath(
  manifest: Pick<PsychiatristThreadManifest, "memoryId" | "threadId">,
  turnId: string,
): string {
  return posix.join("memories", manifest.memoryId, "threads", manifest.threadId, "streams", `${turnId}.jsonl`);
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

function readStringArray(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
    throw new PsychiatristThreadStoreError("pair_not_found", `Missing ${key}.`);
  }
  return field;
}

function readOptionalStringArray(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (field === undefined) {
    return [];
  }
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
    throw new PsychiatristThreadStoreError("pair_not_found", `Invalid ${key}.`);
  }
  return field;
}

function readOptionalContextSections(
  value: Record<string, unknown>,
  key: string,
): PsychiatristContextSection[] {
  const field = value[key];
  if (field === undefined) {
    return [];
  }
  if (!Array.isArray(field)) {
    throw new PsychiatristThreadStoreError("pair_not_found", `Invalid ${key}.`);
  }
  return field.map((item) => {
    if (!isRecord(item)) {
      throw new PsychiatristThreadStoreError("pair_not_found", `Invalid ${key}.`);
    }
    return {
      anchor: readRequiredString(item, "anchor"),
      endOffset: readRequiredNumber(item, "end_offset"),
      level: readRequiredNumber(item, "level"),
      markdown: readRequiredString(item, "markdown"),
      path: readRequiredString(item, "path"),
      startOffset: readRequiredNumber(item, "start_offset"),
      title: readRequiredString(item, "title"),
    };
  });
}

function readRequiredNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number") {
    throw new PsychiatristThreadStoreError("pair_not_found", `Missing ${key}.`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
