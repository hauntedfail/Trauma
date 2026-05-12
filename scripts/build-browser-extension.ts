import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(root, "extensions/browser");
const sourceRoot = join(extensionRoot, "src");
const distRoot = join(extensionRoot, "dist");

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

const build = await Bun.build({
  entrypoints: [
    join(sourceRoot, "popup.ts"),
    join(sourceRoot, "service-worker.ts"),
  ],
  outdir: distRoot,
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "external",
  naming: "[name].js",
});

if (!build.success) {
  for (const log of build.logs) {
    console.error(log);
  }
  process.exit(1);
}

await Promise.all([
  copyFile(join(extensionRoot, "manifest.json"), join(distRoot, "manifest.json")),
  copyFile(join(sourceRoot, "popup.html"), join(distRoot, "popup.html")),
]);

console.log(`Built TRAUMA browser extension at ${distRoot}`);
