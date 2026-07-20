export function captureAsyncActionFocusIntent(
  actionControl: HTMLElement,
  readActiveElement: () => Element | null = () =>
    typeof document === "undefined" ? null : document.activeElement,
  readBody: () => HTMLElement | undefined = () =>
    typeof document === "undefined" ? undefined : document.body,
): () => boolean {
  const actionOwnedFocus = readActiveElement() === actionControl;
  return () => {
    if (!actionOwnedFocus) {
      return false;
    }
    const activeElement = readActiveElement();
    return activeElement === actionControl || activeElement === readBody();
  };
}
