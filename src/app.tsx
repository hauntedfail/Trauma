import { MetaProvider, Title } from "@solidjs/meta";
import { A, Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./styles/app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Trauma</Title>
          <div class="app-shell">
            <aside class="left-nav" aria-label="Primary navigation">
              <A class="brand" href="/memories">
                Trauma
              </A>
              <nav class="nav-links">
                <A href="/memories">Memories</A>
              </nav>
              <button class="add-memory" type="button" disabled>
                Add memory
              </button>
            </aside>
            <main class="content-shell">
              <Suspense>{props.children}</Suspense>
            </main>
            <aside class="right-panel" aria-label="Filters">
              <h2>Filters</h2>
              <p>Categories and tags will appear here.</p>
            </aside>
          </div>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
