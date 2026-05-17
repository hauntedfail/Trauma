import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageJson {
  devDependencies: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const appConfig = readFileSync("app.config.ts", "utf8");
const appRoot = readFileSync("src/app.tsx", "utf8");

describe("Tailwind migration contract", () => {
  it("uses Tailwind's Vite integration", () => {
    expect(packageJson.devDependencies.tailwindcss).toBeDefined();
    expect(packageJson.devDependencies["@tailwindcss/vite"]).toBeDefined();
    expect(packageJson.devDependencies["@tailwindcss/typography"]).toBeDefined();
    expect(appConfig).toContain('from "@tailwindcss/vite"');
    expect(appConfig).toContain("tailwindcss()");
  });

  it("uses a Tailwind CSS entry instead of the removed app stylesheet", () => {
    expect(existsSync("src/styles/app.css")).toBe(false);
    expect(existsSync("src/styles/tailwind.css")).toBe(true);
    expect(appRoot).toContain('import "./styles/tailwind.css";');
    expect(appRoot).not.toContain('import "./styles/app.css";');
  });

  it("keeps old semantic classes out of component styling", () => {
    const sourceFiles = [
      "src/components/shell/AppShell.tsx",
      "src/components/memories/MemoryBrowse.tsx",
      "src/components/reader/MemoryReader.tsx",
      "src/routes/flashbacks/index.tsx",
      "src/routes/[...404].tsx",
      "src/routes/memories/[id].tsx",
    ];
    const forbiddenClasses = [
      "app-shell",
      "left-nav",
      "right-panel",
      "timeline",
      "memory-item",
      "reader-content",
      "reader-page",
      "reader-state",
      "filter-panel",
      "drawer-backdrop",
      "drawer-panel",
    ];

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(sourceFile, "utf8");
      for (const className of forbiddenClasses) {
        const exactClassPattern = new RegExp(`class="[^"]*\\b${className}\\b`);
        expect(source, `${sourceFile} still uses CSS class ${className}`).not.toMatch(
          exactClassPattern,
        );
      }
    }
  });
});
