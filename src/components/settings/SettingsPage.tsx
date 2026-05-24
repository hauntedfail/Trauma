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
  submitReadCodexModels,
  submitDeleteOpenAiAuth,
  submitEnableOpenAiAuth,
  submitTranslationTargetLanguage,
} from "./settings-submit";
import { revalidateSettingsState } from "./settings-loader";
import { RouteHeader } from "../layout/RouteHeader";

export interface SettingsPageProps {
  initialCodexModelCatalog?: CodexModelCatalog | null;
  initialSettings: SettingsState;
}

type PendingCodexAuth = Extract<
  SettingsPageProps["initialSettings"]["openaiAuth"],
  { status: "login_started" }
>;

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
  const [codexAuth, setCodexAuth] = createSignal(props.initialSettings.openaiAuth);
  const pendingCodexAuth = () =>
    codexAuth().status === "login_started"
      ? codexAuth() as PendingCodexAuth
      : undefined;
  const [pending, setPending] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const authPollControllers = new Set<AbortController>();

  onCleanup(() => {
    for (const controller of authPollControllers) {
      controller.abort();
    }
    authPollControllers.clear();
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
    setPending("language");
    setError("");
    setMessage("");
    try {
      const settings = await submitTranslationTargetLanguage({
        language: language(),
      });
      setLanguage(settings.translationTargetLanguage);
      setMessage("Translation target language saved.");
      void revalidateSettingsState();
    } catch {
      setError("Failed to update translation target language.");
    } finally {
      setPending("");
    }
  };

  const refreshCodexModels = async (): Promise<void> => {
    setCodexCatalogError("");
    try {
      const catalog = await submitReadCodexModels();
      setCodexModels(catalog.models);
    } catch (error) {
      setCodexCatalogError(
        error instanceof Error
          ? error.message
          : "Failed to read Codex model catalog.",
      );
    }
  };

  const saveCodexDefaults: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    void updateCodexDefaults();
  };

  const updateCodexDefaults = async (): Promise<void> => {
    setPending("codex-defaults");
    setError("");
    setMessage("");
    try {
      const selectedEffort = codexEffort();
      const settings = await submitCodexTranslationDefaults({
        model: codexModel() === "" ? null : codexModel(),
        reasoningEffort: selectedEffort === "" ? null : selectedEffort,
      });
      setCodexModel(settings.codexTranslationModel ?? "");
      setCodexEffort(settings.codexTranslationReasoningEffort ?? "");
      setMessage("Codex translation defaults saved.");
      void revalidateSettingsState();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to update Codex translation defaults.",
      );
    } finally {
      setPending("");
    }
  };

  const enableOpenAiAuth = async (): Promise<void> => {
    setPending("openai-auth");
    setError("");
    setMessage("");
    try {
      const response = await submitEnableOpenAiAuth();
      if (response.status === "enabled") {
        setCodexAuth(response);
        setMessage(response.message);
        void revalidateSettingsState();
      } else if (response.status === "login_started") {
        setCodexAuth(response);
        setMessage("Codex device-code setup started.");
        void refreshCodexAuthAfterLogin();
      } else if (response.status === "failed") {
        setError(response.error);
      } else {
        setCodexAuth(response);
        setMessage("Codex auth setup state refreshed.");
        void revalidateSettingsState();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to enable OpenAI auth.");
    } finally {
      setPending("");
    }
  };

  const refreshCodexAuthAfterLogin = async (): Promise<void> => {
    const controller = new AbortController();
    authPollControllers.add(controller);
    try {
      const response = await pollCodexAuthSetup({
        signal: controller.signal,
      });
      if (response === undefined || controller.signal.aborted) {
        return;
      }
      setCodexAuth(response);
      if (response.status === "enabled") {
        setMessage(response.message);
        void revalidateSettingsState();
      } else if (response.status === "error") {
        setError(response.error);
      } else {
        setMessage("Codex auth setup state refreshed.");
        void revalidateSettingsState();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Failed to refresh Codex auth.");
      }
    } finally {
      authPollControllers.delete(controller);
    }
  };

  const deleteOpenAiAuth = async (): Promise<void> => {
    setPending("openai-auth");
    setError("");
    setMessage("");
    try {
      const response = await submitDeleteOpenAiAuth({
        confirm: (text) =>
          typeof window === "undefined" ? false : window.confirm(text),
      });
      if (response !== undefined) {
        setCodexAuth({
          status: "disabled",
          provider: "codex",
          reason: "logged_out",
        });
        setMessage("Codex auth was deleted.");
        void revalidateSettingsState();
      }
    } catch {
      setError("Failed to delete OpenAI auth.");
    } finally {
      setPending("");
    }
  };

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
              disabled={pending() === "language"}
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
              disabled={pending() === "language"}
              type="submit"
            >
              Save language
            </button>
          </div>
        </form>

        <form class={fieldClass} onSubmit={saveCodexDefaults}>
          <div class="grid gap-2">
            <h2 class={labelClass}>Codex Translation</h2>
          </div>
          <label class="grid gap-2">
            <span class={labelClass}>Model</span>
            <select
              class={selectClass}
              disabled={pending() === "codex-defaults"}
              value={codexModel()}
              onChange={(event) => setCodexModel(event.currentTarget.value)}
            >
              <option value="">Codex app-server default</option>
              <Show
                when={
                  codexModel() !== "" &&
                  !codexModels().some((model) =>
                    model.id === codexModel() || model.model === codexModel()
                  )
                }
              >
                <option value={codexModel()}>{codexModel()}</option>
              </Show>
              <For each={codexModels()}>
                {(model) => (
                  <option value={model.model}>
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
              disabled={pending() === "codex-defaults"}
              value={codexEffort()}
              onChange={(event) =>
                setCodexEffort(
                  event.currentTarget.value as CodexReasoningEffort | "",
                )
              }
            >
              <option value="">Selected model default</option>
              <Show
                when={
                  codexEffort() !== "" &&
                  !reasoningEfforts().includes(codexEffort() as CodexReasoningEffort)
                }
              >
                <option value={codexEffort()}>{codexEffort()}</option>
              </Show>
              <For each={reasoningEfforts()}>
                {(effort) => <option value={effort}>{effort}</option>}
              </For>
            </select>
          </label>
          <div>
            <button
              class={primaryButtonClass}
              disabled={pending() === "codex-defaults"}
              type="submit"
            >
              Save Codex defaults
            </button>
          </div>
          <Show when={codexCatalogError()}>
            {(value) => <p class={hintClass}>{value()}</p>}
          </Show>
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
                pending() === "openai-auth"
              }
              type="button"
              onClick={() => void enableOpenAiAuth()}
            >
              {codexAuth().status === "enabled" ? "Enabled" : "Start setup"}
            </button>
            <Show when={codexAuth().status === "enabled"}>
              <button
                class={dangerButtonClass}
                disabled={pending() === "openai-auth"}
                type="button"
                onClick={() => void deleteOpenAiAuth()}
              >
                Delete auth
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
              <a
                class="text-sm font-bold text-trauma-link"
                href={pendingAuth().verificationUrl}
                rel="noreferrer"
                target="_blank"
              >
                {pendingAuth().verificationUrl}
              </a>
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
            <p class="mb-0 rounded-lg border border-trauma-border bg-trauma-bg-base px-3 py-2 text-sm font-bold text-trauma-text-secondary">
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
