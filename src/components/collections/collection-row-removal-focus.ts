import type { AsyncActionFocusOwnership } from "../async-action-focus";

const collectionRowSelector = "[data-collection-row]";
const collectionPrimaryLinkSelector = "[data-collection-primary-link]";
const removalGenerationByPageRegion = new WeakMap<HTMLElement, number>();

export function captureCollectionRowRemovalFocus(input: {
  focusOwnership: AsyncActionFocusOwnership;
  pageRegion: HTMLElement;
  readActiveElement?: () => Element | null;
  row: HTMLElement;
}): () => void {
  const readActiveElement = input.readActiveElement ?? (() =>
    typeof document === "undefined" ? null : document.activeElement);
  const rows = [
    ...input.pageRegion.querySelectorAll<HTMLElement>(collectionRowSelector),
  ];
  const rowIndex = rows.indexOf(input.row);
  const fallbackRows = rowIndex < 0
    ? []
    : [rows[rowIndex + 1], rows[rowIndex - 1]].map(captureRowIdentity);
  const removedRow = captureRowIdentity(input.row);
  const generation =
    (removalGenerationByPageRegion.get(input.pageRegion) ?? 0) + 1;
  removalGenerationByPageRegion.set(input.pageRegion, generation);
  let managedFocusTarget: HTMLElement | undefined;

  return () => {
    queueMicrotask(() => {
      if (
        !input.focusOwnership.actionOwnsFocus ||
        removalGenerationByPageRegion.get(input.pageRegion) !== generation
      ) {
        return;
      }
      const activeElement = readActiveElement();
      if (!focusStillBelongsToRemoval({
        activeElement,
        focusOwnership: input.focusOwnership,
        managedFocusTarget,
      })) {
        return;
      }

      const currentRows = [
        ...input.pageRegion.querySelectorAll<HTMLElement>(collectionRowSelector),
      ];
      const survivingRows = currentRows.filter((row) =>
        !isCapturedRow(row, removedRow)
      );
      const identityFallbackRows = fallbackRows.map((row) =>
        resolveCurrentRow(currentRows, row)
      );
      const ordinalFallbackRows = rowIndex < 0
        ? []
        : [survivingRows[rowIndex], survivingRows[rowIndex - 1]];
      const focusTarget = uniqueRows([
        ...identityFallbackRows,
        ...ordinalFallbackRows,
      ])
        .map(resolvePrimaryLink)
        .find(isFocusablePrimaryLink) ?? input.pageRegion;
      if (!isConnectedFocusTarget(focusTarget)) {
        return;
      }
      focusTarget.focus({ preventScroll: true });
      managedFocusTarget = focusTarget;
    });
  };
}

interface CapturedRowIdentity {
  element: HTMLElement;
  id: string | undefined;
}

function captureRowIdentity(
  row: HTMLElement | undefined,
): CapturedRowIdentity | undefined {
  return row === undefined
    ? undefined
    : { element: row, id: row.dataset.collectionRow };
}

function resolveCurrentRow(
  currentRows: readonly HTMLElement[],
  capturedRow: CapturedRowIdentity | undefined,
): HTMLElement | undefined {
  if (capturedRow === undefined) {
    return undefined;
  }
  if (capturedRow.id !== undefined) {
    return currentRows.find((row) => row.dataset.collectionRow === capturedRow.id);
  }
  return currentRows.includes(capturedRow.element)
    ? capturedRow.element
    : undefined;
}

function isCapturedRow(
  row: HTMLElement,
  capturedRow: CapturedRowIdentity | undefined,
): boolean {
  if (capturedRow === undefined) {
    return false;
  }
  return capturedRow.id === undefined
    ? row === capturedRow.element
    : row.dataset.collectionRow === capturedRow.id;
}

function uniqueRows(
  rows: readonly (HTMLElement | undefined)[],
): HTMLElement[] {
  return [
    ...new Set(rows.filter((row): row is HTMLElement => row !== undefined)),
  ];
}

function resolvePrimaryLink(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(collectionPrimaryLinkSelector);
}

function focusStillBelongsToRemoval(input: {
  activeElement: Element | null;
  focusOwnership: AsyncActionFocusOwnership;
  managedFocusTarget: HTMLElement | undefined;
}): boolean {
  if (input.activeElement === input.managedFocusTarget) {
    return true;
  }

  return input.focusOwnership.ownsCurrentFocus();
}

function isFocusablePrimaryLink(
  target: HTMLElement | null | undefined,
): target is HTMLElement {
  if (!isConnectedFocusTarget(target)) {
    return false;
  }
  if (
    target.getAttribute("aria-disabled") === "true" ||
    target.inert ||
    target.closest("[inert]") !== null ||
    target.hidden ||
    target.closest('[hidden], [aria-hidden="true"]') !== null ||
    target.tabIndex < 0
  ) {
    return false;
  }

  return target.tagName !== "A" || target.hasAttribute("href");
}

function isConnectedFocusTarget(
  target: HTMLElement | null | undefined,
): target is HTMLElement {
  return target?.isConnected === true &&
    (!("disabled" in target) || target.disabled !== true);
}
