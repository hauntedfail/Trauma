import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "../../settings/languages";
import type { SettingsState } from "../../server/settings/settings";
import type { CodexModelCatalog } from "../../server/translation/codex-app-server";
import type { CodexReasoningEffort } from "../../server/translation/types";
import {
  submitCodexTranslationDefaults,
  pollCodexAuthSetup,
  submitCancelCodexAuthSetup,
  submitReadCodexModels,
  submitReadCodexAuth,
  submitDeleteOpenAiAuth,
  submitEnableOpenAiAuth,
  submitTranslationTargetLanguage,
} from "./settings-submit";
import { revalidateSettingsState } from "./settings-loader";
import {
  createAsyncActionTracker,
  type AsyncActionToken,
} from "./action-state";
import { createCodexModelCatalogController } from "./codex-model-catalog-state";
import { captureAsyncActionFocusIntent } from "../async-action-focus";
import { RouteHeader } from "../layout/RouteHeader";
import { ConfirmationPopup } from "../ui/ConfirmationPopup";

export interface SettingsPageProps {
  initialCodexModelCatalog?: CodexModelCatalog | null;
  initialSettings: SettingsState;
}

type PendingCodexAuth = Extract<
  SettingsPageProps["initialSettings"]["openaiAuth"],
  { status: "login_started" }
>;

type SettingsAction =
  | "language"
  | "codex-defaults"
  | "openai-auth"
  | "openai-auth-poll";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const contentClass = "trauma-fluid-route-padding grid gap-5 py-7";
const fieldClass =
  "grid gap-3 rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5";
const labelClass = "text-[15px] font-extrabold text-trauma-text-primary";
const hintClass = "mb-0 text-sm font-semibold text-trauma-text-muted";
const selectClass =
  "min-h-11 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 font-bold text-trauma-text-primary";
const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-trauma-border-strong bg-trauma-accent px-4 py-2 font-extrabold text-trauma-accent-ink";
const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-trauma-border-strong px-4 py-2 font-extrabold text-trauma-text-primary disabled:opacity-60";
const dangerButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-trauma-danger px-4 py-2 font-extrabold text-trauma-danger";

export function SettingsPage(props: SettingsPageProps) {
  const [language, setLanguage] = createSignal<SupportedLanguageCode>(
    props.initialSettings.translationTargetLanguage,
  );
  const [codexModel, setCodexModel] = createSignal(
    props.initialSettings.codexTranslationModel ?? "",
  );
  const [codexEffort, setCodexEffort] = createSignal<
    CodexReasoningEffort | ""
  >(props.initialSettings.codexTranslationReasoningEffort ?? "");
  const [codexModels, setCodexModels] = createSignal(
    props.initialCodexModelCatalog?.models ?? [],
  );
  const [codexCatalogError, setCodexCatalogError] = createSignal("");
  const [codexCatalogPending, setCodexCatalogPending] = createSignal(false);
  const [codexAuth, setCodexAuth] = createSignal(props.initialSettings.openaiAuth);
  const pendingCodexAuth = () =>
    codexAuth().status === "login_started"
      ? codexAuth() as PendingCodexAuth
      : undefined;
  const [pendingActions, setPendingActions] = createSignal<
    ReadonlySet<SettingsAction>
  >(new Set());
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const authPollControllers = new Set<AbortController>();
  let codexModelSelect: HTMLSelectElement | undefined;
  let settingsPageActive = true;
  const codexCatalogController = createCodexModelCatalogController({
    initialModels: codexModels(),
    onStateChange: (state) => {
      setCodexModels(state.models);
      setCodexCatalogError(state.error);
      setCodexCatalogPending(state.pending);
    },
    readCatalog: ({ signal }) => submitReadCodexModels({ signal }),
  });
  const actionTracker = createAsyncActionTracker<SettingsAction>(
    setPendingActions,
  );
  const isPending = (action: SettingsAction): boolean =>
    pendingActions().has(action);
  const beginAction = (
    action: SettingsAction,
    options: { clearFeedback?: boolean } = {},
  ): AsyncActionToken<SettingsAction> => {
    const token = actionTracker.begin(action);
    if (options.clearFeedback !== false) {
      setError("");
      setMessage("");
    }
    return token;
  };
  const setActionMessage = (
    token: AsyncActionToken<SettingsAction>,
    value: string,
  ): void => {
    if (actionTracker.isCurrent(token) && actionTracker.isLatestFeedback(token)) {
      setMessage(value);
    }
  };
  const setActionError = (
    token: AsyncActionToken<SettingsAction>,
    value: string,
  ): void => {
    if (actionTracker.isCurrent(token) && actionTracker.isLatestFeedback(token)) {
      setError(value);
    }
  };
  const abortCodexAuthPolls = (): void => {
    for (const controller of authPollControllers) {
      controller.abort();
    }
    authPollControllers.clear();
  };

  onCleanup(() => {
    settingsPageActive = false;
    codexCatalogController.dispose();
    abortCodexAuthPolls();
  });

  onMount(() => {
    if (props.initialCodexModelCatalog === undefined) {
      void refreshCodexModels();
    }
  });

  const selectedCodexModel = createMemo(() => {
    const current = codexModel();
    return codexModels().find((model) =>
      model.model === current || model.id === current
    );
  });
  const reasoningEfforts = createMemo(() => {
    const selected = selectedCodexModel();
    if (selected !== undefined) {
      return selected.supportedReasoningEfforts;
    }
    return codexModels().find((model) => model.isDefault)
      ?.supportedReasoningEfforts ?? [];
  });

  const saveLanguage: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    void updateLanguage();
  };

  const updateLanguage = async (): Promise<void> => {
    const action = beginAction("language");
    try {
      const settings = await submitTranslationTargetLanguage({
        language: language(),
      });
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      setLanguage(settings.translationTargetLanguage);
      setActionMessage(action, "Translation target language saved.");
      void revalidateSettingsState();
    } catch {
      setActionError(action, "Failed to update translation target language.");
    } finally {
      actionTracker.finish(action);
    }
  };

  const refreshCodexModels = (): Promise<"error" | "ignored" | "success"> =>
    codexCatalogController.refresh();

  const retryCodexModels = (retryButton: HTMLButtonElement): void => {
    const shouldRestoreFocus = captureCodexCatalogRetryFocusIntent(retryButton);
    void refreshCodexModels().then((outcome) => {
      if (outcome !== "success" || !settingsPageActive) {
        return;
      }
      queueMicrotask(() => {
        if (settingsPageActive && shouldRestoreFocus()) {
          codexModelSelect?.focus();
        }
      });
    });
  };

  const saveCodexDefaults: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    void updateCodexDefaults();
  };

  const updateCodexDefaults = async (): Promise<void> => {
    const action = beginAction("codex-defaults");
    try {
      const selectedEffort = codexEffort();
      const settings = await submitCodexTranslationDefaults({
        model: codexModel() === "" ? null : codexModel(),
        reasoningEffort: selectedEffort === "" ? null : selectedEffort,
      });
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      setCodexModel(settings.codexTranslationModel ?? "");
      setCodexEffort(settings.codexTranslationReasoningEffort ?? "");
      setActionMessage(action, "Codex translation defaults saved.");
      void revalidateSettingsState();
    } catch (error) {
      setActionError(
        action,
        error instanceof Error
          ? error.message
          : "Failed to update Codex translation defaults.",
      );
    } finally {
      actionTracker.finish(action);
    }
  };

  const enableOpenAiAuth = async (): Promise<void> => {
    const action = beginAction("openai-auth");
    try {
      const response = await submitEnableOpenAiAuth();
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      if (response.status === "enabled") {
        setCodexAuth(response);
        setActionMessage(action, response.message);
        void revalidateSettingsState();
      } else if (response.status === "login_started") {
        setCodexAuth(response);
        setActionMessage(action, "Codex device-code setup started.");
        void refreshCodexAuthAfterLogin();
      } else if (response.status === "failed") {
        setActionError(action, response.error);
      } else {
        setCodexAuth(response);
        setActionMessage(action, "Codex auth setup state refreshed.");
        void revalidateSettingsState();
      }
    } catch (error) {
      setActionError(
        action,
        error instanceof Error ? error.message : "Failed to enable OpenAI auth.",
      );
    } finally {
      actionTracker.finish(action);
    }
  };

  const refreshCodexAuthAfterLogin = async (): Promise<void> => {
    const action = beginAction("openai-auth-poll", { clearFeedback: false });
    const controller = new AbortController();
    authPollControllers.add(controller);
    try {
      const response = await pollCodexAuthSetup({
        signal: controller.signal,
      });
      if (
        response === undefined ||
        controller.signal.aborted ||
        !actionTracker.isCurrent(action)
      ) {
        return;
      }
      setCodexAuth(response);
      if (response.status === "enabled") {
        setActionMessage(action, response.message);
        void revalidateSettingsState();
      } else if (response.status === "error") {
        setActionError(action, response.error);
      } else if (response.status === "login_started") {
        setActionMessage(
          action,
          "Codex setup is still pending. Check status or cancel and restart.",
        );
      } else {
        setActionMessage(action, "Codex auth setup state refreshed.");
        void revalidateSettingsState();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionError(
          action,
          error instanceof Error ? error.message : "Failed to refresh Codex auth.",
        );
      }
    } finally {
      authPollControllers.delete(controller);
      actionTracker.finish(action);
    }
  };

  const refreshCodexAuthStatus = async (): Promise<void> => {
    const action = beginAction("openai-auth-poll");
    try {
      const response = await submitReadCodexAuth();
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      setCodexAuth(response);
      if (response.status === "enabled") {
        setActionMessage(action, response.message);
      } else if (response.status === "error") {
        setActionError(action, response.error);
      } else if (response.status === "login_started") {
        setActionMessage(
          action,
          "Codex setup is still pending. Check status or cancel and restart.",
        );
      } else {
        setActionMessage(action, "Codex auth setup state refreshed.");
      }
      void revalidateSettingsState();
    } catch (error) {
      setActionError(
        action,
        error instanceof Error ? error.message : "Failed to refresh Codex auth.",
      );
    } finally {
      actionTracker.finish(action);
    }
  };

  const cancelOpenAiAuthSetup = async (): Promise<void> => {
    const action = beginAction("openai-auth");
    abortCodexAuthPolls();
    try {
      const canceled = await submitCancelCodexAuthSetup();
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      const refreshed = await submitReadCodexAuth();
      if (!actionTracker.isCurrent(action)) {
        return;
      }
      setCodexAuth(refreshed);
      setActionMessage(
        action,
        canceled.status === "canceled"
          ? "Codex auth setup canceled. You can start again."
          : "No pending Codex auth setup was found. State refreshed.",
      );
      void revalidateSettingsState();
    } catch (error) {
      setActionError(
        action,
        error instanceof Error ? error.message : "Failed to cancel Codex auth setup.",
      );
    } finally {
      actionTracker.finish(action);
    }
  };

  const deleteOpenAiAuth = async (): Promise<boolean> => {
    const action = beginAction("openai-auth");
    try {
      const response = await submitDeleteOpenAiAuth();
      if (!actionTracker.isCurrent(action)) {
        return false;
      }
      if (response.status === "unsupported") {
        setCodexAuth({
          status: "enabled",
          provider: "codex",
          message: response.message,
        });
        setActionMessage(
          action,
          response.message ?? "Codex auth logout is unsupported.",
        );
        void revalidateSettingsState();
        return true;
      }
      setCodexAuth({
        status: "disabled",
        provider: "codex",
        reason: "logged_out",
      });
      setActionMessage(action, "Codex auth was deleted.");
      void revalidateSettingsState();
      return true;
    } catch {
      setActionError(action, "Failed to delete OpenAI auth.");
      return false;
    } finally {
      actionTracker.finish(action);
    }
  };

  onMount(() => {
    if (props.initialSettings.openaiAuth.status === "login_started") {
      void refreshCodexAuthAfterLogin();
    }
  });

  return (
    <section class={pageFrame} aria-labelledby="settings-title">
      <RouteHeader
        eyebrow="Settings"
        layout="single"
        title="Workspace settings"
        titleId="settings-title"
      />
      <div class={contentClass}>
        <form class={fieldClass} onSubmit={saveLanguage}>
          <label class="grid gap-2">
            <span class={labelClass}>Translation target language</span>
            <select
              class={selectClass}
              disabled={isPending("language")}
              value={language()}
              onChange={(event) =>
                setLanguage(event.currentTarget.value as SupportedLanguageCode)
              }
            >
              {SUPPORTED_TRANSLATION_LANGUAGES.map((option) => (
                <option value={option.code}>
                  {option.label} ({option.code})
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              class={primaryButtonClass}
              disabled={isPending("language")}
              type="submit"
            >
              Save language
            </button>
          </div>
        </form>

        <form
          class={fieldClass}
          aria-busy={codexCatalogPending()}
          onSubmit={saveCodexDefaults}
        >
          <div class="grid gap-2">
            <h2 class={labelClass}>Codex Translation</h2>
          </div>
          <label class="grid gap-2">
            <span class={labelClass}>Model</span>
            <select
              class={selectClass}
              disabled={isPending("codex-defaults") || codexCatalogPending()}
              ref={codexModelSelect}
              value={codexModel()}
              onChange={(event) => setCodexModel(event.currentTarget.value)}
            >
              <option selected={codexModel() === ""} value="">
                Codex app-server default
              </option>
              <Show
                when={
                  codexModel() !== "" &&
                  !codexModels().some((model) =>
                    model.id === codexModel() || model.model === codexModel()
                  )
                }
              >
                <option selected value={codexModel()}>{codexModel()}</option>
              </Show>
              <For each={codexModels()}>
                {(model) => (
                  <option
                    selected={
                      codexModel() === model.model || codexModel() === model.id
                    }
                    value={model.model}
                  >
                    {model.displayName} ({model.model})
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="grid gap-2">
            <span class={labelClass}>Reasoning effort</span>
            <select
              class={selectClass}
              disabled={isPending("codex-defaults") || codexCatalogPending()}
              value={codexEffort()}
              onChange={(event) =>
                setCodexEffort(
                  event.currentTarget.value as CodexReasoningEffort | "",
                )
              }
            >
              <option selected={codexEffort() === ""} value="">
                Selected model default
              </option>
              <Show
                when={
                  codexEffort() !== "" &&
                  !reasoningEfforts().includes(codexEffort() as CodexReasoningEffort)
                }
              >
                <option selected value={codexEffort()}>{codexEffort()}</option>
              </Show>
              <For each={reasoningEfforts()}>
                {(effort) => (
                  <option selected={codexEffort() === effort} value={effort}>
                    {effort}
                  </option>
                )}
              </For>
            </select>
          </label>
          <div>
            <button
              class={primaryButtonClass}
              disabled={isPending("codex-defaults") || codexCatalogPending()}
              type="submit"
            >
              Save Codex defaults
            </button>
          </div>
          <Show when={codexCatalogPending() && codexCatalogError() === ""}>
            <p class={hintClass} role="status">Loading Codex model catalog...</p>
          </Show>
          <CodexCatalogFeedback
            error={codexCatalogError()}
            pending={codexCatalogPending()}
            retry={retryCodexModels}
          />
        </form>

        <section class={fieldClass} aria-labelledby="codex-auth-title">
          <div class="grid gap-2">
            <h2 class={labelClass} id="codex-auth-title">
              Codex Auth
            </h2>
            <p class={hintClass}>
              Codex owns ChatGPT sign-in. TRAUMA stores only safe setup metadata.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              class={secondaryButtonClass}
              disabled={
                codexAuth().status === "enabled" ||
                codexAuth().status === "login_started" ||
                isPending("openai-auth") || isPending("openai-auth-poll")
              }
              type="button"
              onClick={() => void enableOpenAiAuth()}
            >
              {codexAuth().status === "enabled" ? "Enabled" : "Start setup"}
            </button>
            <Show when={codexAuth().status === "enabled"}>
              <ConfirmationPopup
                confirmLabel="Delete auth"
                description="Delete Codex auth from this TRAUMA workspace?"
                disabled={isPending("openai-auth")}
                id="delete-codex-auth-confirmation"
                label="Delete Codex auth confirmation"
                onConfirm={deleteOpenAiAuth}
                placement="bottom-start"
                trigger={({ triggerProps }) => (
                  <button
                    {...triggerProps}
                    class={dangerButtonClass}
                    type="button"
                  >
                    Delete auth
                  </button>
                )}
              />
            </Show>
            <Show when={codexAuth().status === "login_started"}>
              <button
                class={secondaryButtonClass}
                disabled={isPending("openai-auth-poll") || isPending("openai-auth")}
                type="button"
                onClick={() => void refreshCodexAuthStatus()}
              >
                Check status
              </button>
              <button
                class={dangerButtonClass}
                disabled={isPending("openai-auth")}
                type="button"
                onClick={() => void cancelOpenAiAuthSetup()}
              >
                Cancel setup
              </button>
            </Show>
          </div>
          <Show when={codexAuth().status === "enabled"}>
            <p class={hintClass}>Codex ChatGPT sign-in is enabled.</p>
          </Show>
          <Show when={pendingCodexAuth()}>
            {(pendingAuth) => (
            <div class="grid gap-1 rounded-lg border border-trauma-border bg-trauma-bg-surface px-3 py-2">
              <p class={hintClass}>Open this verification URL and enter the code.</p>
              <p class="mb-0 text-sm font-extrabold text-trauma-text-primary">
                {pendingAuth().userCode}
              </p>
              <Show when={readSafeVerificationUrl(pendingAuth().verificationUrl)}>
                {(verificationUrl) => (
                  <a
                    class="text-sm font-bold text-trauma-link"
                    href={verificationUrl()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {verificationUrl()}
                  </a>
                )}
              </Show>
            </div>
            )}
          </Show>
          <Show when={codexAuth().status === "setup_required"}>
            <p class={hintClass}>
              Codex app-server setup is required before translation can run.
            </p>
          </Show>
          <Show when={codexAuth().status === "error"}>
            <p class={hintClass}>Codex auth state could not be read.</p>
          </Show>
        </section>

        <Show when={message()}>
          {(value) => (
            <p class="mb-0 rounded-lg border border-trauma-border bg-trauma-bg-base px-3 py-2 text-sm font-bold text-trauma-text-secondary" role="status">
              {value()}
            </p>
          )}
        </Show>
        <Show when={error()}>
          {(value) => (
            <p class="mb-0 rounded-lg border border-trauma-danger bg-trauma-bg-base px-3 py-2 text-sm font-bold text-trauma-danger" role="alert">
              {value()}
            </p>
          )}
        </Show>
      </div>
    </section>
  );
}

export function CodexCatalogFeedback(props: {
  error: string;
  pending: boolean;
  retry: (button: HTMLButtonElement) => void;
}) {
  return (
    <Show when={props.error !== ""}>
      <div class="grid justify-items-start gap-2" role="alert">
        <p class={hintClass}>{props.error}</p>
        <button
          class={secondaryButtonClass}
          disabled={props.pending}
          type="button"
          onClick={(event) => props.retry(event.currentTarget)}
        >
          {props.pending ? "Retrying..." : "Retry"}
        </button>
      </div>
    </Show>
  );
}

export function captureCodexCatalogRetryFocusIntent(
  retryButton: HTMLButtonElement,
  readActiveElement: () => Element | null = () =>
    typeof document === "undefined" ? null : document.activeElement,
  readBody: () => HTMLElement | undefined = () =>
    typeof document === "undefined" ? undefined : document.body,
): () => boolean {
  return captureAsyncActionFocusIntent(
    retryButton,
    readActiveElement,
    readBody,
  );
}

export function readSafeVerificationUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}
