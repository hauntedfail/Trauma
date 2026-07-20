import { existsSync, readFileSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { ensureE2eServerBootFixture } from "../../e2e/server-bootstrap";
import {
  createFixtureConfig,
  resolveE2eFixtureLayout,
} from "../../src/server/e2e/fixture-layout";
import { resolveRuntimeLeaseCoordinatorPath } from "../../src/server/runtime/process-lease";

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

  it("accepts valid prior backup settings without overwriting them", async () => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    ensureE2eServerBootFixture(root);
    const existing = `${JSON.stringify(createFixtureConfig(true), null, 2)}\n`;
    await writeFile(layout.configFile, existing, "utf8");

    ensureE2eServerBootFixture(root);

    expect(readFileSync(layout.configFile, "utf8")).toBe(existing);
  });

  it.each([
    ["invalid JSON", "{not-json", /Invalid JSON in trauma config/],
    [
      "a partial schema",
      JSON.stringify({
        databasePath: "./runtime/trauma.sqlite",
        projectPath: "./project",
      }),
      /Invalid trauma config/,
    ],
  ])("rejects %s without overwriting or preparing storage", async (
    _label,
    existing,
    expectedError,
  ) => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    await writeFile(layout.configFile, existing, "utf8");

    expect(() => ensureE2eServerBootFixture(root)).toThrow(expectedError);

    expect(readFileSync(layout.configFile, "utf8")).toBe(existing);
    expect(existsSync(layout.projectPath)).toBe(false);
    expect(existsSync(dirname(layout.databasePath))).toBe(false);
  });

  it.each([
    [
      "projectPath",
      {
        ...createFixtureConfig(false),
        projectPath: "../outside-project",
        storePath: "../outside-project/store",
      },
    ],
    [
      "storePath",
      {
        ...createFixtureConfig(false),
        storePath: "./project/other-store",
      },
    ],
    [
      "databasePath",
      {
        ...createFixtureConfig(false),
        databasePath: "../outside-runtime/trauma.sqlite",
      },
    ],
  ])("rejects a stale %s before preparing any fixed storage", async (
    field,
    config,
  ) => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    const existing = `${JSON.stringify(config, null, 2)}\n`;
    await writeFile(layout.configFile, existing, "utf8");
    const coordinatorRowsBefore = countCoordinatorRows();

    expect(() => ensureE2eServerBootFixture(root)).toThrow(
      new RegExp(`E2E fixture ${field} must resolve to the fixed path`),
    );

    expect(readFileSync(layout.configFile, "utf8")).toBe(existing);
    expect(existsSync(layout.projectPath)).toBe(false);
    expect(existsSync(dirname(layout.databasePath))).toBe(false);
    expect(countCoordinatorRows()).toBe(coordinatorRowsBefore);
  });

  it("rejects a symlinked config file without following or overwriting it", async () => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    const externalConfig = join(root, "external.config.json");
    const existing = `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`;
    await writeFile(externalConfig, existing, "utf8");
    await symlink(externalConfig, layout.configFile, "file");

    expect(() => ensureE2eServerBootFixture(root)).toThrow(
      /E2E fixture path must not be a symbolic link/,
    );

    expect(readFileSync(externalConfig, "utf8")).toBe(existing);
    expect(existsSync(layout.projectPath)).toBe(false);
  });

  it("rejects a symlinked fixture parent before creating an escaped root", async () => {
    const container = await createRoot();
    const externalRoot = await createRoot();
    const parentAlias = join(container, "fixture-parent");
    const root = join(parentAlias, "e2e");
    await symlink(externalRoot, parentAlias, "dir");

    expect(() => ensureE2eServerBootFixture(root)).toThrow(
      /E2E fixture path must not be a symbolic link/,
    );

    expect(existsSync(join(externalRoot, "e2e"))).toBe(false);
  });

  it.each([
    ["projectPath", "project", "dir"],
    ["storePath", "project/store", "dir"],
    ["databasePath", "runtime/trauma.sqlite", "file"],
  ] as const)("rejects a symlinked fixed %s without touching its target", async (
    _field,
    fixturePath,
    type,
  ) => {
    const root = await createRoot();
    const layout = resolveE2eFixtureLayout(root);
    const externalRoot = await createRoot();
    const target = type === "dir"
      ? join(externalRoot, "target")
      : join(externalRoot, "target.sqlite");
    const existingConfig = `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`;
    if (type === "dir") {
      await mkdir(target, { recursive: true });
    } else {
      await writeFile(target, "outside", "utf8");
      await mkdir(dirname(join(root, fixturePath)), { recursive: true });
    }
    await writeFile(
      layout.configFile,
      existingConfig,
      "utf8",
    );
    await mkdir(dirname(join(root, fixturePath)), { recursive: true });
    await symlink(target, join(root, fixturePath), type);

    expect(() => ensureE2eServerBootFixture(root)).toThrow(
      /E2E fixture path must not be a symbolic link/,
    );

    expect(readFileSync(layout.configFile, "utf8")).toBe(existingConfig);
    if (type === "dir") {
      expect(existsSync(join(target, "store"))).toBe(false);
    } else {
      expect(readFileSync(target, "utf8")).toBe("outside");
    }
  });

  it.each(["-wal", "-shm", "-journal"])(
    "rejects a symlinked fixed database%s sidecar without touching its target",
    async (suffix) => {
      const root = await createRoot();
      const layout = resolveE2eFixtureLayout(root);
      const externalRoot = await createRoot();
      const target = join(externalRoot, `target${suffix}`);
      const sidecar = `${layout.databasePath}${suffix}`;
      const existingConfig = `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`;
      await mkdir(dirname(sidecar), { recursive: true });
      await writeFile(layout.configFile, existingConfig, "utf8");
      await writeFile(target, "outside", "utf8");
      await symlink(target, sidecar, "file");

      expect(() => ensureE2eServerBootFixture(root)).toThrow(
        /E2E fixture path must not be a symbolic link/,
      );

      expect(readFileSync(layout.configFile, "utf8")).toBe(existingConfig);
      expect(readFileSync(target, "utf8")).toBe("outside");
    },
  );

  it.each(["", "-wal", "-shm", "-journal"])(
    "rejects a non-file fixed database%s family entry",
    async (suffix) => {
      const root = await createRoot();
      const layout = resolveE2eFixtureLayout(root);
      const familyPath = `${layout.databasePath}${suffix}`;
      const existingConfig = `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`;
      await mkdir(familyPath, { recursive: true });
      await writeFile(layout.configFile, existingConfig, "utf8");

      expect(() => ensureE2eServerBootFixture(root)).toThrow(
        /E2E fixture path must be a regular file/,
      );

      expect(readFileSync(layout.configFile, "utf8")).toBe(existingConfig);
    },
  );

  it.each(["", "-wal", "-shm", "-journal"])(
    "rejects a hardlinked fixed database%s family entry without touching its peer",
    async (suffix) => {
      const root = await createRoot();
      const layout = resolveE2eFixtureLayout(root);
      const externalRoot = await createRoot();
      const target = join(externalRoot, `target${suffix || ".sqlite"}`);
      const familyPath = `${layout.databasePath}${suffix}`;
      const existingConfig = `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`;
      await mkdir(dirname(familyPath), { recursive: true });
      await writeFile(layout.configFile, existingConfig, "utf8");
      await writeFile(target, "outside", "utf8");
      await link(target, familyPath);

      expect(() => ensureE2eServerBootFixture(root)).toThrow(
        /E2E fixture database file must not have hardlink aliases/,
      );

      expect(readFileSync(layout.configFile, "utf8")).toBe(existingConfig);
      expect(readFileSync(target, "utf8")).toBe("outside");
    },
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-e2e-bootstrap-"));
  roots.push(root);
  return root;
}

function countCoordinatorRows(): number {
  const path = resolveRuntimeLeaseCoordinatorPath();
  if (!existsSync(path)) {
    return 0;
  }
  const database = new Database(path, { readonly: true });
  try {
    return database
      .query<{ count: number }, []>(
        "SELECT count(*) AS count FROM coordinator_leases",
      )
      .get()?.count ?? 0;
  } finally {
    database.close();
  }
}
