import { useLocation, useNavigate } from "@solidjs/router";
import { createMemo, type JSX } from "solid-js";

import { SearchIcon } from "../icons";
import {
  buildBrowseHref,
  parseBrowseQuery,
  resolveBrowseLane,
} from "./browse-data";

const surfaceInput =
  "min-h-[42px] min-w-0 bg-transparent text-trauma-text-primary outline-none placeholder:text-trauma-text-placeholder focus-visible:shadow-none";

export function MemorySearchBar(props: {
  disabled: boolean;
  children?: JSX.Element;
  onSearchInputMount?: (input: HTMLInputElement) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = createMemo(() => parseBrowseQuery(location.search));
  const updateSearch = (value: string) => {
    const current = query();
    const lane = current.lane ?? resolveBrowseLane(current);
    navigate(buildBrowseHref(current, { lane, q: value }), { replace: true });
  };

  return (
    <div class="trauma-route-row flex items-center gap-2 border-b border-trauma-border px-6 py-4">
      <label class="grid min-h-11 flex-1 grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5 rounded-control border border-trauma-border bg-trauma-bg-elev px-3.5 text-trauma-text-muted focus-within:border-trauma-border-strong focus-within:bg-trauma-bg-surface focus-within:ring-1 focus-within:ring-inset focus-within:ring-trauma-border-strong">
        <span class="grid place-items-center">
          <SearchIcon />
        </span>
        <input
          aria-label="Search memories"
          class={surfaceInput}
          disabled={props.disabled}
          placeholder="Search library — title, URL, tags, or in:archive"
          ref={(element) => props.onSearchInputMount?.(element)}
          type="search"
          value={query().q}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onInput={(event) => updateSearch(event.currentTarget.value)}
        />
      </label>
      {props.children}
    </div>
  );
}
