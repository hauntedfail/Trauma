import { expect, test } from "@playwright/test";

test("rejects hostile Host headers before reads or mutations", async ({ request }) => {
  const hostileHeaders = {
    Host: "attacker.example",
    Origin: "http://attacker.example",
  };

  const readResponse = await request.get("/api/settings", {
    headers: hostileHeaders,
  });
  expect(readResponse.status()).toBe(421);

  const mutationResponse = await request.patch("/api/settings", {
    data: { translationTargetLanguage: "ja-JP" },
    headers: hostileHeaders,
  });
  expect(mutationResponse.status()).toBe(421);
});

test("accepts the configured loopback server host", async ({ request }) => {
  const response = await request.get("/memories");

  expect(response.status()).toBe(200);
});

test("does not expose backup reconciliation through GET", async ({ request }) => {
  const response = await request.get("/api/backup/failsafe");

  expect(response.status()).toBe(404);
});
