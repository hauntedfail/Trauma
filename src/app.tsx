import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { AppShell } from "./components/shell/AppShell";
import "./styles/tailwind.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Trauma</Title>
          <Suspense>
            <AppShell>{props.children}</AppShell>
          </Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
