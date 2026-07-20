export interface AsyncActionFocusOwnership {
  actionOwnsFocus: boolean;
  ownsCurrentFocus: () => boolean;
}

export function captureAsyncActionFocusIntent(
  actionControl: HTMLElement,
  readActiveElement: () => Element | null = () =>
    typeof document === "undefined" ? null : document.activeElement,
  readBody: () => HTMLElement | undefined = () =>
    typeof document === "undefined" ? undefined : document.body,
): () => boolean {
  const actionOwnedFocus = readActiveElement() === actionControl;
  let focusOwnershipRevoked = false;
  return () => {
    if (!actionOwnedFocus || focusOwnershipRevoked) {
      return false;
    }
    const activeElement = readActiveElement();
    const ownsFocus = activeElement === actionControl || activeElement === readBody();
    if (!ownsFocus) {
      focusOwnershipRevoked = true;
    }
    return ownsFocus;
  };
}
