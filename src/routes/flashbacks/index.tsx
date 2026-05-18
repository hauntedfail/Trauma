import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";

import {
  deleteFlashbackBySelection,
  FlashbackActionMenu,
  type FlashbackActionMenuItem,
} from "~/components/flashbacks/FlashbackActionMenu";
import { FlashbackInlineText } from "~/components/flashbacks/FlashbackText";
import {
  getFlashbackBrowseRows,
  revalidateFlashbackBrowseRows,
} from "~/components/flashbacks/flashbacks-loader";
import { classifyFlashbackRows } from "~/components/flashbacks/route-state";
import { buildMemoryAnchorHref } from "~/components/memories/memory-anchor-hrefs";
import { revalidateBrowseMemoryWorkspace } from "~/components/memories/browse-loader";
import { revalidateReaderMemory } from "~/components/reader/reader-memory-loader";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const cardBase =
  "trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

export default function FlashbacksIndex() {
  const flashbacks = createAsync(() => getFlashbackBrowseRows());
  const [removedFlashbackIds, setRemovedFlashbackIds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const flashbackRowsState = () => classifyFlashbackRows(flashbacks());
  const readyFlashbackRows = createMemo(() => {
    const state = flashbackRowsState();
    if (state.status !== "ready") {
      return undefined;
    }

    return state.rows.filter((row) => !removedFlashbackIds().has(row.id));
  });
  const deleteFlashback = async (flashback: FlashbackActionMenuItem) => {
    await deleteFlashbackBySelection({ flashback });
    setRemovedFlashbackIds((current) => new Set([...current, flashback.id]));
    await Promise.all([
      revalidateFlashbackBrowseRows(),
      revalidateBrowseMemoryWorkspace(),
      revalidateReaderMemory(flashback.memoryId),
    ]);
  };

  return (
    <section class={pageFrame} aria-labelledby="flashbacks-title">
      <Title>Flashbacks | TRAUMA</Title>
      <header class={pageHeader}>
        <div>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="flashbacks-title">
            Flashbacks
          </h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={flashbackRowsState().status === "loading"}
          fallback={
            <Show
              when={readyFlashbackRows()}
              fallback={
                <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
                  <h2 class="text-xl font-bold text-trauma-text-primary">No flashbacks yet</h2>
                  <p>Saved reader flashbacks will appear here.</p>
                </div>
              }
            >
              {(rows) => (
                <For each={rows()}>
                  {(flashback) => (
                    <article class={cardBase}>
                      <a
                        class="grid min-w-0 gap-2 no-underline"
                        href={buildMemoryAnchorHref({
                          anchorId: flashback.id,
                          memoryId: flashback.memoryId,
                        })}
                      >
                        <FlashbackInlineText
                          class="text-base"
                          prefix={flashback.prefix}
                          suffix={flashback.suffix}
                          text={flashback.text}
                        />
                        <footer class="flex flex-wrap gap-2 text-xs font-bold text-trauma-text-muted">
                          <span>{flashback.memoryTitle}</span>
                        </footer>
                      </a>
                      <div class="pt-0.5">
                        <FlashbackActionMenu
                          flashback={flashback}
                          onDelete={deleteFlashback}
                        />
                      </div>
                    </article>
                  )}
                </For>
              )}
            </Show>
          }
        >
          <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">Loading flashbacks...</h2>
          </div>
        </Show>
      </div>
    </section>
  );
}
