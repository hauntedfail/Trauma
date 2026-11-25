import type { FocusPluginRegistry } from "../registry";
import type { FocusPluginDefinition } from "../types";

export const READING_RULER_PLUGIN_ID = "reading-ruler";
export const RESUMPTION_BEACON_PLUGIN_ID = "resumption-beacon";
export const ADAPTIVE_AI_PRESENTER_PLUGIN_ID = "adaptive-ai-presenter";
export const EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID = "ephemeral-shelf-triage";

export const READING_RULER_DEFINITION: FocusPluginDefinition = {
  id: READING_RULER_PLUGIN_ID,
  name: "Digital Reading Ruler & Focus Mask",
  description:
    "Guides eye tracking with a configurable overlay bar, lightbox mask, shade, or underline that follows your cursor, scroll, or j/k keys.",
  surface: "reader",
  evidenceLevel: "high",
  evidenceSummary:
    "Niklaus et al. (CHI '23) & Llana et al. (CHI EA '26): configurable digital reading rulers reduce line-skipping and visual clutter across diverse readers.",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "select",
      key: "style",
      label: "Ruler style",
      description: "Choose how the active reading band is emphasized.",
      defaultValue: "lightbox",
      options: [
        { value: "lightbox", label: "Lightbox (dim surround)" },
        { value: "grey-bar", label: "Grey Bar (highlight band)" },
        { value: "shade", label: "Shade (dim below)" },
        { value: "underline", label: "Underline (guide line)" },
      ],
    },
    {
      type: "number",
      key: "windowLines",
      label: "Band height",
      description: "Approximate number of text lines inside the reading window.",
      defaultValue: 2,
      min: 1,
      max: 5,
      step: 1,
      unit: "lines",
    },
    {
      type: "number",
      key: "opacity",
      label: "Mask opacity",
      description: "Strength of the surrounding dim or highlight band.",
      defaultValue: 35,
      min: 10,
      max: 85,
      step: 5,
      unit: "%",
    },
    {
      type: "select",
      key: "followMode",
      label: "Follow mode",
      description: "How the reading ruler moves as you read.",
      defaultValue: "cursor",
      options: [
        { value: "cursor", label: "Follow pointer" },
        { value: "scroll-center", label: "Center of viewport" },
        { value: "keyboard", label: "Keyboard only (j / k)" },
      ],
    },
    {
      type: "boolean",
      key: "keyboardNavigation",
      label: "Enable j/k stepping",
      description: "Press j or k while reading to nudge the ruler down or up.",
      defaultValue: true,
    },
  ],
};

export const RESUMPTION_BEACON_DEFINITION: FocusPluginDefinition = {
  id: RESUMPTION_BEACON_PLUGIN_ID,
  name: "Context-Switch Resumption Beacon",
  description:
    "Reads your saved reading position and adds a context highlight plus a one-click Jump to Last Spot cue when you return.",
  surface: "reader",
  evidenceLevel: "high",
  evidenceSummary:
    "Jo, Kim, & Seo (CHI '15, EyeBookmark) & AttentionGuard (arXiv '26): multi-sentence context cues significantly cut resumption lag after interruptions.",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "select",
      key: "awayThresholdSeconds",
      label: "Away threshold",
      description: "How long away from the tab before auto-showing the resumption cue.",
      defaultValue: "30",
      options: [
        { value: "15", label: "15 seconds" },
        { value: "30", label: "30 seconds" },
        { value: "120", label: "2 minutes" },
      ],
    },
    {
      type: "select",
      key: "cueStyle",
      label: "Context cue style",
      description: "Highlight only the saved block or include the preceding block for context.",
      defaultValue: "context-pair",
      options: [
        { value: "context-pair", label: "Previous + current block" },
        { value: "single-block", label: "Current block only" },
      ],
    },
    {
      type: "number",
      key: "fadeSeconds",
      label: "Highlight fade",
      description: "Seconds before the resumption highlight gently fades out.",
      defaultValue: 8,
      min: 3,
      max: 30,
      step: 1,
      unit: "s",
    },
  ],
};

export const ADAPTIVE_AI_PRESENTER_DEFINITION: FocusPluginDefinition = {
  id: ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
  name: "Adaptive AI Response Restructurer",
  description:
    "Restructures verbose Psychiatrist replies into a scannable TL;DR and collapsible key points with a persistent Adapted / Original toggle.",
  surface: "psychiatrist",
  evidenceLevel: "moderate",
  evidenceSummary:
    "Adapt AI (ACM C&C '26) & Rahman et al. (ACL NLP4PI '26): presentation-layer chunking with an Original toggle reduces working-memory overload.",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "select",
      key: "defaultView",
      label: "Default view",
      description: "Choose whether Psychiatrist answers open in Adapted or Original view.",
      defaultValue: "adapted",
      options: [
        { value: "adapted", label: "Adapted (scannable)" },
        { value: "original", label: "Original prose" },
      ],
    },
    {
      type: "number",
      key: "maxBullets",
      label: "Visible points before fold",
      description: "Maximum bullet points shown before collapsing the rest.",
      defaultValue: 3,
      min: 2,
      max: 8,
      step: 1,
      unit: "items",
    },
    {
      type: "boolean",
      key: "highlightAnchors",
      label: "Highlight anchor terms",
      description: "Emphasize leading concepts and key terms in adapted bullets.",
      defaultValue: true,
    },
  ],
};

export const EPHEMERAL_SHELF_TRIAGE_DEFINITION: FocusPluginDefinition = {
  id: EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
  name: "Ephemeral Shelf & Deferred Triage",
  description:
    "Supplies Shelf TTL expiry and Today pick cap parameters to the Shelf and Today browse lanes without backlog counters.",
  surface: "browse",
  evidenceLevel: "high",
  evidenceSummary:
    "Chang et al. (CHI '21) & Gstell (CHI '26): decoupling an ephemeral shelf from permanent organization reduces saving friction and archive anxiety.",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "select",
      key: "shelfTtlDays",
      label: "Shelf window",
      description: "Shelf items older than this window are expired according to the Shelf expiry action.",
      defaultValue: "14",
      options: [
        { value: "7", label: "7 days" },
        { value: "14", label: "14 days" },
        { value: "30", label: "30 days" },
      ],
    },
    {
      type: "select",
      key: "shelfExpiryAction",
      label: "Shelf expiry action",
      description: "Choose whether expired Shelf items are marked subtly or automatically soft-archived.",
      defaultValue: "mark",
      options: [
        { value: "mark", label: "Mark as older on Shelf" },
        { value: "soft-archive", label: "Soft-archive quietly" },
      ],
    },
    {
      type: "number",
      key: "dailyPickCap",
      label: "Today pick cap",
      description: "Maximum items allowed in Today when picking from Shelf.",
      defaultValue: 3,
      min: 1,
      max: 5,
      step: 1,
      unit: "items",
    },
    {
      type: "boolean",
      key: "rsdSafeLabels",
      label: "RSD-safe neutral counts",
      description: "Avoid numeric unread debt counters and use calm descriptive labels.",
      defaultValue: true,
    },
  ],
};

export const BUILTIN_FOCUS_PLUGINS: readonly FocusPluginDefinition[] = [
  READING_RULER_DEFINITION,
  RESUMPTION_BEACON_DEFINITION,
  ADAPTIVE_AI_PRESENTER_DEFINITION,
  EPHEMERAL_SHELF_TRIAGE_DEFINITION,
];

export function registerBuiltinFocusPlugins(
  registry: FocusPluginRegistry,
): void {
  for (const definition of BUILTIN_FOCUS_PLUGINS) {
    if (!registry.has(definition.id)) {
      registry.register(definition);
    }
  }
}
