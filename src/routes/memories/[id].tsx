import { Title } from "@solidjs/meta";
import { createAsync, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { Show } from "solid-js";

import { MemoryReader } from "../../components/reader/MemoryReader";
import { getReaderMemory } from "../../components/reader/reader-memory-loader";
import { getBrowseTaxonomy } from "../../components/memories/browse-loader";
import {
  getReaderTranslationSettingsState,
} from "../../components/settings/settings-loader";
import type { BrowseTaxonomySummaryItem } from "../../components/memories/browse-data";
import { readerFrame, readerStatePanel } from "../../components/reader/reader-styles";
import {
  readerHttpStatusCode,
  titleForReaderResult,
} from "../../components/reader/route-state";
import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { CodexReasoningEffort } from "../../server/translation/types";
import type { SupportedLanguageCode } from "../../settings/languages";

export default function MemoryReaderRoute() {
  const params = useParams();
  const result = createAsync(() => getReaderMemory(params.id ?? ""));
  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const settings = createAsync(() => getReaderTranslationSettingsState());
  const readerResult = () => result();

  return (
    <>
      <Title>{titleForReaderResult(readerResult())}</Title>
      <ReaderStatusCode result={readerResult()} />
      <ReaderBody
        categoryOptions={taxonomy()?.categories ?? []}
        result={readerResult()}
        tagOptions={taxonomy()?.tags ?? []}
        translationModel={settings()?.codexTranslationModel}
        translationReasoningEffort={settings()?.codexTranslationReasoningEffort}
        translationTargetLanguage={settings()?.translationTargetLanguage}
      />
    </>
  );
}

function ReaderBody(props: {
  categoryOptions: readonly BrowseTaxonomySummaryItem[];
  result: ReaderMemoryResult | undefined;
  tagOptions: readonly BrowseTaxonomySummaryItem[];
  translationModel?: string | null;
  translationReasoningEffort?: CodexReasoningEffort | null;
  translationTargetLanguage?: SupportedLanguageCode;
}) {
  return (
    <Show
      when={props.result}
      fallback={
        <section class={readerFrame} aria-labelledby="reader-loading-title">
          <div class={readerStatePanel}>
            <h1 class="mb-2 text-3xl font-bold text-trauma-text-primary" id="reader-loading-title">Loading memory...</h1>
          </div>
        </section>
      }
    >
      {(result) => (
        <MemoryReader
          categoryOptions={props.categoryOptions}
          result={result()}
          tagOptions={props.tagOptions}
          translationModel={props.translationModel}
          translationReasoningEffort={props.translationReasoningEffort}
          translationTargetLanguage={props.translationTargetLanguage}
        />
      )}
    </Show>
  );
}

function ReaderStatusCode(props: { result: ReaderMemoryResult | undefined }) {
  return (
    <Show when={readerHttpStatusCode(props.result)}>
      {(statusCode) => <HttpStatusCode code={statusCode()} />}
    </Show>
  );
}
