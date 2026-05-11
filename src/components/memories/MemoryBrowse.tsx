import { Title } from "@solidjs/meta";
import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";

import {
  buildBrowseHref,
  filterBrowseMemories,
  getMemoryDisplayHighlight,
  parseBrowseQuery,
  type BrowseMemory,
} from "./browse-data";
import { AddMemoryForm } from "./AddMemoryForm";
import { getBrowseMemories } from "./browse-loader";

const pageFrame =
  "mx-auto min-h-screen w-[min(100%,840px)] border-x border-trauma-border bg-white max-[720px]:min-h-[calc(100vh-58px)] max-[720px]:border-x-0";
const pageHeader =
  "flex items-center justify-between gap-4 border-b border-trauma-border p-6 max-[720px]:flex-col max-[720px]:items-start max-[720px]:p-5 max-[720px]:px-4";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const controlButton =
  "min-h-[38px] rounded-lg border border-[#b8c4b1] px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-[#b8c4b1] bg-trauma-bg-surface px-3 text-trauma-text-primary";
const cardBase =
  "grid min-w-0 gap-3 border-b border-trauma-border px-6 py-[22px] max-[720px]:px-4";
const cardTitle = "mb-0 text-xl font-bold leading-tight";
const subduedText = "mb-0 text-[13px] text-trauma-text-muted";
const highlightQuote =
  "m-0 grid gap-1 border-l-[3px] border-[#c57b57] bg-[#fff8ee] px-3 py-2.5 leading-normal text-[#59483d]";
const highlightMark =
  "w-fit rounded px-1 py-px bg-[#ffe2a8] text-[#3d2b12]";

export function MemoryBrowse() {
  const location = useLocation();
  const navigate = useNavigate();
  const memories = createAsync(() => getBrowseMemories());
  const browseMemories = createMemo(() => memories() ?? []);
  const query = createMemo(() => parseBrowseQuery(location.search));
  const filteredMemories = createMemo(() => filterBrowseMemories(browseMemories(), query()));
  const isGrid = createMemo(() => query().view === "grid");
  const [isClientReady, setIsClientReady] = createSignal(false);

  const updateQuery = (patch: Parameters<typeof buildBrowseHref>[1], options: { replace?: boolean } = {}) => {
    navigate(buildBrowseHref(query(), patch), { replace: options.replace });
  };

  onMount(() => setIsClientReady(true));

  return (
    <section class={pageFrame} aria-labelledby="memories-title">
      <Title>Memories | Trauma</Title>
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Local memory archive</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="memories-title">Memories</h1>
        </div>
        <div class="grid w-[152px] grid-cols-[72px_72px] gap-2" role="group" aria-label="View mode">
          <button class={`${controlButton} w-[72px] bg-white text-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-white`} type="button" aria-pressed={!isGrid()} onClick={() => updateQuery({ view: "list" })}>
            List
          </button>
          <button class={`${controlButton} w-[72px] bg-white text-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-white`} type="button" aria-pressed={isGrid()} onClick={() => updateQuery({ view: "grid" })}>
            Grid
          </button>
        </div>
      </header>
      <AddMemoryForm
        formClass="grid grid-cols-[minmax(0,1fr)_128px] gap-3 border-b border-trauma-border px-6 py-5 max-[720px]:grid-cols-1 max-[720px]:px-4"
        inputClass={surfaceInput}
        buttonClass={`${controlButton} w-full bg-trauma-accent text-white`}
        submitLabel="Add memory"
        showVisibleLabel={false}
      />
      <div class="border-b border-trauma-border px-6 py-[18px] max-[720px]:px-4">
        <label class="grid gap-2">
          <span class="text-[13px] font-extrabold text-[#4e5a48]">Search memories</span>
          <input
            class={surfaceInput}
            disabled={!isClientReady()}
            type="search"
            value={query().q}
            placeholder="Title, URL, tags, or highlights"
            onInput={(event) => updateQuery({ q: event.currentTarget.value }, { replace: true })}
          />
        </label>
      </div>
      <Show
        when={filteredMemories().length > 0}
        fallback={
          <div class="px-6 py-12 text-[#5f6b5a]">
            <h2 class="text-xl font-bold text-trauma-text-primary">No matching memories</h2>
            <p>Adjust the search, category, tag, or highlight filter.</p>
          </div>
        }
      >
        <div class={isGrid() ? "memory-grid grid grid-cols-2 max-[720px]:grid-cols-1" : "grid"}>
          <For each={filteredMemories()}>
            {(memory) => (
              <MemoryItem memory={memory} selectedHighlightId={query().highlight} view={query().view} />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function MemoryItem(props: { memory: BrowseMemory; selectedHighlightId: string; view: "list" | "grid" }) {
  const displayHighlight = createMemo(() => getMemoryDisplayHighlight(props.memory, props.selectedHighlightId));

  return (
    <article class={`${cardBase} ${props.view === "grid" ? "min-h-[290px] border-r border-trauma-border max-[720px]:min-h-0 max-[720px]:border-r-0" : ""}`}>
      <header class="flex items-start justify-between gap-4 max-[720px]:grid">
        <div>
          <p class={subduedText}>{props.memory.capturedAt}</p>
          <h2 class={cardTitle}>{props.memory.title}</h2>
        </div>
        <a class="shrink-0 rounded-lg bg-trauma-accent-soft px-2.5 py-2 text-[13px] font-extrabold text-[#1f3a22]" href={`/memories/${props.memory.id}`}>Open</a>
      </header>
      <p class={`${subduedText} wrap-anywhere`}>{props.memory.url}</p>
      <p class="mb-0 leading-relaxed">{props.memory.description}</p>
      <div class="flex flex-wrap gap-2" aria-label={`${props.memory.title} filters`}>
        <For each={props.memory.categories}>{(category) => <span class="rounded-full border border-[#ccd7c4] bg-[#f3f7ee] px-2.5 py-1 text-xs font-bold text-[#374532]">{category.name}</span>}</For>
        <For each={props.memory.tags}>{(tag) => <span class="rounded-full border border-[#ccd7c4] bg-[#f3f7ee] px-2.5 py-1 text-xs font-bold text-[#374532]">#{tag.name}</span>}</For>
      </div>
      <Show when={displayHighlight()}>
        {(highlight) => (
          <blockquote class={highlightQuote}>
            <span>{highlight().prefix}</span>
            <mark class={highlightMark}>{highlight().text}</mark>
            <span>{highlight().suffix}</span>
          </blockquote>
        )}
      </Show>
    </article>
  );
}
