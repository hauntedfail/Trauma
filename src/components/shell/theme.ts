export type BrightnessMode = "sun" | "night";
export type SurfaceMode = "normal" | "paper";
export type TraumaTheme =
  | "warm-light"
  | "black-dark"
  | "paper-warm-light"
  | "paper-black-dark";
export type ThemeName = "light" | "midnight" | "paper" | "hermes";

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

export function themeNameFromPreference(input: {
  brightness: BrightnessMode;
  surface: SurfaceMode;
}): ThemeName {
  if (input.surface === "paper" && input.brightness === "night") {
    return "hermes";
  }

  if (input.surface === "paper") {
    return "paper";
  }

  if (input.brightness === "sun") {
    return "light";
  }

  return "midnight";
}
