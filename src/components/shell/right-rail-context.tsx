import {
  createContext,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";

interface RightRailContentContextValue {
  rightRailContent: Accessor<JSX.Element | undefined>;
  setRightRailContent: Setter<JSX.Element | undefined>;
}

export const RightRailContentContext =
  createContext<RightRailContentContextValue>();

export function useRightRailContent() {
  const context = useContext(RightRailContentContext);

  if (context === undefined) {
    throw new Error("useRightRailContent must be used within AppShell");
  }

  return context;
}
