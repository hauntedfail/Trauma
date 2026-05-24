---
id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f905"
url: "https://example.com/brilliant"
title: "Segment Translation Fixture"
captured_at: "2026-05-21T00:00:00.000Z"
extraction_status: "success"
---
# Segment Translation for Reader Archives

## Abstract

We evaluate a local-first reader archive that translates article prose while preserving Markdown syntax [Smith et al., 2024].

## Method

The system keeps inline math such as $p(y|x)$ unchanged and translates only surrounding prose.

$$
\operatorname*{argmax}_y p(y|x)
$$

| Component | Requirement |
| --- | --- |
| Parser | Preserve structure |
| Translator | Return segments |

> Block quotes remain block quotes even when their text changes.

Use `inlineCode` and fenced code without translation:

```ts
const preserved = "code";
```

See [the reference implementation](https://example.com/reference "Reference title").

[^1]: Footnotes may contain prose and [links](https://example.com/footnote).

## References

Smith, A. and Lee, K. (2024). Segment translation for structured documents.
