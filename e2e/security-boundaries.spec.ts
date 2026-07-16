import { expect, test } from "@playwright/test";

test("rejects hostile Host headers before reads or mutations", async ({ request }) => {
  const hostileHeaders = {
    Host: "attacker.example",
    Origin: "http://attacker.example",
  };

  const readResponse = await request.get("/api/settings", {
    headers: hostileHeaders,
  });
  expectHostRequestRejected(readResponse.status());

  const mutationResponse = await request.patch("/api/settings", {
    data: { translationTargetLanguage: "ja-JP" },
    headers: hostileHeaders,
  });
  expectHostRequestRejected(mutationResponse.status());
});

test("accepts the configured loopback server host", async ({ request }) => {
  const response = await request.get("/memories");

  expect(response.status()).toBe(200);
});

test("does not expose backup reconciliation through GET", async ({ request }) => {
  const response = await request.get("/api/backup/failsafe");

  expect(response.status()).toBe(404);
});

function expectHostRequestRejected(status: number): void {
  if (process.env.CI) {
    expect(status).toBe(421);
    return;
  }

  // Vite may reject an untrusted Host with 403 before app middleware can return
  // its production 421 response. Both boundaries must stay fail-closed.
  expect([403, 421]).toContain(status);
}
