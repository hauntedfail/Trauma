import { Title } from "@solidjs/meta";
import { HttpStatusCode } from "@solidjs/start";

export default function NotFound() {
  return (
    <section class="mx-auto min-h-screen w-[min(100%,840px)] border-x border-trauma-border bg-white max-[720px]:min-h-[calc(100vh-58px)] max-[720px]:border-x-0" aria-labelledby="not-found-title">
      <Title>Not found | Trauma</Title>
      <HttpStatusCode code={404} />
      <div class="px-6 py-12 text-[#5f6b5a]">
        <h1 class="text-3xl font-bold text-trauma-text-primary" id="not-found-title">Page not found</h1>
        <p>This route is not part of the current Trauma foundation.</p>
      </div>
    </section>
  );
}
