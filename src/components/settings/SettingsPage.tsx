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
import {
  captureAsyncActionFocusIntent,
  type AsyncActionFocusOwnership,
} from "../async-action-focus";
import { RouteHeader } from "../layout/RouteHeader";
import { ConfirmationPopup } from "../ui/ConfirmationPopup";
import {
  useFocusPlugins,
  type FocusPluginEvidenceLevel,
  type FocusPluginPulseRating,
  type FocusPluginSettingField,
} from "../../plugins";

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
const contentClass = "trauma-route-column trauma-settings-content";
const fieldClass = "grid min-w-0 gap-4";
const labelClass = "text-sm font-semibold text-trauma-text-primary";
const hintClass = "mb-0 text-sm text-trauma-text-secondary";
const selectClass =
  "trauma-field min-h-11 w-full font-medium";
const primaryButtonClass = "trauma-control trauma-control-primary";
const secondaryButtonClass = "trauma-control";
const dangerButtonClass = "trauma-control trauma-control-danger";

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
  let codexAuthSetupButton: HTMLButtonElement | undefined;
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

  const deleteOpenAiAuth = async (
    focusOwnership: AsyncActionFocusOwnership,
  ): Promise<boolean> => {
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
      restoreCodexAuthSetupFocus({
        focusOwnership,
        getTarget: () => codexAuthSetupButton,
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
      <RouteHeader layout="single" title="Settings" titleId="settings-title" />
      <div class={contentClass}>
        <section aria-labelledby="settings-language" class="grid min-w-0 gap-2">
          <h2 id="settings-language" class="trauma-section-heading">Language</h2>
          <div class={fieldClass}>
            <form class="grid min-w-0 gap-3" onSubmit={saveLanguage}>
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
              class="grid min-w-0 gap-3"
              aria-busy={codexCatalogPending()}
              onSubmit={saveCodexDefaults}
            >
              <div class="grid gap-2">
                <h3 class={labelClass}>Codex Translation</h3>
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
          </div>
        </section>

        <section aria-labelledby="settings-account" class="grid min-w-0 gap-2">
          <h2 id="settings-account" class="trauma-section-heading">Account</h2>
          <section class={fieldClass} aria-labelledby="codex-auth-title">
            <div class="grid gap-2">
              <h3 class={labelClass} id="codex-auth-title">
                Codex Auth
              </h3>
              <p class={hintClass}>
                Codex owns ChatGPT sign-in. TRAUMA stores only safe setup metadata.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                ref={codexAuthSetupButton}
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
              <div class="grid gap-1 rounded-control border border-trauma-border bg-trauma-bg-surface px-3.5 py-2.5">
                <p class={hintClass}>Open this verification URL and enter the code.</p>
                <p class="mb-0 text-sm font-semibold text-trauma-text-primary">
                  {pendingAuth().userCode}
                </p>
                <Show when={readSafeVerificationUrl(pendingAuth().verificationUrl)}>
                  {(verificationUrl) => (
                    <a
                      class="text-sm font-medium text-trauma-link"
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
        </section>

        <section aria-labelledby="settings-focus" class="grid min-w-0 gap-2">
          <h2 id="settings-focus" class="trauma-section-heading">Focus</h2>
          <FocusPluginsSettingsSection />
        </section>

        <Show when={message()}>
          {(value) => (
            <p class="mb-0 rounded-control border border-trauma-border bg-trauma-bg-elev px-3.5 py-2.5 text-sm font-medium text-trauma-text-secondary" role="status">
              {value()}
            </p>
          )}
        </Show>
        <Show when={error()}>
          {(value) => (
            <p class="mb-0 rounded-control border border-trauma-danger bg-trauma-bg-elev px-3.5 py-2.5 text-sm font-medium text-trauma-danger" role="alert">
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

export function restoreCodexAuthSetupFocus(input: {
  focusOwnership: AsyncActionFocusOwnership;
  getTarget: () => HTMLButtonElement | undefined;
}): void {
  queueMicrotask(() => {
    const target = input.getTarget();
    if (
      target?.isConnected !== true ||
      target.disabled ||
      !input.focusOwnership.ownsCurrentFocus()
    ) {
      return;
    }
    target.focus({ preventScroll: true });
  });
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

const PULSE_OPTIONS: ReadonlyArray<{
  rating: FocusPluginPulseRating;
  label: string;
}> = [
  { rating: "helped", label: "Helped" },
  { rating: "neutral", label: "Neutral" },
  { rating: "distracting", label: "Distracting" },
];

const evidenceBadgeLabel: Record<FocusPluginEvidenceLevel, string> = {
  high: "High evidence",
  moderate: "Moderate evidence",
  experimental: "Experimental",
  low: "Low evidence",
};

const evidenceBadgeClass: Record<FocusPluginEvidenceLevel, string> = {
  high: "border-trauma-success/40 bg-trauma-bg-surface text-trauma-success",
  moderate: "border-trauma-info/40 bg-trauma-bg-surface text-trauma-info",
  experimental: "border-trauma-warning/40 bg-trauma-bg-surface text-trauma-warning",
  low: "border-trauma-border bg-trauma-bg-surface text-trauma-text-muted",
};

export function FocusPluginsSettingsSection() {
  const focusPlugins = useFocusPlugins();
  const [pulseNotice, setPulseNotice] = createSignal("");

  const handleRecordPulse = (
    rating: FocusPluginPulseRating,
    pluginId?: string,
  ): void => {
    focusPlugins.recordPulse({ rating, pluginId });
    const label = PULSE_OPTIONS.find((item) => item.rating === rating)?.label ?? rating;
    setPulseNotice(`Recorded "${label}" for your current focus setup.`);
  };

  return (
    <section
      aria-labelledby="focus-plugins-heading"
      class={fieldClass}
      data-focus-plugins-settings
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1">
          <h3 id="focus-plugins-heading" class={labelClass}>
            Focus Plugins
          </h3>
          <p class={hintClass}>
            Opt-in ADHD-focus experiments stored locally in this browser. Toggle individual plugins to keep only what helps.
          </p>
        </div>
        <Show when={focusPlugins.plugins().length > 0}>
          <button
            class={secondaryButtonClass}
            type="button"
            onClick={() => focusPlugins.resetAllPlugins()}
          >
            Reset defaults
          </button>
        </Show>
      </div>

      <Show
        when={focusPlugins.plugins().length > 0}
        fallback={
          <p class="mb-0 border-t border-trauma-divider py-4 text-sm text-trauma-text-muted">
            No focus plugins are registered yet.
          </p>
        }
      >
        <div class="divide-y divide-trauma-divider border-t border-trauma-divider">
          <For each={focusPlugins.plugins()}>
            {(plugin) => {
              const enabled = () => focusPlugins.isPluginEnabled(plugin.id);
              return (
                <div
                  class="grid gap-3 py-4"
                  data-focus-plugin-id={plugin.id}
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="grid min-w-0 gap-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <h3 class="m-0 text-sm font-semibold text-trauma-text-primary">
                          {plugin.name}
                        </h3>
                        <span
                          class={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${evidenceBadgeClass[plugin.evidenceLevel]}`}
                        >
                          {evidenceBadgeLabel[plugin.evidenceLevel]}
                        </span>
                        <span class="inline-flex items-center rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-0.5 text-xs font-medium text-trauma-chip-ink">
                          {plugin.surface}
                        </span>
                      </div>
                      <p class="mb-0 text-sm text-trauma-text-secondary">
                        {plugin.description}
                      </p>
                      <Show when={plugin.evidenceSummary}>
                        {(summary) => (
                          <p class="mb-0 text-xs text-trauma-text-muted">
                            {summary()}
                          </p>
                        )}
                      </Show>
                    </div>
                    <button
                      aria-checked={enabled()}
                      class="trauma-switch"
                      role="switch"
                      type="button"
                      onClick={() => focusPlugins.togglePlugin(plugin.id)}
                    >
                      <span class="sr-only">{enabled() ? "Enabled" : "Off"}</span>
                    </button>
                  </div>

                  <Show when={plugin.settingsSchema.length > 0}>
                    <div class="grid gap-3 border-t border-trauma-divider pt-3">
                      <For each={plugin.settingsSchema}>
                        {(field) => (
                          <FocusPluginSettingControl
                            field={field}
                            pluginId={plugin.id}
                          />
                        )}
                      </For>
                      <div class="flex justify-end">
                        <button
                          class="trauma-control trauma-control-compact trauma-control-quiet"
                          type="button"
                          onClick={() => focusPlugins.resetPluginSettings(plugin.id)}
                        >
                          Reset plugin parameters
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <div class="grid gap-2 border-t border-trauma-divider pt-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="mb-0 text-sm font-semibold text-trauma-text-primary">
            Self-experiment pulse
          </p>
          <Show when={focusPlugins.pulseLog().length > 0}>
            <div class="flex items-center gap-3">
              <span class="text-xs text-trauma-text-muted">
                {focusPlugins.pulseLog().length}{" "}
                {focusPlugins.pulseLog().length === 1 ? "entry" : "entries"} saved locally
              </span>
              <button
                class="trauma-control trauma-control-compact trauma-control-quiet"
                type="button"
                onClick={() => {
                  focusPlugins.clearPulseHistory();
                  setPulseNotice("");
                }}
              >
                Clear log
              </button>
            </div>
          </Show>
        </div>
        <p class={hintClass}>
          Optional check-in tagged with your active plugins. No scores, streaks, or reminders.
        </p>
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Focus setup pulse feedback">
          <For each={PULSE_OPTIONS}>
            {(option) => (
              <button
                class={secondaryButtonClass}
                type="button"
                onClick={() => handleRecordPulse(option.rating)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <Show when={pulseNotice()}>
          {(notice) => (
            <p class="mb-0 text-xs font-medium text-trauma-text-secondary" role="status">
              {notice()}
            </p>
          )}
        </Show>
      </div>
    </section>
  );
}

function FocusPluginSettingControl(props: {
  pluginId: string;
  field: FocusPluginSettingField;
}) {
  const focusPlugins = useFocusPlugins();
  const inputId = () => `focus-plugin-${props.pluginId}-${props.field.key}`;
  const currentValue = () =>
    focusPlugins.getPluginSetting(props.pluginId, props.field.key) ??
    props.field.defaultValue;

  if (props.field.type === "boolean") {
    const field = props.field;
    const checked = () => Boolean(currentValue());
    return (
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="grid gap-0.5">
          <label class="text-sm font-medium text-trauma-text-primary" for={inputId()}>
            {field.label}
          </label>
          <Show when={field.description}>
            {(description) => (
              <p class="mb-0 text-xs text-trauma-text-muted">
                {description()}
              </p>
            )}
          </Show>
        </div>
        <input
          checked={checked()}
          class="size-4 accent-trauma-accent"
          id={inputId()}
          type="checkbox"
          onChange={(event) =>
            focusPlugins.setPluginSetting(
              props.pluginId,
              field.key,
              event.currentTarget.checked,
            )
          }
        />
      </div>
    );
  }

  if (props.field.type === "number") {
    const field = props.field;
    const numericValue = () => {
      const value = currentValue();
      return typeof value === "number" ? value : field.defaultValue;
    };
    return (
      <div class="grid gap-1">
        <label class="text-sm font-medium text-trauma-text-primary" for={inputId()}>
          {field.label}
          <Show when={field.unit}>
            {(unit) => (
              <span class="ml-1 text-xs font-normal text-trauma-text-muted">
                ({unit()})
              </span>
            )}
          </Show>
        </label>
        <Show when={field.description}>
          {(description) => (
            <p class="mb-0 text-xs text-trauma-text-muted">
              {description()}
            </p>
          )}
        </Show>
        <input
          class={selectClass}
          id={inputId()}
          max={field.max}
          min={field.min}
          step={field.step}
          type="number"
          value={numericValue()}
          onInput={(event) => {
            const parsed = Number(event.currentTarget.value);
            if (Number.isFinite(parsed)) {
              focusPlugins.setPluginSetting(props.pluginId, field.key, parsed);
            }
          }}
        />
      </div>
    );
  }

  const field = props.field;
  const selectedValue = () => {
    const value = currentValue();
    return typeof value === "string" ? value : field.defaultValue;
  };
  return (
    <div class="grid gap-1">
      <label class="text-sm font-medium text-trauma-text-primary" for={inputId()}>
        {field.label}
      </label>
      <Show when={field.description}>
        {(description) => (
          <p class="mb-0 text-xs text-trauma-text-muted">
            {description()}
          </p>
        )}
      </Show>
      <select
        class={selectClass}
        id={inputId()}
        value={selectedValue()}
        onChange={(event) =>
          focusPlugins.setPluginSetting(
            props.pluginId,
            field.key,
            event.currentTarget.value,
          )
        }
      >
        <For each={field.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </div>
  );
}
