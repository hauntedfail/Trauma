import { appendFileSync, readFileSync } from "node:fs";

import { evaluateReleaseTag } from "./release-contract";

interface PackageJson {
  version?: unknown;
}

const outputPath = process.env.GITHUB_OUTPUT;
if (!outputPath) {
  throw new Error("GITHUB_OUTPUT is required");
}

const tagName = process.env.GITHUB_REF_NAME ?? "";
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const packageVersion =
  typeof packageJson.version === "string" ? packageJson.version : "";
const decision = evaluateReleaseTag(tagName, packageVersion);

if (decision.kind === "skip") {
  appendFileSync(outputPath, "valid=false\n", "utf8");
  console.log(
    `::notice title=Skipped release::Tag ${JSON.stringify(tagName)} is not a three-part numeric semantic version.`,
  );
} else if (decision.kind === "error") {
  appendFileSync(outputPath, "valid=false\n", "utf8");

  const detail =
    decision.reason === "version-mismatch"
      ? `tag version ${JSON.stringify(decision.tagVersion)} does not match package.json version ${JSON.stringify(decision.packageVersion)}`
      : `package.json version ${JSON.stringify(decision.packageVersion)} is not a three-part numeric semantic version`;
  console.error(`::error title=Invalid release version::${detail}.`);
  process.exitCode = 1;
} else {
  appendFileSync(
    outputPath,
    `valid=true\ntag_name=${decision.tagName}\nversion=${decision.version}\n`,
    "utf8",
  );
}
