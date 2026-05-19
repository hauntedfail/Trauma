export interface FlashbackKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isExplicitFlashbackKeyboardToggle(
  event: FlashbackKeyboardEvent,
): boolean {
  if (event.isComposing === true) {
    return false;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  return event.key === "Enter" || event.key === " ";
}

export function canStartFlashbackToggle(pendingSelectionKey: string): boolean {
  return pendingSelectionKey.length === 0;
}
