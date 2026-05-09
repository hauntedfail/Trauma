import { Title } from "@solidjs/meta";
import { useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";

import {
  browseMemories,
  buildBrowseHref,
  filterBrowseMemories,
  parseBrowseQuery,
  type BrowseMemory,
} from "./browse-data";

export function MemoryBrowse() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = createMemo(() => parseBrowseQuery(location.search));
  const filteredMemories = createMemo(() => filterBrowseMemories(browseMemories, query()));
  const isGrid = createMemo(() => query().view === "grid");

  const updateQuery = (patch: Parameters<typeof buildBrowseHref>[1]) => {
    navigate(buildBrowseHref(query(), patch));
  };

  return (
    <section class="timeline" aria-labelledby="memories-title">
      <Title>Memories | Trauma</Title>
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Local memory archive</p>
          <h1 id="memories-title">Memories</h1>
        </div>
        <div class="view-toggle" role="group" aria-label="View mode">
          <button type="button" aria-pressed={!isGrid()} onClick={() => updateQuery({ view: "list" })}>
            List
          </button>
          <button type="button" aria-pressed={isGrid()} onClick={() => updateQuery({ view: "grid" })}>
            Grid
          </button>
        </div>
      </header>
      <form class="composer-baseline" aria-label="Add memory">
        <input type="url" placeholder="https://example.com/article" disabled />
        <button type="button" disabled>
          Add memory
        </button>
      </form>
      <div class="search-row">
        <label>
          <span>Search memories</span>
          <input
            type="search"
            value={query().q}
            placeholder="Title, URL, tags, or highlights"
            onInput={(event) => updateQuery({ q: event.currentTarget.value })}
          />
        </label>
      </div>
      <Show
        when={filteredMemories().length > 0}
        fallback={
          <div class="empty-state">
            <h2>No matching memories</h2>
            <p>Adjust the search, category, tag, or highlight filter.</p>
          </div>
        }
      >
        <div class={isGrid() ? "memory-grid" : "memory-list"}>
          <For each={filteredMemories()}>{(memory) => <MemoryItem memory={memory} view={query().view} />}</For>
        </div>
      </Show>
    </section>
  );
}

function MemoryItem(props: { memory: BrowseMemory; view: "list" | "grid" }) {
  return (
    <article class="memory-item" data-view={props.view}>
      <header>
        <div>
          <p class="memory-date">{props.memory.capturedAt}</p>
          <h2>{props.memory.title}</h2>
        </div>
        <a href={`/memories/${props.memory.id}`}>Open</a>
      </header>
      <p class="memory-url">{props.memory.url}</p>
      <p>{props.memory.description}</p>
      <div class="memory-meta" aria-label={`${props.memory.title} filters`}>
        <For each={props.memory.categories}>{(category) => <span>{category.name}</span>}</For>
        <For each={props.memory.tags}>{(tag) => <span>#{tag.name}</span>}</For>
      </div>
      <Show when={props.memory.highlights[0]}>
        {(highlight) => (
          <blockquote>
            <span>{highlight().prefix}</span>
            <mark>{highlight().text}</mark>
            <span>{highlight().suffix}</span>
          </blockquote>
        )}
      </Show>
    </article>
  );
}
