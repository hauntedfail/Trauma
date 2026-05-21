import { Title } from "@solidjs/meta";
import { createAsync, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { Show } from "solid-js";

import { getBrowseTaxonomy } from "../../../components/memories/browse-loader";
import type { BrowseTaxonomySummaryItem } from "../../../components/memories/browse-data";
import { MemoryReader } from "../../../components/reader/MemoryReader";
import { getReaderMemory } from "../../../components/reader/reader-memory-loader";
import {
  readerFrame,
  readerStatePanel,
} from "../../../components/reader/reader-styles";
import {
  readerHttpStatusCode,
  titleForReaderResult,
} from "../../../components/reader/route-state";
import type { ReaderMemoryResult } from "../../../server/reader/page-data";
import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "../../../server/translation/languages";

export default function TranslatedMemoryReaderRoute() {
  const params = useParams();
  const langCode = (): SupportedLanguageCode | undefined => {
    const value = params.langCode ?? "";
    return isSupportedLanguageCode(value) ? value : undefined;
  };
  const result = createAsync(() => {
    const language = langCode();
    if (language === undefined) {
      return Promise.resolve({
        status: "not_found",
        message: "Translated memory was not found.",
      } satisfies ReaderMemoryResult);
    }

    return getReaderMemory(params.id ?? "", language);
  });
  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const readerResult = () => result();

  return (
    <>
      <Title>{titleForReaderResult(readerResult())}</Title>
      <ReaderStatusCode result={readerResult()} />
      <ReaderBody
        categoryOptions={taxonomy()?.categories ?? []}
        result={readerResult()}
        tagOptions={taxonomy()?.tags ?? []}
      />
    </>
  );
}

function ReaderBody(props: {
  categoryOptions: readonly BrowseTaxonomySummaryItem[];
  result: ReaderMemoryResult | undefined;
  tagOptions: readonly BrowseTaxonomySummaryItem[];
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
