import type { ActiveTocRange, HeadingPosition } from "./toc-reading-range";

const SECTION_ANCHOR_ATTRIBUTE = "data-reader-section-anchor";
export const READER_TOC_DESKTOP_MEDIA_QUERY = "(min-width: 1041px)";

export interface ReaderTocScrollSpyBinding {
  dispose: () => void;
  isEnabled: () => boolean;
}

/**
 * Keeps the layout-reading scroll spy attached only while its desktop right
 * rail is rendered. The media-query listener remains active so moving across
 * the shell breakpoint re-enables measurement without remounting the reader.
 */
export function bindReaderTocScrollSpy(input: {
  cancel: () => void;
  schedule: () => void;
  target: Pick<Window, "addEventListener" | "matchMedia" | "removeEventListener">;
}): ReaderTocScrollSpyBinding {
  const desktop = input.target.matchMedia(READER_TOC_DESKTOP_MEDIA_QUERY);
  const passive: AddEventListenerOptions = { passive: true };
  let disposed = false;
  let enabled = false;

  const enable = (): void => {
    if (disposed || enabled) {
      return;
    }

    enabled = true;
    input.target.addEventListener("scroll", input.schedule, passive);
    input.target.addEventListener("resize", input.schedule, passive);
    input.target.addEventListener("hashchange", input.schedule);
    input.schedule();
  };
  const disable = (): void => {
    if (!enabled) {
      return;
    }

    enabled = false;
    input.target.removeEventListener("scroll", input.schedule);
    input.target.removeEventListener("resize", input.schedule);
    input.target.removeEventListener("hashchange", input.schedule);
    input.cancel();
  };
  const syncWithLayout = (): void => {
    if (desktop.matches) {
      enable();
    } else {
      disable();
    }
  };

  desktop.addEventListener("change", syncWithLayout);
  syncWithLayout();

  return {
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      desktop.removeEventListener("change", syncWithLayout);
      disable();
    },
    isEnabled: () => enabled,
  };
}

/**
 * Reads the viewport-relative top of every rendered section heading inside the
 * reader root. The measurement step is injectable so the seam can be unit
 * tested without a real layout engine.
 */
export function readReaderHeadingPositions(
  root: ParentNode | undefined,
  getTop: (element: Element) => number = (element) =>
    element.getBoundingClientRect().top,
): HeadingPosition[] {
  if (root === undefined) {
    return [];
  }

  const positions: HeadingPosition[] = [];
  for (
    const element of root.querySelectorAll(`[${SECTION_ANCHOR_ATTRIBUTE}]`)
  ) {
    const id = element.getAttribute(SECTION_ANCHOR_ATTRIBUTE);
    if (id === null || id.length === 0) {
      continue;
    }

    positions.push({ id, top: getTop(element) });
  }

  return positions;
}

/**
 * Structural equality for active ranges so reactive consumers can avoid
 * redundant updates when the resolved range has not changed.
 */
export function isSameActiveTocRange(
  a: ActiveTocRange,
  b: ActiveTocRange,
): boolean {
  return (
    a.leadId === b.leadId &&
    a.rangeIds.length === b.rangeIds.length &&
    a.rangeIds.every((id, index) => id === b.rangeIds[index])
  );
}
