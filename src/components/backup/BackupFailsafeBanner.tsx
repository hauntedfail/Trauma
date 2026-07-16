import { createSignal, Show } from "solid-js";

import type { BackupFailsafeAlertView } from "~/server/backup/environment";

export type BackupFailsafeActionName =
  | "revert"
  | "migrate"
  | "delete-missing-record";

interface BackupFailsafeBannerProps {
  alert: BackupFailsafeAlertView;
}

export function BackupFailsafeBanner(props: BackupFailsafeBannerProps) {
  const [pendingAction, setPendingAction] =
    createSignal<BackupFailsafeActionName | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (action: BackupFailsafeActionName) => {
    setPendingAction(action);
    setError(null);
    try {
      const result = await submitBackupFailsafeAction({ action });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      globalThis.location?.reload();
    } catch {
      setError("Backup failsafe action request failed.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      class="border-b border-red-700 bg-red-950 px-5 py-4 text-white"
      role="alert"
      aria-live="assertive"
    >
      <div class="grid gap-3">
        <div>
          <h2 class="text-base font-extrabold">{props.alert.message}</h2>
          <p class="mt-1 max-w-[78ch] text-sm text-red-100">
            {describeBackupFailsafeAlert(props.alert)}
          </p>
        </div>
        <Show when={hasAction(props.alert, "revert") || hasAction(props.alert, "migrate")}>
          <div class="flex flex-wrap gap-2">
            <Show when={hasAction(props.alert, "revert")}>
              <button
                type="button"
                class="min-h-10 rounded-lg bg-white px-3 py-2 font-bold text-red-950"
                disabled={pendingAction() !== null}
                onClick={() => void submit("revert")}
              >
                Revert config
              </button>
            </Show>
            <Show when={hasAction(props.alert, "migrate")}>
              <button
                type="button"
                class="min-h-10 rounded-lg border border-red-200 px-3 py-2 font-bold text-white"
                disabled={pendingAction() !== null}
                onClick={() => void submit("migrate")}
              >
                {props.alert.kind === "backup_push_failed"
                  ? "Retry backup push"
                  : "Migrate backup"}
              </button>
            </Show>
          </div>
        </Show>
        <Show when={hasAction(props.alert, "delete-missing-record")}>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="min-h-10 rounded-lg bg-white px-3 py-2 font-bold text-red-950"
              disabled={pendingAction() !== null}
              onClick={() => void submit("delete-missing-record")}
            >
              Delete missing memory record
            </button>
          </div>
        </Show>
        <Show when={error()}>
          {(message) => <p class="text-sm font-bold text-red-100">{message()}</p>}
        </Show>
      </div>
    </section>
  );
}

export async function submitBackupFailsafeAction(input: {
  action: BackupFailsafeActionName;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const request = input.fetch ?? fetch;
  let response: Response;
  try {
    response = await request(`/api/backup/failsafe/${input.action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirm: true }),
    });
  } catch {
    return {
      ok: false as const,
      error: "Backup failsafe action request failed.",
    };
  }

  if (!response.ok) {
    const body = await readJson(response);
    return {
      ok: false as const,
      error: readError(body) ?? `Backup failsafe action failed (${response.status}).`,
    };
  }

  return { ok: true as const };
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readError(value: unknown) {
  return isRecord(value) && typeof value.error === "string" ? value.error : null;
}

function describeBackupFailsafeAlert(alert: BackupFailsafeAlertView) {
  if (alert.kind === "backup_content_inconsistent") {
    return "TRAUMA found backup metadata marked successful while the content file is missing, outside the configured backup paths, or not tracked by the backup repository.";
  }

  if (alert.kind === "backup_push_failed") {
    return "TRAUMA committed the memory backup locally, but pushing to the configured remote failed.";
  }

  if (alert.kind === "backup_repository_missing") {
    return "TRAUMA cannot use the configured backup location until projectPath is an initialized backup repository.";
  }

  return "TRAUMA will not silently write memories into the configured backup location until this is resolved.";
}

function hasAction(
  alert: BackupFailsafeAlertView,
  action: BackupFailsafeActionName,
) {
  return alert.availableActions.includes(action);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
