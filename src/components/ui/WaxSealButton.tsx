import { splitProps, type JSX } from "solid-js";

import { ButtonHint } from "./ButtonHint";

export type WaxSealButtonVariant = "command" | "toggle";

export interface WaxSealButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  hint?: string;
  variant?: WaxSealButtonVariant;
}

const variantClass: Record<WaxSealButtonVariant, string> = {
  command: "trauma-paper-wax-command",
  toggle: "trauma-paper-wax-toggle",
};

function joinClasses(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");
}

export function WaxSealButton(props: WaxSealButtonProps) {
  const [local, buttonProps] = splitProps(props, [
    "children",
    "class",
    "hint",
    "variant",
  ]);
  const variant = local.variant ?? "command";

  return (
    <button
      {...buttonProps}
      class={joinClasses([
        "trauma-paper-wax-seal",
        variantClass[variant],
        local.class,
      ])}
      data-trauma-hint={local.hint}
    >
      {local.children}
      {local.hint === undefined ? null : <ButtonHint>{local.hint}</ButtonHint>}
    </button>
  );
}

export function WaxSealLabel(props: {
  children: JSX.Element;
  class?: string;
}) {
  return (
    <span class={joinClasses(["trauma-paper-wax-label", props.class])}>
      {props.children}
    </span>
  );
}
