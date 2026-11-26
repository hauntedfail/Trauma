import { Show, type JSX } from "solid-js";

export interface RouteStateProps {
  children?: JSX.Element;
  class?: string;
  dataAttribute?: Record<string, string>;
  message?: string;
  role?: "alert" | "status";
  title?: string;
}

export function RouteState(props: RouteStateProps) {
  return (
    <div
      class={`trauma-route-row trauma-route-state px-6 py-12 text-trauma-text-secondary ${props.class ?? ""}`}
      role={props.role}
      {...(props.dataAttribute ?? {})}
    >
      <Show when={props.title}>
        {(title) => (
          <h2 class="mb-0 text-base font-semibold text-trauma-text-primary">
            {title()}
          </h2>
        )}
      </Show>
      <Show when={props.message}>
        {(message) => (
          <p class={`mb-0 text-sm text-trauma-text-secondary ${props.title ? "mt-1.5" : ""}`}>
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.children}>
        <div class="mt-3">{props.children}</div>
      </Show>
    </div>
  );
}
