import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { Show } from "solid-js";

import { SettingsPage } from "~/components/settings/SettingsPage";
import { getSettingsState } from "~/components/settings/settings-loader";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";

export default function SettingsRoute() {
  const settings = createAsync(() => getSettingsState());

  return (
    <>
      <Title>Settings | TRAUMA</Title>
      <Show
        when={settings()}
        fallback={
          <section class={`${pageFrame} trauma-fluid-route-padding py-12`}>
            <p class="mb-0 text-trauma-text-secondary">Loading settings...</p>
          </section>
        }
      >
        {(state) => <SettingsPage initialSettings={state()} />}
      </Show>
    </>
  );
}
