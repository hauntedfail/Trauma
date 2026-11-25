import type {
  MemoryLastPosition,
  MemoryTriageState,
} from "../memories/browse-data";
import type { FetchFunction } from "../memories/memory-action-requests";
import type { HeadingPosition } from "./toc-reading-range";

export const READER_POSITION_DEBOUNCE_MS = 2_000;
export const READER_AUTO_READ_MIN_DEPTH = 0.75;
export const READER_AUTO_READ_MIN_DWELL_MS = 20_000;

const READABLE_BLOCK_SELECTOR = "p, h1, h2, h3, h4, blockquote, li, pre";

export interface ComputeReaderPositionInput {
  blocks?: readonly { top: number }[];
  headings: readonly HeadingPosition[];
  nowIso?: string;
  scrollHeight: number;
  scrollY: number;
  variant: string;
  viewportHeight: number;
}

export function computeReaderPositionSnapshot(
  input: ComputeReaderPositionInput,
): MemoryLastPosition {
  const updatedAt = input.nowIso ?? new Date().toISOString();
  const threshold = Math.max(140, Math.round(input.viewportHeight * 0.2));

  if (input.headings.length > 0) {
    let activeIndex = 0;
    for (let index = 0; index < input.headings.length; index += 1) {
      if (input.headings[index]!.top <= threshold) {
        activeIndex = index;
      } else {
        break;
      }
    }

    const activeHeading = input.headings[activeIndex]!;
    return {
      variant: input.variant,
      headingId: activeHeading.id,
      paragraphIndex: activeIndex,
      scrollRatio: clampUnit((activeIndex + 1) / input.headings.length),
      updatedAt,
    };
  }

  const blocks = input.blocks ?? [];
  if (blocks.length > 0) {
    let activeIndex = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      if (blocks[index]!.top <= threshold) {
        activeIndex = index;
      } else {
        break;
      }
    }

    return {
      variant: input.variant,
      headingId: null,
      paragraphIndex: activeIndex,
      scrollRatio: clampUnit((activeIndex + 1) / blocks.length),
      updatedAt,
    };
  }

  const maxScroll = Math.max(0, input.scrollHeight - input.viewportHeight);
  const scrollRatio = maxScroll > 0 ? clampUnit(input.scrollY / maxScroll) : 0;
  return {
    variant: input.variant,
    headingId: null,
    paragraphIndex: 0,
    scrollRatio,
    updatedAt,
  };
}

export function isSameReaderPosition(
  left: MemoryLastPosition | null | undefined,
  right: MemoryLastPosition | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.variant === right.variant &&
    left.headingId === right.headingId &&
    left.paragraphIndex === right.paragraphIndex &&
    Math.abs(left.scrollRatio - right.scrollRatio) < 0.0005
  );
}

export function readReaderBodyHeadingPositions(
  root: ParentNode | undefined,
  leadingTitleAnchorId: string | undefined,
  getTop: (element: Element) => number = (element) =>
    element.getBoundingClientRect().top,
): HeadingPosition[] {
  if (root === undefined) {
    return [];
  }

  const all: HeadingPosition[] = [];
  for (const element of root.querySelectorAll("[data-reader-section-anchor]")) {
    const id = element.getAttribute("data-reader-section-anchor");
    if (id === null || id.length === 0) {
      continue;
    }
    all.push({ id, top: getTop(element) });
  }

  if (
    leadingTitleAnchorId !== undefined &&
    all.length > 1 &&
    all[0]?.id === leadingTitleAnchorId
  ) {
    return all.slice(1);
  }

  return all;
}

export function readReaderReadableBlockPositions(
  container: ParentNode | undefined,
  getTop: (element: Element) => number = (element) =>
    element.getBoundingClientRect().top,
): Array<{ top: number }> {
  if (container === undefined) {
    return [];
  }

  const positions: Array<{ top: number }> = [];
  for (const element of container.querySelectorAll(READABLE_BLOCK_SELECTOR)) {
    if ((element.textContent ?? "").trim().length === 0) {
      continue;
    }
    positions.push({ top: getTop(element) });
  }

  return positions;
}

export function restoreReaderPositionInDom(input: {
  activeVariant: string;
  bodyContainer: HTMLElement | undefined;
  lastPosition: MemoryLastPosition | null | undefined;
  root: HTMLElement | undefined;
  scrollToY?: (y: number) => void;
}): boolean {
  const { lastPosition } = input;
  if (
    lastPosition === null ||
    lastPosition === undefined ||
    lastPosition.variant !== input.activeVariant
  ) {
    return false;
  }

  if (lastPosition.headingId !== null && input.root !== undefined) {
    const escapedId = escapeCssSelector(lastPosition.headingId);
    const target =
      input.root.querySelector<HTMLElement>(
        `[data-reader-section-anchor="${escapedId}"]`,
      ) ?? input.root.querySelector<HTMLElement>(`#${escapedId}`);
    if (target !== null) {
      target.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
      return true;
    }
  }

  if (lastPosition.paragraphIndex > 0 && input.bodyContainer !== undefined) {
    const blocks = Array.from(
      input.bodyContainer.querySelectorAll<HTMLElement>(READABLE_BLOCK_SELECTOR),
    ).filter((element) => (element.textContent ?? "").trim().length > 0);
    if (blocks.length > 0) {
      const target =
        blocks[Math.min(lastPosition.paragraphIndex, blocks.length - 1)];
      if (target !== undefined) {
        target.scrollIntoView({
          behavior: "auto",
          block: "start",
          inline: "nearest",
        });
        return true;
      }
    }
  }

  if (
    lastPosition.scrollRatio > 0 &&
    typeof window !== "undefined" &&
    typeof document !== "undefined"
  ) {
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    if (maxScroll > 0) {
      const targetY = Math.round(clampUnit(lastPosition.scrollRatio) * maxScroll);
      if (input.scrollToY) {
        input.scrollToY(targetY);
      } else {
        window.scrollTo({ top: targetY, behavior: "auto" });
      }
      return true;
    }
  }

  return false;
}

export async function submitReaderPosition(input: {
  fetch?: FetchFunction;
  keepalive?: boolean;
  memoryId: string;
  position: MemoryLastPosition;
}): Promise<boolean> {
  const requestFetch = input.fetch ?? fetch;
  try {
    const response = await requestFetch(
      `/api/memories/${encodeURIComponent(input.memoryId)}/position`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input.position),
        keepalive: input.keepalive === true,
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function submitReaderOpened(input: {
  fetch?: FetchFunction;
  memoryId: string;
}): Promise<boolean> {
  const requestFetch = input.fetch ?? fetch;
  try {
    const response = await requestFetch(
      `/api/memories/${encodeURIComponent(input.memoryId)}/open`,
      {
        method: "POST",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function submitReaderTriage(input: {
  fetch?: FetchFunction;
  memoryId: string;
  triageState: MemoryTriageState;
}): Promise<{ triageState: MemoryTriageState }> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(
    `/api/memories/${encodeURIComponent(input.memoryId)}/triage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        triage_state: input.triageState,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Failed to update memory triage state.");
  }

  const payload = (await response.json()) as {
    triageState?: MemoryTriageState;
    triage_state?: MemoryTriageState;
  };
  return {
    triageState: payload.triageState ?? payload.triage_state ?? input.triageState,
  };
}

export function computeReaderScrollDepth(input: {
  scrollHeight: number;
  scrollY: number;
  viewportHeight: number;
}): number {
  if (!Number.isFinite(input.scrollHeight) || input.scrollHeight <= 0) {
    return 0;
  }
  if (input.scrollHeight <= input.viewportHeight) {
    return 1;
  }
  return clampUnit((input.scrollY + input.viewportHeight) / input.scrollHeight);
}

export function shouldAutoMarkRead(input: {
  alreadyRead: boolean;
  dwellMs: number;
  minDepth?: number;
  minDwellMs?: number;
  scrollDepth: number;
}): boolean {
  if (input.alreadyRead) {
    return false;
  }
  const minDepth = input.minDepth ?? READER_AUTO_READ_MIN_DEPTH;
  const minDwellMs = input.minDwellMs ?? READER_AUTO_READ_MIN_DWELL_MS;
  return input.scrollDepth >= minDepth && input.dwellMs >= minDwellMs;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function escapeCssSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
