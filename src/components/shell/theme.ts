export type BrightnessMode = "sun" | "night";
export type SurfaceMode = "normal" | "paper";
export type TraumaTheme =
  | "warm-light"
  | "black-dark"
  | "paper-warm-light"
  | "paper-black-dark";

export const DEFAULT_BRIGHTNESS_MODE = "night" satisfies BrightnessMode;
export const DEFAULT_SURFACE_MODE = "normal" satisfies SurfaceMode;

export function themeFromPreference(input: {
  brightness: BrightnessMode;
  surface: SurfaceMode;
}): TraumaTheme {
  if (input.surface === "paper" && input.brightness === "sun") {
    return "paper-warm-light";
  }

  if (input.surface === "paper") {
    return "paper-black-dark";
  }

  if (input.brightness === "sun") {
    return "warm-light";
  }

  return "black-dark";
}
