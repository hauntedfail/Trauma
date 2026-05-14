import { Title } from "@solidjs/meta";
import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";

import { HighlightExcerpt } from "../highlights/HighlightExcerpt";
import { CheckIcon, KebabIcon, OpenIcon, SearchIcon } from "../icons";
import {
  buildBrowseHref,
  filterBrowseMemories,
  getMemoryDisplayHighlight,
  parseBrowseQuery,
  type BrowseMemory,
} from "./browse-data";
import { getBrowseMemories } from "./browse-loader";
import { WaxSealButton, WaxSealLabel } from "../ui/WaxSealButton";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const controlButton =
  "min-h-[38px] rounded-full border border-trauma-border-strong px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 bg-transparent text-trauma-text-primary outline-none placeholder:text-trauma-text-placeholder";
const cardBase =
  "trauma-memory-card trauma-route-row grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";
const cardTitle = "mb-0 text-xl font-bold leading-tight text-trauma-text-primary";
const subduedText = "mb-0 text-[13px] text-trauma-text-muted";
const tagChip =
  "rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-1 text-xs font-bold text-trauma-chip-ink";

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
      <Title>Memories | TRAUMA</Title>
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Local memory archive</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="memories-title">
            Memories
            <span class="ml-2 align-middle text-sm font-medium text-trauma-text-muted" aria-hidden="true">
              {filteredMemories().length}{" "}
              {filteredMemories().length === 1 ? "memory" : "memories"}
            </span>
          </h1>
        </div>
        <div class="grid w-[152px] grid-cols-[72px_72px] gap-2" role="group" aria-label="View mode">
          <WaxSealButton
            aria-pressed={!isGrid()}
            class={`${controlButton} w-[72px] bg-trauma-bg-elev text-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
            type="button"
            variant="toggle"
            onClick={() => updateQuery({ view: "list" })}
          >
            <WaxSealLabel>List</WaxSealLabel>
          </WaxSealButton>
          <WaxSealButton
            aria-pressed={isGrid()}
            class={`${controlButton} w-[72px] bg-trauma-bg-elev text-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
            type="button"
            variant="toggle"
            onClick={() => updateQuery({ view: "grid" })}
          >
            <WaxSealLabel>Grid</WaxSealLabel>
          </WaxSealButton>
        </div>
      </header>
      <div class="trauma-route-row border-b border-trauma-border px-6 py-[18px]">
        <label class="grid min-h-12 grid-cols-[22px_minmax(0,1fr)] items-center gap-3 rounded-full border border-trauma-border bg-trauma-bg-elev px-4 text-trauma-text-muted focus-within:border-trauma-border-strong focus-within:bg-trauma-bg-surface">
          <span class="grid place-items-center">
            <SearchIcon />
          </span>
          <input
            class={surfaceInput}
            disabled={!isClientReady()}
            type="search"
            value={query().q}
            placeholder="Search memories - title, URL, tags, or highlights"
            aria-label="Search memories"
            onInput={(event) => updateQuery({ q: event.currentTarget.value }, { replace: true })}
          />
        </label>
      </div>
      <Show
        when={filteredMemories().length > 0}
        fallback={
          <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">No matching memories</h2>
            <p>Adjust the search, category, tag, or highlight filter.</p>
          </div>
        }
      >
        <div class={isGrid() ? "trauma-memory-list memory-grid trauma-memory-grid grid grid-cols-2" : "trauma-memory-list grid"}>
          <For each={filteredMemories()}>
            {(memory) => (
              <MemoryItem
                memory={memory}
                selectedHighlightId={query().highlight}
                view={query().view}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function MemoryItem(props: {
  memory: BrowseMemory;
  selectedHighlightId: string;
  view: "list" | "grid";
}) {
  const displayHighlight = createMemo(() => getMemoryDisplayHighlight(props.memory, props.selectedHighlightId));
  const host = createMemo(() => getHostLabel(props.memory.url));
  const initial = createMemo(() => host().charAt(0).toLocaleUpperCase());

  return (
    <A
      aria-label={`Open memory ${props.memory.title}`}
      class={`${cardBase} cursor-pointer no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent ${props.view === "grid" ? "min-h-[310px] border-r border-trauma-border" : ""}`}
      href={`/memories/${props.memory.id}`}
    >
      <span class="mt-1 grid size-12 place-items-center rounded-full border border-trauma-border bg-trauma-bg-elev text-lg font-extrabold text-trauma-accent" aria-hidden="true">
        {initial()}
      </span>
      <div class="grid min-w-0 gap-3">
        <header class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div class="min-w-0">
            <p class={subduedText}>
              <span class="font-bold text-trauma-text-primary">{host()}</span>
              <span class="px-1">.</span>
              <time dateTime={props.memory.capturedAt}>{formatCapturedAt(props.memory.capturedAt)}</time>
            </p>
            <h2 class={cardTitle}>{props.memory.title}</h2>
          </div>
          <span
            class="grid size-9 place-items-center rounded-full text-trauma-text-muted"
            aria-hidden="true"
          >
            <KebabIcon />
          </span>
        </header>
        <p class="mb-0 leading-relaxed text-trauma-text-secondary">{props.memory.description}</p>
        <p class={`${subduedText} wrap-anywhere inline-flex items-center gap-1.5`}>
          <OpenIcon />
          {props.memory.url}
        </p>
        <Show when={displayHighlight()}>
          {(highlight) => (
            <HighlightExcerpt
              prefix={highlight().prefix}
              suffix={highlight().suffix}
              text={highlight().text}
            />
          )}
        </Show>
        <div class="trauma-local-wrap" aria-label={`${props.memory.title} filters`}>
          <For each={props.memory.categories}>{(category) => <span class={tagChip}>{category.name}</span>}</For>
          <For each={props.memory.tags}>{(tag) => <span class={tagChip}>#{tag.name}</span>}</For>
          <span class="inline-flex items-center gap-1 rounded-full bg-trauma-accent-soft px-2.5 py-1 text-xs font-bold text-trauma-accent-soft-ink">
            <CheckIcon />
            saved
          </span>
        </div>
      </div>
    </A>
  );
}

function getHostLabel(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatCapturedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
}
