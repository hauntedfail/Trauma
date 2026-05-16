import { Title } from "@solidjs/meta";
import { createAsync, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { Show } from "solid-js";

import { MemoryReader } from "../../components/reader/MemoryReader";
import { getReaderMemory } from "../../components/reader/reader-memory-loader";
import { readerFrame, readerStatePanel } from "../../components/reader/reader-styles";
import {
  readerHttpStatusCode,
  titleForReaderResult,
} from "../../components/reader/route-state";
import type { ReaderMemoryResult } from "../../server/reader/page-data";

export default function MemoryReaderRoute() {
  const params = useParams();
  const result = createAsync(() => getReaderMemory(params.id ?? ""));
  const readerResult = () => result();

  return (
    <>
      <Title>{titleForReaderResult(readerResult())}</Title>
      <ReaderStatusCode result={readerResult()} />
      <ReaderBody result={readerResult()} />
    </>
  );
}

function ReaderBody(props: { result: ReaderMemoryResult | undefined }) {
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
      {(result) => <MemoryReader result={result()} />}
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
