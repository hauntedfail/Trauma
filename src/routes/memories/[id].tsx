import { Title } from "@solidjs/meta";
import { createAsync, query, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { Show } from "solid-js";

import { MemoryReader } from "../../components/reader/MemoryReader";
import {
  readerHttpStatusCode,
  titleForReaderResult,
} from "../../components/reader/route-state";
import type { ReaderMemoryResult } from "../../server/reader/page-data";

const getReaderMemory = query(async (memoryId: string) => {
  "use server";
  const { loadReaderMemory } = await import("../../server/reader/page-data");
  return loadReaderMemory(memoryId);
}, "reader-memory");

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
        <section class="reader-page" aria-labelledby="reader-loading-title">
          <div class="reader-state">
            <h1 id="reader-loading-title">Loading memory...</h1>
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
