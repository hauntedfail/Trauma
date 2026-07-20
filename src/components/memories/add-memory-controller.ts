import { createSignal, type Accessor } from "solid-js";

import {
  submitAddMemoryUrl,
  type AddMemorySubmitResult,
  type SubmitAddMemoryUrlInput,
} from "./add-memory-submit";

interface AddMemoryAttempt {
  idempotencyKey: string;
  normalizedUrl: string;
}

interface AddMemorySubmissionControllerOptions {
  generateIdempotencyKey?: () => string;
  onBackupFailsafe?: () => Promise<unknown> | unknown;
  onCreationSettled?: (memoryId: string) => Promise<unknown> | unknown;
  submit?: (
    input: SubmitAddMemoryUrlInput & { idempotencyKey: string },
  ) => Promise<AddMemorySubmitResult>;
}

export interface AddMemorySubmissionView {
  dispose: () => void;
  submit: (input: {
    onCreated: (memoryId: string) => void;
  }) => Promise<AddMemorySubmitResult>;
}

export interface AddMemorySubmissionController {
  canSubmit: Accessor<boolean>;
  createView: () => AddMemorySubmissionView;
  errorMessage: Accessor<string>;
  isSubmitting: Accessor<boolean>;
  setUrl: (url: string) => void;
  url: Accessor<string>;
}

export function createAddMemorySubmissionController(
  options: AddMemorySubmissionControllerOptions = {},
): AddMemorySubmissionController {
  const [url, setUrlSignal] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const generateIdempotencyKey =
    options.generateIdempotencyKey ?? generateAddMemoryIdempotencyKey;
  const submit = options.submit ?? submitAddMemoryUrl;
  let attempt: AddMemoryAttempt | null = null;
  let pending: Promise<AddMemorySubmitResult> | null = null;

  const setUrl = (nextUrl: string): void => {
    const normalizedUrl = nextUrl.trim();
    if (attempt?.normalizedUrl !== normalizedUrl) {
      attempt = normalizedUrl === ""
        ? null
        : {
            idempotencyKey: generateIdempotencyKey(),
            normalizedUrl,
          };
    }
    setUrlSignal(nextUrl);
    setErrorMessage("");
  };

  const submitCurrentAttempt = (): Promise<AddMemorySubmitResult> => {
    if (pending !== null) {
      return pending;
    }

    const normalizedUrl = url().trim();
    if (attempt === null || attempt.normalizedUrl !== normalizedUrl) {
      attempt = normalizedUrl === ""
        ? null
        : {
            idempotencyKey: generateIdempotencyKey(),
            normalizedUrl,
          };
    }
    const submittedAttempt = attempt;
    if (submittedAttempt === null) {
      const result = {
        ok: false,
        error: "Enter a URL before saving.",
      } as const;
      setErrorMessage(result.error);
      return Promise.resolve(result);
    }

    setErrorMessage("");
    setIsSubmitting(true);
    const request = submit({
      idempotencyKey: submittedAttempt.idempotencyKey,
      url: submittedAttempt.normalizedUrl,
    })
      .then((result) => {
        if (result.ok) {
          if (attempt?.idempotencyKey === submittedAttempt.idempotencyKey) {
            attempt = null;
            setUrlSignal("");
            setErrorMessage("");
          }
          runDetachedCallback(() => options.onCreationSettled?.(result.memoryId));
          return result;
        }

        if (attempt?.idempotencyKey === submittedAttempt.idempotencyKey) {
          setErrorMessage(result.error);
        }
        if (shouldRevalidateBackupFailsafeAlert(result)) {
          runDetachedCallback(options.onBackupFailsafe);
        }
        return result;
      })
      .finally(() => {
        if (pending === request) {
          pending = null;
          setIsSubmitting(false);
        }
      });
    pending = request;
    return request;
  };

  return {
    canSubmit: () => url().trim() !== "" && !isSubmitting(),
    createView: () => {
      let active = true;
      return {
        dispose: () => {
          active = false;
        },
        submit: async ({ onCreated }) => {
          const ownsCompletion = pending === null;
          const result = await submitCurrentAttempt();
          if (active && ownsCompletion && result.ok) {
            onCreated(result.memoryId);
          }
          return result;
        },
      };
    },
    errorMessage,
    isSubmitting,
    setUrl,
    url,
  };
}

export function shouldRevalidateBackupFailsafeAlert(
  result: AddMemorySubmitResult,
): boolean {
  return !result.ok && result.backupFailsafe === true;
}

interface GenerateAddMemoryIdempotencyKeyInput {
  now?: number;
  randomBytes?: (length: number) => Uint8Array;
}

export function generateAddMemoryIdempotencyKey(
  input: GenerateAddMemoryIdempotencyKeyInput = {},
): string {
  const now = Math.trunc(input.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error("UUID v7 timestamp is outside the supported range");
  }

  const random = input.randomBytes?.(10) ?? secureRandomBytes(10);
  if (random.length !== 10) {
    throw new Error("UUID v7 generation requires exactly 10 random bytes");
  }
  const timestampHex = BigInt(now).toString(16).padStart(12, "0");
  const randomA = (((random[0] ?? 0) << 8) | (random[1] ?? 0)) & 0x0fff;
  const variantByte = ((random[2] ?? 0) & 0x3f) | 0x80;

  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${randomA.toString(16).padStart(3, "0")}`,
    `${toHex(variantByte)}${toHex(random[3] ?? 0)}`,
    Array.from(random.slice(4), toHex).join(""),
  ].join("-");
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function runDetachedCallback(
  callback: (() => Promise<unknown> | unknown) | undefined,
): void {
  if (callback === undefined) {
    return;
  }

  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // Revalidation is best-effort after the durable server result is known.
  }
}
