import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkDocumentation } from "../../scripts/check-docs";

const roots: string[] = [];

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-docs-check-"));
  roots.push(root);

  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }

  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("documentation health check", () => {
  it("accepts an indexed documentation graph and the compatibility shim", async () => {
    const root = await makeRoot({
      "docs/INDEX.md": "# Index\n\n[Current](architecture/current.md#runtime-flow)\n",
      "docs/architecture/current.md":
        "# Current\n\n## Runtime flow\n\nSee the [index](../INDEX.md).\n",
      "docs/references/coding-standards.md":
        "# Compatibility\n\nUse the current standards index.\n",
    });

    await expect(checkDocumentation(root)).resolves.toEqual({
      documentCount: 3,
      indexedDocumentCount: 2,
      localLinkCount: 2,
    });
  });

  it("reports broken targets, missing anchors, and unindexed documents together", async () => {
    const root = await makeRoot({
      "docs/INDEX.md":
        "# Index\n\n[Missing](missing.md)\n\n[Wrong anchor](current.md#absent)\n",
      "docs/current.md": "# Current\n",
      "docs/orphan.md": "# Orphan\n",
    });

    await expect(checkDocumentation(root)).rejects.toThrow(
      /broken local link.*missing\.md[\s\S]*missing anchor.*#absent[\s\S]*orphan\.md.*not reachable/i,
    );
  });

  it("rejects review chronology and retired active-domain routes in semantic docs", async () => {
    const root = await makeRoot({
      "docs/INDEX.md": "# Index\n\n[Current](current.md)\n",
      "docs/current.md":
        "# Current\n\nPR #42 landed in commit deadbeef. Use /highlights now.\n",
    });

    await expect(checkDocumentation(root)).rejects.toThrow(
      /review or commit chronology[\s\S]*retired active-domain route/i,
    );
  });

  it("allows historical chronology and documented compatibility redirects", async () => {
    const root = await makeRoot({
      "docs/INDEX.md":
        "# Index\n\n[Routes](architecture/ui-and-routing.md)\n\n[History](superpowers/specs/history.md)\n",
      "docs/architecture/ui-and-routing.md":
        "# Routes\n\n/highlights redirects to /flashbacks. /flashback redirects to /moments.\n",
      "docs/superpowers/specs/history.md":
        "# Historical record\n\nPR #42 landed in commit deadbeef.\n",
    });

    await expect(checkDocumentation(root)).resolves.toMatchObject({
      documentCount: 3,
      indexedDocumentCount: 3,
    });
  });

  it("checks links in short root documentation entry points", async () => {
    const root = await makeRoot({
      "README.md": "# Project\n\n[Missing guide](docs/missing.md)\n",
      "docs/INDEX.md": "# Index\n",
    });

    await expect(checkDocumentation(root)).rejects.toThrow(
      /README\.md:3 has broken local link: docs\/missing\.md/i,
    );
  });
});
