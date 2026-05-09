import type { BrowseMemory } from "./browse-data";

export const browseFixtureMemories: BrowseMemory[] = [
  {
    id: "memory-foundation",
    title: "Reader Mode Notes",
    url: "https://example.com/reader-mode",
    description: "SolidStart route data and shell architecture notes for the canonical reader.",
    capturedAt: "2026-05-09",
    categories: [{ id: "research", name: "Research" }],
    tags: [
      { id: "solidstart", name: "solidstart" },
      { id: "reader", name: "reader" },
    ],
    highlights: [
      {
        id: "h-foundation",
        text: "highlight-aware results",
        prefix: "Search query can be wired to",
        suffix: "through repository fixtures.",
        createdAt: "2026-05-09T12:00:00.000Z",
      },
    ],
  },
  {
    id: "memory-ops",
    title: "Local Hosting Checklist",
    url: "https://example.com/local-hosting",
    description: "Single Bun process and persistent disk assumptions for self-hosted operation.",
    capturedAt: "2026-05-08",
    categories: [{ id: "operations", name: "Operations" }],
    tags: [
      { id: "sqlite", name: "sqlite" },
      { id: "backup", name: "backup" },
    ],
    highlights: [
      {
        id: "h-ops",
        text: "persistent disk assumptions",
        prefix: "The app keeps deployment simple with",
        suffix: "and a markdown store.",
        createdAt: "2026-05-08T12:00:00.000Z",
      },
    ],
  },
  {
    id: "memory-design",
    title: "Browse Shell Sketch",
    url: "https://example.com/browse-shell",
    description: "X-like layout notes for navigation, filters, and dense memory browsing.",
    capturedAt: "2026-05-07",
    categories: [{ id: "product", name: "Product" }],
    tags: [
      { id: "shell", name: "shell" },
      { id: "filters", name: "filters" },
    ],
    highlights: [
      {
        id: "h-shell",
        text: "right filter panel updates URL state",
        prefix: "The canonical browse workflow requires that the",
        suffix: "without page-local navigation.",
        createdAt: "2026-05-07T12:00:00.000Z",
      },
    ],
  },
];
