interface TraumaMarkProps {
  size?: number;
  class?: string;
}

export function TraumaMark(props: TraumaMarkProps) {
  const size = () => props.size ?? 28;

  return (
    <picture>
      <source srcset="/assets/trauma-mark.svg" type="image/svg+xml" />
      <img
        alt=""
        aria-hidden="true"
        class={props.class}
        decoding="async"
        height={size()}
        src="/assets/trauma-mark.png"
        style={{ display: "block", "object-fit": "contain" }}
        width={size()}
      />
    </picture>
  );
}
