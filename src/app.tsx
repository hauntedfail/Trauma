import { Link, MetaProvider, Title } from "@solidjs/meta";
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
          <Title>TRAUMA</Title>
          <Link href="/favicon.ico" rel="icon" type="image/png" />
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
