import { describe, expect, it } from "vitest";

import { applyDocumentSecurityHeaders } from "../../src/server/http/document-security";

describe("document response security headers", () => {
  it("prevents mutable application pages from being framed", () => {
    const headers = new Headers();

    applyDocumentSecurityHeaders(headers);

    expect(headers.get("content-security-policy"))
      .toBe("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });
});
