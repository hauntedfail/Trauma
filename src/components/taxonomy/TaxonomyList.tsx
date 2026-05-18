import { For, Show } from "solid-js";

import { ButtonHint } from "../ui/ButtonHint";

export interface TaxonomyListItem {
  id: string;
  name: string;
  memoryCount?: number;
}

export interface TaxonomyListProps<TItem extends TaxonomyListItem = TaxonomyListItem> {
  activeId?: string;
  activeIds?: readonly string[];
  class?: string;
  density?: "compact" | "regular";
  emptyLabel?: string;
  items: readonly TItem[];
  kind: "category" | "tag";
  mode: "chips" | "filters";
  onSelect?: (item: TItem) => void;
}

const chipClass =
  "rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-1 text-xs font-bold text-trauma-chip-ink";
const interactiveChipClass = `${chipClass} hover:border-trauma-border-strong hover:text-trauma-text-primary aria-pressed:border-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`;
const filterClass =
  "grid min-h-[38px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-trauma-border bg-transparent px-3 py-2 text-left font-bold text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink";

export function TaxonomyList<TItem extends TaxonomyListItem>(
  props: TaxonomyListProps<TItem>,
) {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <Show when={props.emptyLabel}>
          {(label) => (
            <p class="mb-0 text-sm font-bold text-trauma-text-muted">
              {label()}
            </p>
          )}
        </Show>
      }
    >
      <div class={props.class ?? getListClass(props.mode, props.density)}>
        <For each={props.items}>
          {(item) => (
            <TaxonomyListItemView
              active={
                props.activeId === item.id ||
                props.activeIds?.includes(item.id) === true
              }
              item={item}
              kind={props.kind}
              mode={props.mode}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

function getListClass(
  mode: TaxonomyListProps["mode"],
  density: TaxonomyListProps["density"],
): string {
  if (mode === "filters") {
    return "grid gap-2";
  }

  return density === "compact"
    ? "flex flex-wrap items-center gap-x-1.5 gap-y-1.5"
    : "trauma-local-wrap";
}

function TaxonomyListItemView<TItem extends TaxonomyListItem>(props: {
  active: boolean;
  item: TItem;
  kind: "category" | "tag";
  mode: "chips" | "filters";
  onSelect?: (item: TItem) => void;
}) {
  const label = () =>
    props.kind === "tag" && props.mode === "chips"
      ? `#${props.item.name}`
      : props.item.name;

  if (props.mode === "chips") {
    if (props.onSelect === undefined) {
      return <span class={chipClass}>{label()}</span>;
    }

    return (
      <button
        aria-pressed={props.active}
        class={interactiveChipClass}
        data-trauma-hint={label()}
        type="button"
        onClick={() => props.onSelect?.(props.item)}
      >
        {label()}
        <ButtonHint>{label()}</ButtonHint>
      </button>
    );
  }

  return (
    <button
      aria-pressed={props.onSelect === undefined ? undefined : props.active}
      class={filterClass}
      data-trauma-hint={label()}
      type="button"
      onClick={() => props.onSelect?.(props.item)}
    >
      <span class="min-w-0 truncate">{label()}</span>
      <Show when={props.item.memoryCount !== undefined}>
        <span
          class={`text-xs font-bold ${
            props.active ? "text-trauma-accent-ink" : "text-trauma-text-muted"
          }`}
        >
          {formatMemoryCount(props.item.memoryCount ?? 0)}
        </span>
      </Show>
      <ButtonHint>{label()}</ButtonHint>
    </button>
  );
}

function formatMemoryCount(count: number): string {
  return count === 1 ? "1 memory" : `${count} memories`;
}
