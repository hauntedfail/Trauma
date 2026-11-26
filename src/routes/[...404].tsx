import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";

import { RouteHeader } from "~/components/layout/RouteHeader";
import { RouteState } from "~/components/layout/RouteState";

export default function NotFound() {
  return (
    <section
      class="trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface"
      aria-labelledby="not-found-title"
    >
      <Title>Not found | TRAUMA</Title>
      <HttpStatusCode code={404} />
      <RouteHeader layout="single" title="Page not found" titleId="not-found-title" />
      <div class="trauma-route-column">
        <RouteState message="This route is not part of the current Trauma foundation.">
          <A class="trauma-control" href="/memories?lane=shelf">
            Back to Shelf
          </A>
        </RouteState>
      </div>
    </section>
  );
}
