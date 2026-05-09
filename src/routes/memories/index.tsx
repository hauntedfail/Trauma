import { Title } from "@solidjs/meta";

export default function MemoriesIndex() {
  return (
    <section class="timeline" aria-labelledby="memories-title">
      <Title>Memories | Trauma</Title>
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Local memory archive</p>
          <h1 id="memories-title">Memories</h1>
        </div>
        <div class="view-toggle" aria-label="View mode">
          <button type="button" aria-pressed="true">
            List
          </button>
          <button type="button" disabled>
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
      <div class="empty-state">
        <h2>No memories yet</h2>
        <p>The importer, markdown store, and SQLite metadata layer will be added in follow-up tasks.</p>
      </div>
    </section>
  );
}
