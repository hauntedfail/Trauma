import type { APIEvent } from "@solidjs/start/server";

import {
  encodeServerSentEvent,
  translationEventBus,
} from "~/server/translation/events";
import { readTranslationJobSnapshot } from "~/server/translation/runner";

export async function GET(event: APIEvent): Promise<Response> {
  const jobId = event.params.jobId?.trim();
  if (jobId === undefined || jobId === "") {
    return new Response("jobId must be a non-empty string", { status: 400 });
  }

  const snapshot = await readTranslationJobSnapshot({ jobId });
  if (snapshot === null) {
    return new Response("translation job was not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: string) => {
        controller.enqueue(encoder.encode(message));
      };

      send(
        [
          "event: translation.job.snapshot",
          `data: ${JSON.stringify({
            type: "translation.job.snapshot",
            job_id: snapshot.job_id,
            memory_id: snapshot.memory_id,
            lang_code: snapshot.lang_code,
            chunk_index: null,
            data: snapshot,
          })}`,
          "",
          "",
        ].join("\n"),
      );

      for (const replayed of translationEventBus.getReplay(jobId)) {
        send(encodeServerSentEvent(replayed));
      }

      const unsubscribe = translationEventBus.subscribe(jobId, (translationEvent) => {
        send(encodeServerSentEvent(translationEvent));
      });
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 20_000);
      event.request.signal.addEventListener(
        "abort",
        () => {
          clearInterval(heartbeat);
          unsubscribe();
          controller.close();
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
    status: 200,
  });
}
