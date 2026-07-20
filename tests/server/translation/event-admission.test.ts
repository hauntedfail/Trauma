import { describe, expect, it } from "vitest";

import {
  CODEX_SERIALIZED_EVENT_MAX_BYTES,
  measureSerializedCodexEventBytes,
} from "../../../src/server/codex/event-limits";
import {
  TRANSLATION_CODEX_EVENT_LIMITS,
  TranslationCodexEventAdmission,
  type TranslationCodexEventAdmissionLimits,
} from "../../../src/server/translation/event-admission";
import type { CodexAppServerEvent } from "../../../src/server/translation/codex-app-server";

const generousLimits: TranslationCodexEventAdmissionLimits = {
  maxChunkAttemptBytes: 1_000_000,
  maxChunkAttemptEvents: 1_000,
  maxEventBytes: CODEX_SERIALIZED_EVENT_MAX_BYTES,
  maxJobBytes: 1_000_000,
  maxJobEvents: 1_000,
};

describe("translation Codex event admission", () => {
  it("keeps the production limits fixed and runtime-independent", () => {
    expect(CODEX_SERIALIZED_EVENT_MAX_BYTES).toBe(64 * 1_024);
    expect(TRANSLATION_CODEX_EVENT_LIMITS).toEqual({
      maxChunkAttemptBytes: 4 * 1_024 * 1_024,
      maxChunkAttemptEvents: 4_096,
      maxEventBytes: 64 * 1_024,
      maxJobBytes: 32 * 1_024 * 1_024,
      maxJobEvents: 262_144,
    });
  });

  it("measures serialized UTF-8 bytes and rejects an oversized individual event", () => {
    const event = { type: "delta", text: "界界" } satisfies CodexAppServerEvent;
    const serializedBytes = Buffer.byteLength(JSON.stringify(event), "utf8");

    expect(measureSerializedCodexEventBytes(event)).toBe(serializedBytes);

    const admission = new TranslationCodexEventAdmission({
      ...generousLimits,
      maxEventBytes: serializedBytes - 1,
    });
    const attempt = admission.startChunkAttempt();

    expect(attempt.admit(event)).toBe(false);
    expect(admission.error).toMatchObject({ code: "event_limit_exceeded" });
  });

  it("resets chunk-attempt budgets while accumulating job events and UTF-8 bytes", () => {
    const event = { type: "delta", text: "界" } satisfies CodexAppServerEvent;
    const eventBytes = measureSerializedCodexEventBytes(event);
    const admission = new TranslationCodexEventAdmission({
      ...generousLimits,
      maxChunkAttemptBytes: eventBytes,
      maxChunkAttemptEvents: 1,
      maxJobBytes: eventBytes * 2,
      maxJobEvents: 2,
    });

    expect(admission.startChunkAttempt().admit(event)).toBe(true);
    expect(admission.startChunkAttempt().admit(event)).toBe(true);
    expect(admission.startChunkAttempt().admit(event)).toBe(false);
    expect(admission.error).toMatchObject({ code: "event_limit_exceeded" });
  });

  it("fails closed when a Codex event cannot be serialized", () => {
    const cyclic: { self?: unknown; type: "process"; message: string } = {
      message: "unserializable",
      type: "process",
    };
    cyclic.self = cyclic;
    const admission = new TranslationCodexEventAdmission(generousLimits);
    const attempt = admission.startChunkAttempt();

    expect(attempt.admit(cyclic as unknown as CodexAppServerEvent)).toBe(false);
    expect(admission.error).toMatchObject({ code: "event_limit_exceeded" });
    expect(attempt.admit({ type: "delta", text: "later" })).toBe(false);
  });
});
