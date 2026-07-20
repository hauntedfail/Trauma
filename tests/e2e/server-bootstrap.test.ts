import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureE2eServerBootFixture } from "../../e2e/server-bootstrap";
import {
  createFixtureConfig,
  resolveE2eFixtureLayout,
} from "../../src/server/e2e/fixture-layout";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("E2E server bootstrap", () => {
  it("preseeds a clean fixture root before middleware startup", async () => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);

    expect(ensureE2eServerBootFixture(root)).toBe(layout.configFile);
    expect(JSON.parse(readFileSync(layout.configFile, "utf8"))).toEqual(
      createFixtureConfig(false),
    );
    expect(existsSync(layout.storePath)).toBe(true);
    expect(existsSync(join(root, "runtime"))).toBe(true);
  });

  it("does not overwrite fixture state left by a prior action", async () => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    ensureE2eServerBootFixture(root);
    const existing = `${JSON.stringify(createFixtureConfig(true), null, 2)}\n`;
    await writeFile(layout.configFile, existing, "utf8");

    ensureE2eServerBootFixture(root);

    expect(readFileSync(layout.configFile, "utf8")).toBe(existing);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-e2e-bootstrap-"));
  roots.push(root);
  return root;
}
