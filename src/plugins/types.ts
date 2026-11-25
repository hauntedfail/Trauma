export type FocusPluginSurface = "reader" | "psychiatrist" | "browse" | "global";

export type FocusPluginEvidenceLevel =
  | "high"
  | "moderate"
  | "experimental"
  | "low";

export type FocusPluginSettingValue = boolean | number | string;

export type FocusPluginSettingValues = Record<string, FocusPluginSettingValue>;

export interface FocusPluginBooleanField {
  readonly type: "boolean";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultValue: boolean;
}

export interface FocusPluginNumberField {
  readonly type: "number";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultValue: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface FocusPluginSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface FocusPluginSelectField {
  readonly type: "select";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultValue: string;
  readonly options: readonly FocusPluginSelectOption[];
}

export type FocusPluginSettingField =
  | FocusPluginBooleanField
  | FocusPluginNumberField
  | FocusPluginSelectField;

export type FocusPluginSettingsSchema = readonly FocusPluginSettingField[];

export interface FocusPluginDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly surface: FocusPluginSurface;
  readonly evidenceLevel: FocusPluginEvidenceLevel;
  readonly evidenceSummary?: string;
  readonly defaultEnabled: boolean;
  readonly settingsSchema: FocusPluginSettingsSchema;
}

export interface FocusPluginInstanceState {
  enabled: boolean;
  settings: FocusPluginSettingValues;
}

export type FocusPluginPulseRating = "helped" | "neutral" | "distracting";

export interface FocusPluginPulseEntry {
  readonly id: string;
  readonly rating: FocusPluginPulseRating;
  readonly timestamp: string;
  readonly activePluginIds: readonly string[];
  readonly surface?: FocusPluginSurface;
  readonly pluginId?: string;
  readonly note?: string;
}

export interface FocusPluginState {
  readonly version: 1;
  plugins: Record<string, FocusPluginInstanceState>;
  pulseLog: FocusPluginPulseEntry[];
}
