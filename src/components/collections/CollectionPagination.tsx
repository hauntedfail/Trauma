import { Show } from "solid-js";

import { buildCollectionPageHref } from "./page-state";

export interface CollectionPaginationProps {
  ariaLabel: string;
  cursor: string | null;
  nextCursor: string | null;
  pathname: string;
}

export function CollectionPagination(props: CollectionPaginationProps) {
  return (
    <Show when={props.cursor !== null || props.nextCursor !== null}>
      <nav
        aria-label={props.ariaLabel}
        class="trauma-route-row flex items-center justify-between gap-3 px-[clamp(1rem,4cqi,1.5rem)] py-4"
      >
        <Show when={props.cursor !== null} fallback={<span />}>
          <a
            class="trauma-control trauma-control-compact"
            href={props.pathname}
          >
            First
          </a>
        </Show>
        <Show when={props.nextCursor}>
          {(nextCursor) => (
            <a
              class="trauma-control trauma-control-compact ml-auto"
              href={buildCollectionPageHref(props.pathname, nextCursor())}
            >
              Next
            </a>
          )}
        </Show>
      </nav>
    </Show>
  );
}
