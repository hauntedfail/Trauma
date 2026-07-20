import { describe, expect, it } from "vitest";

import { isExpectedDevSmokeResponse } from "../../scripts/dev-smoke-response";

describe("dev smoke response contract", () => {
  it("accepts only the canonical root redirect to memories", () => {
    expect(isExpectedDevSmokeResponse(response(302, "/memories"))).toBe(true);

    for (const candidate of [
      response(200, "/memories"),
      response(301, "/memories"),
      response(307, "/memories"),
      response(302, "https://example.com/memories"),
      response(302, "/memories?view=all"),
      response(302, "/flashbacks"),
      response(302),
    ]) {
      expect(isExpectedDevSmokeResponse(candidate)).toBe(false);
    }
  });
});

function response(status: number, location?: string): Response {
  return new Response(null, {
    headers: location === undefined ? undefined : { location },
    status,
  });
}
