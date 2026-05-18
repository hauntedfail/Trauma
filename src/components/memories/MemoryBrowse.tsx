import { Title } from "@solidjs/meta";
import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";

import { FlashbackExcerpt } from "../flashbacks/FlashbackExcerpt";
import { OpenIcon, PlusIcon } from "../icons";
import {
  buildBrowseHref,
  filterBrowseMemories,
  getMemoryDisplayFlashback,
  parseBrowseQuery,
  type BrowseTaxonomyItem,
  type BrowseMemory,
} from "./browse-data";
import { buildMemoryAnchorHref } from "./memory-anchor-hrefs";
import {
  getBrowseMemories,
  revalidateBrowseMemoryWorkspace,
} from "./browse-loader";
import { WaxSealButton, WaxSealLabel } from "../ui/WaxSealButton";
import { formatCapturedAtForDisplay } from "./captured-at";
import { MemoryActionMenu } from "./MemoryActionMenu";
import { MemoryReadStatusControl } from "./MemoryReadStatusControl";
import { MemorySearchBar } from "./MemorySearchBar";
import { TaxonomyCreatePopover } from "./TaxonomyCreatePopover";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  isBackupFailsafeMemoryActionError,
} from "./memory-action-requests";
import { revalidateFlashbackBrowseRows } from "../flashbacks/flashbacks-loader";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "../reader/reader-memory-loader";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
export {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  isBackupFailsafeMemoryActionError,
} from "./memory-action-requests";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-memory-browse-header trauma-fluid-route-padding sticky top-0 z-[1] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const controlButton =
  "min-h-[38px] rounded-full border border-trauma-border-strong px-3 py-2 font-bold";
const cardBase =
  "trauma-memory-card trauma-route-row grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";
const cardTitle = "mb-0 text-xl font-bold leading-tight text-trauma-text-primary";
const subduedText = "mb-0 text-[13px] text-trauma-text-muted";

export function MemoryBrowse() {
  const location = useLocation();
  const navigate = useNavigate();
  const memories = createAsync(() => getBrowseMemories());
  const browseMemories = createMemo(() => memories() ?? []);
  const query = createMemo(() => parseBrowseQuery(location.search));
  const [removedMemoryIds, setRemovedMemoryIds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const visibleMemories = createMemo(() =>
    browseMemories().filter((memory) => !removedMemoryIds().has(memory.id)),
  );
  const filteredMemories = createMemo(() => filterBrowseMemories(visibleMemories(), query()));
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
        <div class="min-w-0">
          <h1 class="mb-0 truncate text-3xl font-bold leading-tight" id="memories-title">
            Memories
            <span class="ml-2 align-middle text-sm font-medium text-trauma-text-muted" aria-hidden="true">
              {filteredMemories().length}{" "}
              {filteredMemories().length === 1 ? "memory" : "memories"}
            </span>
          </h1>
        </div>
        <div class="grid w-[152px] grid-cols-[72px_72px] gap-2 justify-self-end" role="group" aria-label="View mode">
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
      <MemorySearchBar disabled={!isClientReady()} />
      <Show
        when={filteredMemories().length > 0}
        fallback={
          <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">No matching memories</h2>
            <p>Adjust the search, category, tag, or flashback filter.</p>
          </div>
        }
      >
        <div class={isGrid() ? "trauma-memory-list memory-grid trauma-memory-grid grid grid-cols-2" : "trauma-memory-list grid"}>
          <For each={filteredMemories()}>
            {(memory) => (
              <MemoryItem
                memory={memory}
                selectedFlashbackId={query().flashback}
                view={query().view}
                onOpen={(href) => navigate(href)}
                onDeleted={(memoryId) =>
                  setRemovedMemoryIds((current) => new Set([...current, memoryId]))
                }
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

export function MemoryItem(props: {
  memory: BrowseMemory;
  selectedFlashbackId: string;
  view: "list" | "grid";
  onOpen?: (href: string) => void;
  onDeleted?: (memoryId: string) => void;
}) {
  const displayFlashback = createMemo(() => getMemoryDisplayFlashback(props.memory, props.selectedFlashbackId));
  const host = createMemo(() => getHostLabel(props.memory.url));
  const initial = createMemo(() => host().charAt(0).toLocaleUpperCase());
  const [tags, setTags] = createSignal<BrowseTaxonomyItem[]>(props.memory.tags);
  const [categories, setCategories] = createSignal<BrowseTaxonomyItem[]>(
    props.memory.categories,
  );
  const [tagPopoverOpen, setTagPopoverOpen] = createSignal(false);
  const [actionError, setActionError] = createSignal("");
  const href = createMemo(() =>
    buildMemoryAnchorHref({
      anchorId:
        props.selectedFlashbackId.length > 0 &&
        displayFlashback()?.id === props.selectedFlashbackId
          ? props.selectedFlashbackId
          : null,
      memoryId: props.memory.id,
    }),
  );

  const openMemory = (): void => {
    if (props.onOpen !== undefined) {
      props.onOpen(href());
      return;
    }

    if (typeof window !== "undefined") {
      window.location.href = href();
    }
  };

  const submitTag = async (name: string): Promise<void> => {
    setActionError("");
    try {
      const tag = await attachTagToMemoryByName({
        memoryId: props.memory.id,
        name,
      });
      setTags((current) => mergeTaxonomyItem(current, tag));
      setTagPopoverOpen(false);
      void revalidateAfterTaxonomyChange(props.memory.id);
    } catch {
      setActionError("Failed to add tag.");
    }
  };

  const submitCategory = async (input: {
    memoryId: string;
    name: string;
  }): Promise<void> => {
    setActionError("");
    try {
      const category = await attachCategoryToMemoryByName(input);
      setCategories((current) => mergeTaxonomyItem(current, category));
      void revalidateAfterTaxonomyChange(input.memoryId);
    } catch {
      setActionError("Failed to add category.");
    }
  };

  const deleteMemory = async (memoryId: string): Promise<void> => {
    setActionError("");
    try {
      await deleteBrowseMemory({ memoryId });
      props.onDeleted?.(memoryId);
      void revalidateAfterMemoryDeletion(memoryId);
    } catch (error) {
      if (isBackupFailsafeMemoryActionError(error)) {
        void revalidateBackupFailsafeAlert();
      }
      setActionError("Failed to delete memory.");
      throw error;
    }
  };

  return (
    <article
      class={`${cardBase} cursor-pointer no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent ${props.view === "grid" ? "min-h-[310px] border-r border-trauma-border" : ""}`}
      data-popup-dismiss-only
      onClick={(event) => {
        if (!isInteractiveTarget(event.target)) {
          openMemory();
        }
      }}
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
              <time dateTime={props.memory.capturedAt}>{formatCapturedAtForDisplay(props.memory.capturedAt)}</time>
            </p>
            <h2 class={cardTitle}>
              <a
                aria-label={`Open memory ${props.memory.title}`}
                class="text-trauma-text-primary no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trauma-accent"
                href={href()}
                onClick={(event) => event.stopPropagation()}
              >
                {props.memory.title}
              </a>
            </h2>
          </div>
          <div class="flex items-start gap-2">
            <MemoryReadStatusControl
              memoryId={props.memory.id}
              initialRead={props.memory.read}
              variant="icon"
              onSaved={() => revalidateAfterReadStatusChange(props.memory.id)}
            />
            <MemoryActionMenu
              memoryId={props.memory.id}
              memoryTitle={props.memory.title}
              onDelete={deleteMemory}
              onAttachCategoryByName={submitCategory}
            />
          </div>
        </header>
        <p class="mb-0 leading-relaxed text-trauma-text-secondary">{props.memory.description}</p>
        <a
          class={`${subduedText} wrap-anywhere inline-flex items-center gap-1.5 no-underline hover:text-trauma-accent`}
          href={props.memory.url}
          rel="noreferrer"
          target="_blank"
          onClick={(event) => event.stopPropagation()}
        >
          <OpenIcon />
          {props.memory.url}
        </a>
        <Show when={displayFlashback()}>
          {(flashback) => (
            <FlashbackExcerpt
              prefix={flashback().prefix}
              suffix={flashback().suffix}
              text={flashback().text}
            />
          )}
        </Show>
        <footer class="grid gap-3">
          <div class="trauma-local-wrap" aria-label={`${props.memory.title} filters`}>
            <TaxonomyList
              class="contents"
              items={categories()}
              kind="category"
              mode="chips"
            />
            <TaxonomyList
              class="contents"
              items={tags()}
              kind="tag"
              mode="chips"
            />
            <Show when={props.memory.extractionStatus === "link_only"}>
              <span class="inline-flex items-center gap-1 rounded-full bg-trauma-accent-soft px-2.5 py-1 text-xs font-bold text-trauma-accent-soft-ink">
                <span aria-hidden="true">!</span>
                Link-only
              </span>
            </Show>
            <span class="relative inline-grid">
              <button
                class="inline-flex items-center gap-1 rounded-full border border-dashed border-trauma-border-strong px-2.5 py-1 text-xs font-bold text-trauma-text-muted hover:text-trauma-text-primary"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTagPopoverOpen(true);
                }}
              >
                <PlusIcon />
                Add tag
              </button>
              <Show when={tagPopoverOpen()}>
                <TaxonomyCreatePopover
                  title="Add tag"
                  label="Tag name"
                  placeholder="sqlite"
                  submitLabel="Add tag"
                  onSubmitName={submitTag}
                  onClose={() => setTagPopoverOpen(false)}
                />
              </Show>
            </span>
          </div>
          <Show when={actionError() !== ""}>
            <p class="mb-0 text-xs font-bold text-trauma-danger">{actionError()}</p>
          </Show>
        </footer>
      </div>
    </article>
  );
}

async function revalidateAfterReadStatusChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterTaxonomyChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterMemoryDeletion(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateFlashbackBrowseRows(),
    revalidateMomentBrowseRows(),
    revalidateReaderMemory(memoryId),
  ]);
}

function getHostLabel(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function mergeTaxonomyItem(
  current: BrowseTaxonomyItem[],
  next: BrowseTaxonomyItem,
): BrowseTaxonomyItem[] {
  if (current.some((item) => item.id === next.id)) {
    return current;
  }
  return [...current, next];
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? target.closest("a,button,input,select,textarea,[role='menu']") !== null
    : false;
}
