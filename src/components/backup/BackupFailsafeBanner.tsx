import { createSignal, Show } from "solid-js";

import type { BackupFailsafeAlertView } from "~/server/backup/environment";

export type BackupFailsafeActionName = "revert" | "migrate";

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
            TRAUMA will not silently write memories into the configured backup
            location until this is resolved.
          </p>
        </div>
        <dl class="grid gap-1 text-sm text-red-50">
          <Show when={props.alert.previousProjectPath}>
            {(path) => (
              <div>
                <dt class="inline font-bold">Previous project path: </dt>
                <dd class="inline break-all">{path()}</dd>
              </div>
            )}
          </Show>
          <Show when={props.alert.previousStorePath}>
            {(path) => (
              <div>
                <dt class="inline font-bold">Previous store path: </dt>
                <dd class="inline break-all">{path()}</dd>
              </div>
            )}
          </Show>
          <div>
            <dt class="inline font-bold">Current project path: </dt>
            <dd class="inline break-all">{props.alert.currentProjectPath}</dd>
          </div>
          <div>
            <dt class="inline font-bold">Current store path: </dt>
            <dd class="inline break-all">{props.alert.currentStorePath}</dd>
          </div>
          <Show when={props.alert.error}>
            {(message) => (
              <div>
                <dt class="inline font-bold">Error: </dt>
                <dd class="inline break-all">{message()}</dd>
              </div>
            )}
          </Show>
        </dl>
        <Show when={props.alert.kind === "backup_path_drift"}>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="min-h-10 rounded-lg bg-white px-3 py-2 font-bold text-red-950"
              disabled={pendingAction() !== null}
              onClick={() => void submit("revert")}
            >
              Revert config
            </button>
            <button
              type="button"
              class="min-h-10 rounded-lg border border-red-200 px-3 py-2 font-bold text-white"
              disabled={pendingAction() !== null}
              onClick={() => void submit("migrate")}
            >
              Migrate backup
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
