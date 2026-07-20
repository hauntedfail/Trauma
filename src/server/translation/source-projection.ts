import {
  projectMarkdownToReaderText,
  type ProjectedMarkdownText,
} from "../store/flashback-markers";

export function projectTranslationMarkdownToReaderText(
  rawMarkdown: string,
): ProjectedMarkdownText {
  if (!rawMarkdown.includes("\r")) {
    return projectMarkdownToReaderText(rawMarkdown);
  }

  const normalizedMarkdown = rawMarkdown.replace(/\r\n?/g, "\n");
  const rawBoundaries = createRawBoundaryMap(
    rawMarkdown,
    normalizedMarkdown.length,
  );
  const projection = projectMarkdownToReaderText(normalizedMarkdown);
  remapOffsetsInPlace(projection.sourceOffsets, rawBoundaries);
  remapOffsetsInPlace(projection.sourceEndOffsets, rawBoundaries);
  return projection;
}

function createRawBoundaryMap(
  rawMarkdown: string,
  normalizedLength: number,
): Uint32Array {
  const rawBoundaries = new Uint32Array(normalizedLength + 1);
  let rawOffset = 0;
  let normalizedOffset = 0;

  while (rawOffset < rawMarkdown.length) {
    if (rawMarkdown[rawOffset] === "\r") {
      rawOffset += rawMarkdown[rawOffset + 1] === "\n" ? 2 : 1;
    } else {
      rawOffset += 1;
    }
    normalizedOffset += 1;
    rawBoundaries[normalizedOffset] = rawOffset;
  }

  if (normalizedOffset !== normalizedLength) {
    throw new RangeError("translation line-ending normalization length mismatch");
  }
  return rawBoundaries;
}

function remapOffsetsInPlace(
  normalizedOffsets: number[],
  rawBoundaries: Uint32Array,
): void {
  for (let index = 0; index < normalizedOffsets.length; index += 1) {
    const normalizedOffset = normalizedOffsets[index];
    const rawOffset = normalizedOffset === undefined
      ? undefined
      : rawBoundaries[normalizedOffset];
    if (rawOffset === undefined) {
      throw new RangeError(
        "translation projection offset is outside normalized Markdown",
      );
    }
    normalizedOffsets[index] = rawOffset;
  }
}
