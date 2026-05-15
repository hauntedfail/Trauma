import { Show, createSignal, type JSX } from "solid-js";

import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "../../settings/languages";
import type { SettingsState } from "../../server/settings/settings";
import {
  submitDeleteOpenAiAuth,
  submitEnableOpenAiAuth,
  submitTranslationTargetLanguage,
} from "./settings-submit";
import { revalidateSettingsState } from "./settings-loader";

export interface SettingsPageProps {
  initialSettings: SettingsState;
}

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const headerClass =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
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
  const [openAiAuthStatus, setOpenAiAuthStatus] = createSignal(
    props.initialSettings.openaiAuth.status,
  );
  const [pending, setPending] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");

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

  const enableOpenAiAuth = async (): Promise<void> => {
    setPending("openai-auth");
    setError("");
    setMessage("");
    try {
      const response = await submitEnableOpenAiAuth();
      setOpenAiAuthStatus(response.status);
      setMessage(response.message ?? "OpenAI auth is enabled.");
      void revalidateSettingsState();
    } catch {
      setError("Failed to enable OpenAI auth.");
    } finally {
      setPending("");
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
        setOpenAiAuthStatus(response.status);
        setMessage("OpenAI auth was deleted.");
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
      <header class={headerClass}>
        <p class="mb-2 text-sm font-extrabold uppercase text-trauma-text-muted">
          Settings
        </p>
        <h1 class="mb-0 text-[32px] font-extrabold text-trauma-text-primary">
          Workspace settings
        </h1>
      </header>
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

        <section class={fieldClass} aria-labelledby="openai-auth-title">
          <div class="grid gap-2">
            <h2 class={labelClass} id="openai-auth-title">
              OpenAI Auth
            </h2>
            <p class={hintClass}>
              OpenAI auth state is stored separately from non-secret settings.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              class={secondaryButtonClass}
              disabled={
                openAiAuthStatus() === "enabled" ||
                pending() === "openai-auth"
              }
              type="button"
              onClick={() => void enableOpenAiAuth()}
            >
              {openAiAuthStatus() === "enabled" ? "Enabled" : "Enable"}
            </button>
            <Show when={openAiAuthStatus() === "enabled"}>
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
          <Show when={openAiAuthStatus() === "enabled"}>
            <p class={hintClass}>OpenAI auth is enabled.</p>
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
