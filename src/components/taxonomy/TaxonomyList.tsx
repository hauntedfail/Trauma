import { For, Show } from "solid-js";

export interface TaxonomyListItem {
  id: string;
  name: string;
  memoryCount?: number;
}

export interface TaxonomyListProps<TItem extends TaxonomyListItem = TaxonomyListItem> {
  activeId?: string;
  class?: string;
  emptyLabel?: string;
  items: readonly TItem[];
  kind: "category" | "tag";
  mode: "chips" | "filters";
  onSelect?: (item: TItem) => void;
}

const chipClass =
  "rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-1 text-xs font-bold text-trauma-chip-ink";
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
      <div class={props.class ?? (props.mode === "chips" ? "trauma-local-wrap" : "grid gap-2")}>
        <For each={props.items}>
          {(item) => (
            <TaxonomyListItemView
              active={props.activeId === item.id}
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
        class={chipClass}
        type="button"
        onClick={() => props.onSelect?.(props.item)}
      >
        {label()}
      </button>
    );
  }

  return (
    <button
      aria-pressed={props.onSelect === undefined ? undefined : props.active}
      class={filterClass}
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
    </button>
  );
}

function formatMemoryCount(count: number): string {
  return count === 1 ? "1 memory" : `${count} memories`;
}
