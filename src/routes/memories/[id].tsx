import { Title } from "@solidjs/meta";
import { createAsync, query, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";

import { MemoryReader } from "../../components/reader/MemoryReader";
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
      <Title>{titleForResult(readerResult())}</Title>
      <ReaderStatusCode result={readerResult()} />
      <ReaderBody result={readerResult()} />
    </>
  );
}

function ReaderBody(props: { result: ReaderMemoryResult | undefined }) {
  if (props.result === undefined) {
    return (
      <section class="reader-page" aria-labelledby="reader-loading-title">
        <div class="reader-state">
          <h1 id="reader-loading-title">Loading memory...</h1>
        </div>
      </section>
    );
  }

  return <MemoryReader result={props.result} />;
}

function ReaderStatusCode(props: { result: ReaderMemoryResult | undefined }) {
  if (props.result?.status === "not_found" || props.result?.status === "content_missing") {
    return <HttpStatusCode code={404} />;
  }

  if (props.result?.status === "unavailable") {
    return <HttpStatusCode code={503} />;
  }

  return null;
}

function titleForResult(result: ReaderMemoryResult | undefined) {
  if (result?.status === "ready") {
    return `${result.memory.title} | Trauma`;
  }

  return "Memory | Trauma";
}
