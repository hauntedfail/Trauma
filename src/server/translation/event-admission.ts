import {
  CODEX_SERIALIZED_EVENT_MAX_BYTES,
  measureSerializedCodexEventBytes,
} from "../codex/event-limits";
import {
  CodexAppServerError,
  type CodexAppServerEvent,
} from "./codex-app-server";

export interface TranslationCodexEventAdmissionLimits {
  maxChunkAttemptBytes: number;
  maxChunkAttemptEvents: number;
  maxEventBytes: number;
  maxJobBytes: number;
  maxJobEvents: number;
}

export const TRANSLATION_CODEX_EVENT_LIMITS = Object.freeze({
  maxChunkAttemptBytes: 4 * 1_024 * 1_024,
  maxChunkAttemptEvents: 4_096,
  maxEventBytes: CODEX_SERIALIZED_EVENT_MAX_BYTES,
  maxJobBytes: 32 * 1_024 * 1_024,
  maxJobEvents: 262_144,
}) satisfies TranslationCodexEventAdmissionLimits;

export interface TranslationCodexChunkAttemptAdmission {
  admit(event: CodexAppServerEvent): boolean;
}

export class TranslationCodexEventAdmission {
  private jobBytes = 0;
  private jobEvents = 0;
  private limitError: CodexAppServerError | undefined;

  constructor(
    private readonly limits: TranslationCodexEventAdmissionLimits =
      TRANSLATION_CODEX_EVENT_LIMITS,
  ) {
    validateLimits(limits);
  }

  get error(): CodexAppServerError | undefined {
    return this.limitError;
  }

  startChunkAttempt(): TranslationCodexChunkAttemptAdmission {
    let attemptBytes = 0;
    let attemptEvents = 0;
    return {
      admit: (event) => {
        if (this.limitError !== undefined) {
          return false;
        }
        let eventBytes: number;
        try {
          eventBytes = measureSerializedCodexEventBytes(event);
        } catch {
          return this.reject();
        }
        if (
          eventBytes > this.limits.maxEventBytes ||
          attemptEvents + 1 > this.limits.maxChunkAttemptEvents ||
          attemptBytes + eventBytes > this.limits.maxChunkAttemptBytes ||
          this.jobEvents + 1 > this.limits.maxJobEvents ||
          this.jobBytes + eventBytes > this.limits.maxJobBytes
        ) {
          return this.reject();
        }
        attemptEvents += 1;
        attemptBytes += eventBytes;
        this.jobEvents += 1;
        this.jobBytes += eventBytes;
        return true;
      },
    };
  }

  private reject(): false {
    this.limitError ??= new CodexAppServerError(
      "event_limit_exceeded",
      "Translation Codex event admission limit was exceeded.",
    );
    return false;
  }
}

function validateLimits(limits: TranslationCodexEventAdmissionLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(
        "Translation Codex event limits must be positive safe integers.",
      );
    }
  }
}
