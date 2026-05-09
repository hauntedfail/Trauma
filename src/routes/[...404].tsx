import { Title } from "@solidjs/meta";
import { HttpStatusCode } from "@solidjs/start";

export default function NotFound() {
  return (
    <section class="timeline" aria-labelledby="not-found-title">
      <Title>Not found | Trauma</Title>
      <HttpStatusCode code={404} />
      <div class="empty-state">
        <h1 id="not-found-title">Page not found</h1>
        <p>This route is not part of the current Trauma foundation.</p>
      </div>
    </section>
  );
}
