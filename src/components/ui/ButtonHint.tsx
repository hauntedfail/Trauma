export interface ButtonHintProps {
  children: string;
}

export function ButtonHint(props: ButtonHintProps) {
  return <span aria-hidden="true" class="trauma-button-hint" data-trauma-hint-label={props.children} />;
}
