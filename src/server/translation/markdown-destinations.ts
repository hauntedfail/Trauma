export interface MarkdownDestinationRange {
  destination: string;
  end: number;
  start: number;
}

export function readMarkdownDestinationRanges(markdown: string): MarkdownDestinationRange[] {
  const ranges: MarkdownDestinationRange[] = [];
  for (let index = 0; index < markdown.length - 1; index += 1) {
    if (markdown.charAt(index) !== "]" || markdown.charAt(index + 1) !== "(") {
      continue;
    }

    const range = readMarkdownDestinationRange(markdown, index + 2);
    if (range !== null) {
      ranges.push(range);
    }
  }
  return ranges;
}

export function readMarkdownDestinationRange(
  markdown: string,
  start: number,
): MarkdownDestinationRange | null {
  if (markdown.charAt(start) === "<") {
    return readAngleDestinationRange(markdown, start);
  }
  return readBareDestinationRange(markdown, start);
}

function readAngleDestinationRange(
  markdown: string,
  start: number,
): MarkdownDestinationRange | null {
  let end = start + 1;
  while (end < markdown.length) {
    const char = markdown.charAt(end);
    if (char === "\\") {
      end += end + 1 < markdown.length ? 2 : 1;
      continue;
    }
    if (char === ">") {
      return {
        destination: markdown.slice(start, end + 1),
        end: end + 1,
        start,
      };
    }
    end += 1;
  }
  return null;
}

function readBareDestinationRange(
  markdown: string,
  start: number,
): MarkdownDestinationRange | null {
  let end = start;
  let parenthesisDepth = 0;
  while (end < markdown.length) {
    const char = markdown.charAt(end);
    if (char === "\\") {
      end += end + 1 < markdown.length ? 2 : 1;
      continue;
    }
    if (/\s/.test(char) && parenthesisDepth === 0) {
      break;
    }
    if (char === "(") {
      parenthesisDepth += 1;
    } else if (char === ")") {
      if (parenthesisDepth === 0) {
        break;
      }
      parenthesisDepth -= 1;
    }
    end += 1;
  }

  if (end === start) {
    return null;
  }

  return {
    destination: markdown.slice(start, end),
    end,
    start,
  };
}
