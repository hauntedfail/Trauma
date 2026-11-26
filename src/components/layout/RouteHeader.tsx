import { type JSX } from "solid-js";

export interface RouteHeaderProps {
  actions?: JSX.Element;
  class?: string;
  constrained?: boolean;
  contentClass?: string;
  eyebrow?: string;
  layout?: "single" | "split";
  leading?: () => JSX.Element;
  metadata?: JSX.Element;
  title: string;
  titleClass?: string;
  titleElement?: "h1" | "p";
  titleId?: string;
  titleSuffix?: JSX.Element;
}

const headerBaseClass =
  "trauma-route-header trauma-chrome sticky top-0 z-[2] border-b border-trauma-divider bg-trauma-bg-surface/95 backdrop-blur";
const headerInnerBaseClass =
  "trauma-fluid-route-padding grid min-h-[3.5rem] items-center gap-4";
const headerSplitClass = "grid-cols-[minmax(0,1fr)_auto]";
const headerSingleClass = "grid-cols-[minmax(0,1fr)]";
const headerTitleClass =
  "mb-0 min-w-0 truncate text-lg font-semibold tracking-tight leading-tight text-trauma-text-primary";
const headerEyebrowClass =
  "mb-1 text-xs font-semibold uppercase tracking-wide text-trauma-text-muted";

export function RouteHeader(props: RouteHeaderProps) {
  const titleClass = () => props.titleClass ?? headerTitleClass;
  const isConstrained = () => props.constrained !== false;
  const innerClass = () =>
    [
      headerInnerBaseClass,
      isConstrained() ? "trauma-route-column" : "w-full",
      props.layout === "single" ? headerSingleClass : headerSplitClass,
    ].join(" ");
  const contentClass = () =>
    [
      props.leading === undefined
        ? "min-w-0"
        : "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3",
      props.contentClass ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  const titleNode = () => {
    if (props.titleElement === "p") {
      return (
        <p class={titleClass()}>
          {props.title}
          {props.titleSuffix}
        </p>
      );
    }

    return (
      <h1 class={titleClass()} id={props.titleId}>
        {props.title}
        {props.titleSuffix}
      </h1>
    );
  };

  return (
    <header class={`${headerBaseClass} ${props.class ?? ""}`}>
      <div class={innerClass()}>
        <div class={contentClass()}>
          {props.leading?.()}
          <div class="min-w-0">
            {props.eyebrow === undefined ? null : (
              <p class={headerEyebrowClass}>{props.eyebrow}</p>
            )}
            {titleNode()}
            {props.metadata}
          </div>
        </div>
        {props.actions}
      </div>
    </header>
  );
}
