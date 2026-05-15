interface TraumaMarkProps {
  size?: number;
  class?: string;
}

export function TraumaMark(props: TraumaMarkProps) {
  const size = () => props.size ?? 28;

  return (
    <img
      alt=""
      aria-hidden="true"
      class={props.class}
      height={size()}
      src="/assets/trauma-mark.png"
      style={{ display: "block", "object-fit": "contain" }}
      width={size()}
    />
  );
}
