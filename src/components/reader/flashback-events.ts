export interface FlashbackKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface FlashbackKeyboardToggleContext {
  hasReaderSelection: boolean;
  targetIsReaderContent: boolean;
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

export function shouldHandleFlashbackKeyboardToggle(
  event: FlashbackKeyboardEvent,
  context: FlashbackKeyboardToggleContext,
): boolean {
  return context.hasReaderSelection &&
    context.targetIsReaderContent &&
    isExplicitFlashbackKeyboardToggle(event);
}

export function shouldPreventFlashbackSpaceDefault(
  event: FlashbackKeyboardEvent,
  context: FlashbackKeyboardToggleContext,
): boolean {
  return event.key === " " &&
    shouldHandleFlashbackKeyboardToggle(event, context);
}

export function canStartFlashbackToggle(pendingSelectionKey: string): boolean {
  return pendingSelectionKey.length === 0;
}
