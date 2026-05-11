export interface HighlightKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isExplicitHighlightKeyboardToggle(
  event: HighlightKeyboardEvent,
): boolean {
  if (event.isComposing === true) {
    return false;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  return event.key === "Enter" || event.key === " ";
}

export function canStartHighlightToggle(pendingSelectionKey: string): boolean {
  return pendingSelectionKey.length === 0;
}
