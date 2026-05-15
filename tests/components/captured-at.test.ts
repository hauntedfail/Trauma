import { describe, expect, it } from "vitest";

import { formatCapturedAtForDisplay } from "../../src/components/memories/captured-at";

describe("formatCapturedAtForDisplay", () => {
  it("formats date-only values without shifting the calendar day by local timezone", () => {
    expect(formatCapturedAtForDisplay("2026-05-15")).toBe("15 May");
  });

  it("keeps invalid captured-at values visible as originally stored", () => {
    expect(formatCapturedAtForDisplay("not-a-date")).toBe("not-a-date");
  });
});
