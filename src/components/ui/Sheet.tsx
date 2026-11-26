import Drawer from "@corvu/drawer";
import { Show, type JSX } from "solid-js";

export interface TraumaSheetProps {
  ariaLabel: string;
  children: JSX.Element;
  contentClass?: string;
  contentRef?: (el: HTMLElement) => void;
  dataSheetAttr?: string;
  id?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  side?: "right" | "bottom";
}

/**
 * Swipeable side/bottom sheet primitive built on `@corvu/drawer`.
 * Non-modal side panel on tablet/desktop (>=721px) so the underlying article stays
 * interactive, with a dimming backdrop on narrow phone viewports (<=720px).
 */
export function TraumaSheet(props: TraumaSheetProps) {
  const side = () => props.side ?? "right";

  return (
    <Show when={props.open}>
      <Drawer
        open={props.open}
        onOpenChange={props.onOpenChange}
        side={side()}
        modal={false}
        trapFocus={false}
        restoreFocus={false}
        closeOnEscapeKeyDown={true}
        closeOnOutsidePointer={false}
        closeOnOutsideFocus={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            class="trauma-ui-backdrop fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] min-[721px]:hidden"
            onClick={() => props.onOpenChange(false)}
          />
          <Drawer.Content
            ref={props.contentRef}
            aria-label={props.ariaLabel}
            class={`trauma-reader-psychiatrist-sheet flex flex-col border-l border-trauma-border/90 bg-trauma-bg-elev/96 text-trauma-text-primary shadow-trauma-drawer backdrop-blur-xl ring-1 ring-inset ring-white/[0.05] outline-none min-[1440px]:shadow-none ${props.contentClass ?? ""}`}
            data-reader-psychiatrist-sheet={props.dataSheetAttr ?? (props.open ? "open" : "closed")}
            id={props.id}
            role="dialog"
          >
            {props.children}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </Show>
  );
}
