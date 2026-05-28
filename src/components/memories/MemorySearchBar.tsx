import { useLocation, useNavigate } from "@solidjs/router";
import { createMemo } from "solid-js";

import { SearchIcon } from "../icons";
import { buildBrowseHref, parseBrowseQuery } from "./browse-data";

const surfaceInput =
  "min-h-[42px] min-w-0 bg-transparent text-trauma-text-primary outline-none placeholder:text-trauma-text-placeholder focus-visible:shadow-none";

export function MemorySearchBar(props: {
  disabled: boolean;
  onSearchInputMount?: (input: HTMLInputElement) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = createMemo(() => parseBrowseQuery(location.search));
  const updateSearch = (value: string) => {
    navigate(buildBrowseHref(query(), { q: value }), { replace: true });
  };

  return (
    <div class="trauma-route-row border-b border-trauma-border px-6 py-[18px]">
      <label class="grid min-h-12 grid-cols-[22px_minmax(0,1fr)] items-center gap-3 rounded-full border border-trauma-border bg-trauma-bg-elev px-4 text-trauma-text-muted focus-within:border-trauma-border-strong focus-within:bg-trauma-bg-surface focus-within:ring-1 focus-within:ring-inset focus-within:ring-trauma-border-strong">
        <span class="grid place-items-center">
          <SearchIcon />
        </span>
        <input
          aria-label="Search memories"
          class={surfaceInput}
          disabled={props.disabled}
          placeholder="Search memories - title, URL, tags, or flashbacks"
          ref={(element) => props.onSearchInputMount?.(element)}
          type="search"
          value={query().q}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          onInput={(event) => updateSearch(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}
