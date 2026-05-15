import { Title } from "@solidjs/meta";
import { HttpStatusCode } from "@solidjs/start";

export default function NotFound() {
  return (
    <section class="trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface px-8 py-12 max-[720px]:px-5" aria-labelledby="not-found-title">
      <Title>Not found | TRAUMA</Title>
      <HttpStatusCode code={404} />
      <div class="text-trauma-text-secondary">
        <h1 class="text-3xl font-bold text-trauma-text-primary" id="not-found-title">Page not found</h1>
        <p>This route is not part of the current Trauma foundation.</p>
      </div>
    </section>
  );
}
