import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { transformAsync, type PluginItem } from "@babel/core";
import { afterEach, describe, expect, it } from "vitest";

import { POST as attachCategory } from "../../../src/routes/api/memories/categories";
import { POST as attachTag } from "../../../src/routes/api/memories/tags";
import { POST as createCategory } from "../../../src/routes/api/categories";
import { POST as createTag } from "../../../src/routes/api/tags";
import { initializeDatabase } from "../../../src/server/db";
import {
  createApiEvent,
  loadRouteConfig,
  routeMemoryId,
  seedRouteMemory,
  writeRouteConfig,
} from "./api-test-helpers";

const originalEnv = { ...process.env };
const repositoryRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  process.chdir(repositoryRoot);
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("taxonomy API routes", () => {
  it("creates tags and categories idempotently", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));

    const tagResponse = await createTag(jsonRequest("/api/tags", { name: " sqlite " }));
    const duplicateTagResponse = await createTag(jsonRequest("/api/tags", { name: "sqlite" }));
    const caseDuplicateTagResponse = await createTag(
      jsonRequest("/api/tags", { name: "SQLite" }),
    );
    const categoryResponse = await createCategory(
      jsonRequest("/api/categories", { name: " Research " }),
    );
    const duplicateCategoryResponse = await createCategory(
      jsonRequest("/api/categories", { name: "Research" }),
    );
    const caseDuplicateCategoryResponse = await createCategory(
      jsonRequest("/api/categories", { name: "research" }),
    );

    expect(tagResponse.status).toBe(201);
    expect(duplicateTagResponse.status).toBe(200);
    expect(caseDuplicateTagResponse.status).toBe(200);
    expect(categoryResponse.status).toBe(201);
    expect(duplicateCategoryResponse.status).toBe(200);
    expect(caseDuplicateCategoryResponse.status).toBe(200);
    expect((await tagResponse.json()).tag).toMatchObject({ name: "sqlite" });
    expect((await duplicateTagResponse.json()).tag).toMatchObject({ name: "sqlite" });
    expect((await caseDuplicateTagResponse.json()).tag).toMatchObject({
      name: "sqlite",
    });
    expect((await categoryResponse.json()).category).toMatchObject({ name: "Research" });
    expect((await duplicateCategoryResponse.json()).category).toMatchObject({
      name: "Research",
    });
    expect((await caseDuplicateCategoryResponse.json()).category).toMatchObject({
      name: "Research",
    });

    const connection = initializeDatabase(config);
    try {
      expect(connection.sqlite.prepare("select count(*) as count from tags").get())
        .toEqual({ count: 1 });
      expect(
        connection.sqlite.prepare("select count(*) as count from categories").get(),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
  });

  it("rejects malformed taxonomy creation payloads", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const response = await createTag(
      jsonRequest("/api/tags", { name: "sqlite", extra: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "request body must contain only name",
    });
  });

  it("attaches tags and categories by ID or name", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);

    const createdTag = await (await createTag(jsonRequest("/api/tags", { name: "sqlite" }))).json();
    const createdCategory = await (
      await createCategory(jsonRequest("/api/categories", { name: "Research" }))
    ).json();

    const attachTagById = await attachTag(
      jsonRequest("/api/memories/tags", {
        memoryId: routeMemoryId,
        tagId: createdTag.tag.id,
      }),
    );
    const attachTagByName = await attachTag(
      jsonRequest("/api/memories/tags", {
        memoryId: routeMemoryId,
        name: "runtime",
      }),
    );
    const attachCategoryById = await attachCategory(
      jsonRequest("/api/memories/categories", {
        memoryId: routeMemoryId,
        categoryId: createdCategory.category.id,
      }),
    );
    const attachCategoryByName = await attachCategory(
      jsonRequest("/api/memories/categories", {
        memoryId: routeMemoryId,
        name: "Operations",
      }),
    );

    expect(attachTagById.status).toBe(200);
    expect(attachTagByName.status).toBe(200);
    expect(attachCategoryById.status).toBe(200);
    expect(attachCategoryByName.status).toBe(200);

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite.prepare("select count(*) as count from memory_tags").get(),
      ).toEqual({ count: 2 });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memory_categories")
          .get(),
      ).toEqual({ count: 2 });
    } finally {
      connection.close();
    }
  });

  it("attaches case-insensitive existing taxonomy names instead of creating duplicates", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);

    const createdTag = await (
      await createTag(jsonRequest("/api/tags", { name: "sqlite" }))
    ).json();
    const createdCategory = await (
      await createCategory(jsonRequest("/api/categories", { name: "Research" }))
    ).json();

    const attachTagByName = await attachTag(
      jsonRequest("/api/memories/tags", {
        memoryId: routeMemoryId,
        name: "SQLITE",
      }),
    );
    const attachCategoryByName = await attachCategory(
      jsonRequest("/api/memories/categories", {
        memoryId: routeMemoryId,
        name: "research",
      }),
    );

    expect(attachTagByName.status).toBe(200);
    expect(attachCategoryByName.status).toBe(200);
    expect(await attachTagByName.json()).toMatchObject({
      tagId: createdTag.tag.id,
      tag: { id: createdTag.tag.id, name: "sqlite" },
    });
    expect(await attachCategoryByName.json()).toMatchObject({
      categoryId: createdCategory.category.id,
      category: { id: createdCategory.category.id, name: "Research" },
    });

    const connection = initializeDatabase(config);
    try {
      expect(connection.sqlite.prepare("select count(*) as count from tags").get())
        .toEqual({ count: 1 });
      expect(
        connection.sqlite.prepare("select count(*) as count from categories").get(),
      ).toEqual({ count: 1 });
      expect(
        connection.sqlite.prepare("select count(*) as count from memory_tags").get(),
      ).toEqual({ count: 1 });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memory_categories")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
  });

  it("rejects ambiguous attach payloads and missing records", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);

    const ambiguous = await attachTag(
      jsonRequest("/api/memories/tags", {
        memoryId: routeMemoryId,
        tagId: "tag-id",
        name: "sqlite",
      }),
    );
    const missingTag = await attachTag(
      jsonRequest("/api/memories/tags", {
        memoryId: routeMemoryId,
        tagId: "missing-tag",
      }),
    );
    const missingMemory = await attachCategory(
      jsonRequest("/api/memories/categories", {
        memoryId: "missing-memory",
        name: "Research",
      }),
    );

    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toEqual({
      error: "request body must contain memoryId and exactly one of tagId or name",
    });
    expect(missingTag.status).toBe(404);
    expect(await missingTag.json()).toEqual({ error: "tag was not found" });
    expect(missingMemory.status).toBe(404);
    expect(await missingMemory.json()).toEqual({ error: "memory was not found" });
  });

  it("keeps tag creation POST route helpers available after Vinxi pick transform", async () => {
    const source = await readFile(
      join(repositoryRoot, "src/routes/api/tags.ts"),
      "utf8",
    );
    const treeShakePlugin = await importVinxiTreeShakePlugin();
    const transformed = await transformAsync(source, {
      plugins: [[treeShakePlugin, { pick: ["POST"] }]],
      parserOpts: {
        plugins: ["typescript"],
      },
      filename: "tags.ts?pick=POST",
      ast: false,
      configFile: false,
      babelrc: false,
    });

    expect(transformed?.code).toContain(
      "parseNamePayloadInternal(event.request)",
    );
    expect(transformed?.code).toContain("async function parseNamePayloadInternal");
  });
});

function jsonRequest(path: string, body: unknown) {
  return createApiEvent(
    new Request(`http://localhost${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-taxonomy-"));
  tempDirs.push(root);
  return root;
}

async function importVinxiTreeShakePlugin(): Promise<PluginItem> {
  const module = await import(
    pathToFileURL(
      join(repositoryRoot, "node_modules/vinxi/lib/plugins/tree-shake.babel.js"),
    ).href
  );

  return module.default as PluginItem;
}
