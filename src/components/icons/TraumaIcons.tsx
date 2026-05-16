import type { JSX } from "solid-js";

interface IconProps {
  size?: number;
}

type NavIconName =
  | "memories"
  | "flashbacks"
  | "moment"
  | "categories"
  | "tags"
  | "backup"
  | "settings";

type NavIconFactory = (props?: IconProps) => JSX.Element;
type NavIconVariants = Record<"outline" | "filled", NavIconFactory>;

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
    outline: (props = {}) => (
      <Svg {...props}>
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
    filled: (props = {}) => (
      <Svg {...props}>
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
  flashbacks: {
    outline: (props = {}) => (
      <Svg {...props}>
        <path {...stroke} d="M15 2 6 14h6l-1 10 9-13h-6l1-9z" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
        <path {...fill} d="M15 2 6 14h6l-1 10 9-13h-6l1-9z" />
      </Svg>
    ),
  },
  moment: {
    outline: (props = {}) => (
      <Svg {...props}>
        <path {...stroke} d="M7 4h12v18l-6-3.5L7 22V4z" />
        <path {...stroke} d="M10 8h6M10 11h5" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
        <path {...fill} d="M7 4h12v18l-6-3.5L7 22V4z" />
        <path stroke="var(--bg-base)" stroke-linecap="round" stroke-width="1.7" d="M10 8h6M10 11h5" />
      </Svg>
    ),
  },
  categories: {
    outline: (props = {}) => (
      <Svg {...props}>
        <path {...stroke} d="m3 7 3-3h5l2 3h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
        <path {...fill} d="m3 7 3-3h5l2 3h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </Svg>
    ),
  },
  tags: {
    outline: (props = {}) => (
      <Svg {...props}>
        <path {...stroke} d="M8 3 6 23M20 3l-2 20M3 9h20M2 17h20" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
        <path
          {...stroke}
          d="M8 3 6 23M20 3l-2 20M3 9h20M2 17h20"
          stroke-width="2.6"
        />
      </Svg>
    ),
  },
  backup: {
    outline: (props = {}) => (
      <Svg {...props}>
        <path {...stroke} d="M6 18a4 4 0 0 1-1-7.9A6 6 0 0 1 17 9a4 4 0 0 1 1 7.9" />
        <path {...stroke} d="M13 13v8m0 0-3-3m3 3 3-3" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
        <path {...fill} d="M6 18a4 4 0 0 1-1-7.9A6 6 0 0 1 17 9a4 4 0 0 1 1 7.9z" />
        <path {...stroke} d="M13 13v8m0 0-3-3m3 3 3-3" stroke-width="2" />
      </Svg>
    ),
  },
  settings: {
    outline: (props = {}) => (
      <Svg {...props}>
        <circle {...stroke} cx="13" cy="13" r="3" />
        <path {...stroke} d="M13 2v3M13 21v3M4.2 4.2l2.1 2.1M19.7 19.7l2.1 2.1M2 13h3M21 13h3M4.2 21.8l2.1-2.1M19.7 6.3l2.1-2.1" />
      </Svg>
    ),
    filled: (props = {}) => (
      <Svg {...props}>
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
      <g {...stroke}>
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.5" y1="4.5" x2="6.7" y2="6.7" />
        <line x1="17.3" y1="17.3" x2="19.5" y2="19.5" />
        <line x1="4.5" y1="19.5" x2="6.7" y2="17.3" />
        <line x1="17.3" y1="6.7" x2="19.5" y2="4.5" />
      </g>
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function PaintToolIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M9.4 15.6 16.8 8.2c.7-.7 1.8-.7 2.5 0s.7 1.8 0 2.5L12 17.9l-4.2 1.2 1.6-3.5z" />
      <path {...stroke} d="M14.8 10.2 17.8 13.2" />
      <path {...stroke} d="M7.8 19.1 12 17.9" />
    </svg>
  );
}

export function PageIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <rect {...stroke} height="18" rx="1.5" width="14" x="5" y="3" />
      <line {...stroke} x1="8" y1="8" x2="16" y2="8" />
      <line {...stroke} x1="8" y1="12" x2="16" y2="12" />
      <line {...stroke} x1="8" y1="16" x2="13" y2="16" />
    </svg>
  );
}

export function PaperIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" height={props.size ?? 16} viewBox="0 0 24 24" width={props.size ?? 16}>
      <path {...stroke} d="M5 3h9l5 5v13a0 0 0 0 1 0 0H5z" />
      <path {...stroke} d="M14 3v5h5" />
    </svg>
  );
}

export function HermesIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      width={props.size ?? 16}
    >
      <path {...stroke} d="M5 9h14v10.5H5z" />
      <path
        {...stroke}
        d="M8 9V7.7C8 4.7 9.7 2.5 12 2.5s4 2.2 4 5.2V9"
      />
      <path
        {...stroke}
        d="M9.6 9V7.9c0-2 1-3.4 2.4-3.4s2.4 1.4 2.4 3.4V9"
      />
      <path {...stroke} d="M8 9v2.2M16 9v2.2" />
    </svg>
  );
}
