import type { JSX } from "solid-js";

interface IconProps {
  size?: number;
}

type NavIconName =
  | "memories"
  | "highlights"
  | "categories"
  | "tags"
  | "backup"
  | "settings";

type NavIconVariants = Record<"outline" | "filled", JSX.Element>;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "stroke-width": 1.75,
} as const;

const fill = {
  fill: "currentColor",
  stroke: "currentColor",
  "stroke-linejoin": "round",
  "stroke-width": 1.5,
} as const;

function Svg(props: IconProps & { children: JSX.Element }) {
  const size = () => props.size ?? 26;

  return (
    <svg
      aria-hidden="true"
      height={size()}
      viewBox="0 0 26 26"
      width={size()}
    >
      {props.children}
    </svg>
  );
}

export const TraumaNavIcons: Record<NavIconName, NavIconVariants> = {
  memories: {
    outline: (
      <Svg>
        <rect {...stroke} height="12" rx="1.5" width="12" x="7" y="7" />
        <g {...stroke}>
          <path d="M10 7V4M13 7V4M16 7V4M10 19v3M13 19v3M16 19v3" />
          <path d="M7 10H4M7 13H4M7 16H4M19 10h3M19 13h3M19 16h3" />
        </g>
        <g stroke="currentColor" stroke-linecap="round" stroke-width="1.6">
          <path d="M13 10.5v5M10.7 11.7l4.6 2.6M10.7 14.3l4.6-2.6" />
        </g>
      </Svg>
    ),
    filled: (
      <Svg>
        <rect fill="currentColor" height="12" rx="1.5" width="12" x="7" y="7" />
        <g stroke="currentColor" stroke-linecap="round" stroke-width="2.2">
          <path d="M10 7V4M13 7V4M16 7V4M10 19v3M13 19v3M16 19v3" />
          <path d="M7 10H4M7 13H4M7 16H4M19 10h3M19 13h3M19 16h3" />
        </g>
        <g stroke="var(--bg-base)" stroke-linecap="round" stroke-width="1.75">
          <path d="M13 10.5v5M10.7 11.7l4.6 2.6M10.7 14.3l4.6-2.6" />
        </g>
      </Svg>
    ),
  },
  highlights: {
    outline: (
      <Svg>
        <path {...stroke} d="m5 14 8-8 5 5-8 8H5v-5z" />
        <path {...stroke} d="m13 6 3-3 5 5-3 3" />
        <path {...stroke} d="M4 22h18" />
      </Svg>
    ),
    filled: (
      <Svg>
        <path {...fill} d="m5 14 8-8 5 5-8 8H5v-5z" />
        <path {...stroke} d="m13 6 3-3 5 5-3 3M4 22h18" />
      </Svg>
    ),
  },
  categories: {
    outline: (
      <Svg>
        <path {...stroke} d="m3 7 3-3h5l2 3h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </Svg>
    ),
    filled: (
      <Svg>
        <path {...fill} d="m3 7 3-3h5l2 3h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </Svg>
    ),
  },
  tags: {
    outline: (
      <Svg>
        <path {...stroke} d="M8 3 6 23M20 3l-2 20M3 9h20M2 17h20" />
      </Svg>
    ),
    filled: (
      <Svg>
        <path
          {...stroke}
          d="M8 3 6 23M20 3l-2 20M3 9h20M2 17h20"
          stroke-width="2.6"
        />
      </Svg>
    ),
  },
  backup: {
    outline: (
      <Svg>
        <path {...stroke} d="M6 18a4 4 0 0 1-1-7.9A6 6 0 0 1 17 9a4 4 0 0 1 1 7.9" />
        <path {...stroke} d="M13 13v8m0 0-3-3m3 3 3-3" />
      </Svg>
    ),
    filled: (
      <Svg>
        <path {...fill} d="M6 18a4 4 0 0 1-1-7.9A6 6 0 0 1 17 9a4 4 0 0 1 1 7.9z" />
        <path {...stroke} d="M13 13v8m0 0-3-3m3 3 3-3" stroke-width="2" />
      </Svg>
    ),
  },
  settings: {
    outline: (
      <Svg>
        <circle {...stroke} cx="13" cy="13" r="3" />
        <path {...stroke} d="M13 2v3M13 21v3M4.2 4.2l2.1 2.1M19.7 19.7l2.1 2.1M2 13h3M21 13h3M4.2 21.8l2.1-2.1M19.7 6.3l2.1-2.1" />
      </Svg>
    ),
    filled: (
      <Svg>
        <circle {...fill} cx="13" cy="13" r="4" />
        <path {...stroke} d="M13 2v3M13 21v3M4.2 4.2l2.1 2.1M19.7 19.7l2.1 2.1M2 13h3M21 13h3M4.2 21.8l2.1-2.1M19.7 6.3l2.1-2.1" stroke-width="2" />
      </Svg>
    ),
  },
};

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 22} viewBox="0 0 24 24" width={props.size ?? 22}>
      <path {...stroke} d="m15 5-7 7 7 7" stroke-width="2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 18} viewBox="0 0 24 24" width={props.size ?? 18}>
      <circle {...stroke} cx="11" cy="11" r="6.5" />
      <path {...stroke} d="m16 16 5 5" />
    </svg>
  );
}

export function KebabIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 18} viewBox="0 0 24 24" width={props.size ?? 18}>
      <circle cx="5" cy="12" fill="currentColor" r="1.7" />
      <circle cx="12" cy="12" fill="currentColor" r="1.7" />
      <circle cx="19" cy="12" fill="currentColor" r="1.7" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 14} viewBox="0 0 24 24" width={props.size ?? 14}>
      <rect {...stroke} height="9" rx="2" width="14" x="5" y="11" />
      <path {...stroke} d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 18} viewBox="0 0 24 24" width={props.size ?? 18}>
      <path {...stroke} d="M12 5v14M5 12h14" stroke-width="2" />
    </svg>
  );
}

export function OpenIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M7 17 17 7M9 7h8v8" />
      <path {...stroke} d="M19 13v6H5V5h6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="m5 12 4 4L19 6" stroke-width="2" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <circle {...stroke} cx="12" cy="12" r="4" />
      <path {...stroke} d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M20 15.5A8 8 0 0 1 8.5 4 8.2 8.2 0 1 0 20 15.5z" />
    </svg>
  );
}

export function PageIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M6 3h9l3 3v15H6z" />
      <path {...stroke} d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

export function PaperIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M5 4h14v16H5z" />
      <path {...stroke} d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
