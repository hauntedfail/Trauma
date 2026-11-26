import { Dialog as KobalteDialog } from "@kobalte/core/dialog";
import type { JSX } from "solid-js";

export interface TraumaDialogProps {
  ariaLabel: string;
  children: JSX.Element;
  contentClass?: string;
  contentRef?: (el: HTMLDivElement) => void;
  id?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  overlayClass?: string;
  positionerClass?: string;
}

/**
 * Refined modal dialog primitive built on `@kobalte/core/dialog`.
 * Portalled with focus trap, scroll lock, Escape/outside-click dismissal,
 * and Coss/Linear-inspired glass-hairline elevation.
 */
export function TraumaDialog(props: TraumaDialogProps) {
  return (
    <KobalteDialog open={props.open} onOpenChange={props.onOpenChange} modal={true}>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay
          class={`trauma-ui-backdrop fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm ${props.overlayClass ?? ""}`}
          data-command-palette-backdrop={props.id === "trauma-command-palette" ? "" : undefined}
        />
        <div
          class={`fixed inset-0 z-[81] flex items-start justify-center px-3 pt-[min(14vh,6.5rem)] ${props.positionerClass ?? ""}`}
        >
          <KobalteDialog.Content
            ref={props.contentRef}
            aria-label={props.ariaLabel}
            class={`trauma-ui-dialog w-full max-w-[34rem] overflow-hidden rounded-2xl border border-trauma-border/90 bg-trauma-bg-elev/95 text-trauma-text-primary shadow-trauma-drawer backdrop-blur-xl ring-1 ring-inset ring-white/[0.06] outline-none ${props.contentClass ?? ""}`}
            id={props.id}
          >
            {props.children}
          </KobalteDialog.Content>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}
