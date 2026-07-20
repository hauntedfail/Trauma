const numericVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const releaseTagPattern = /^v?([0-9]+\.[0-9]+\.[0-9]+)$/;

export type ReleaseTagDecision =
  | {
      kind: "release";
      tagName: string;
      version: string;
    }
  | {
      kind: "skip";
      reason: "invalid-tag-format";
      tagName: string;
    }
  | {
      kind: "error";
      packageVersion: string;
      reason: "invalid-package-version";
      tagName: string;
    }
  | {
      kind: "error";
      packageVersion: string;
      reason: "version-mismatch";
      tagName: string;
      tagVersion: string;
    };

export function evaluateReleaseTag(
  tagName: string,
  packageVersion: string,
): ReleaseTagDecision {
  const tagMatch = releaseTagPattern.exec(tagName);
  if (!tagMatch) {
    return {
      kind: "skip",
      reason: "invalid-tag-format",
      tagName,
    };
  }

  if (!numericVersionPattern.test(packageVersion)) {
    return {
      kind: "error",
      packageVersion,
      reason: "invalid-package-version",
      tagName,
    };
  }

  const tagVersion = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  if (tagVersion !== packageVersion) {
    return {
      kind: "error",
      packageVersion,
      reason: "version-mismatch",
      tagName,
      tagVersion,
    };
  }

  return {
    kind: "release",
    tagName,
    version: tagVersion,
  };
}
