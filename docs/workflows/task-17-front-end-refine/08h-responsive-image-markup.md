# Task 17.8h: Responsive Image Markup

## Intent

Make TRAUMA images responsive at the HTML layer so browsers can choose suitable
image resources instead of downloading one oversized image and relying on CSS
`max-width`.

Read [08a Responsive Strategy And Rules](08a-responsive-strategy-and-rules.md)
before starting, and execute this after
[08d Component Responsive Implementation](08d-component-responsive-implementation.md).

## Files

- Modify: `src/components/brand/TraumaMark.tsx`
- Modify: `src/server/importer/extractor.ts`
- Modify: `src/server/reader/markdown-renderer.ts`
- Modify: `tests/components/brand-assets.test.ts`
- Modify: `tests/server/importer/extractor.test.ts`
- Modify: `tests/server/reader/markdown-renderer.test.ts`

## Rules

- `max-width: 100%` remains only a visual overflow guard.
- Use `srcset` and `sizes` when real width variants exist.
- Use `<picture>` and `<source>` for format alternatives or art direction.
- Do not fabricate `srcset` by repeating the same URL with different
  descriptors.
- Preserve responsive reader/importer image markup only after URL sanitization.
- If imported content has only one trustworthy image URL, keep a plain Markdown
  image or `img` fallback and document that no responsive variants existed.

## Steps

- [ ] **Step 1: Add reader renderer tests for responsive image markup**

In `tests/server/reader/markdown-renderer.test.ts`, add:

```ts
it("preserves sanitized responsive image markup", () => {
  const result = renderMemoryMarkdown([
    "<picture>",
    '<source type="image/avif" media="(width <= 48rem)" srcset="https://cdn.example.test/photo-480.avif 480w, https://cdn.example.test/photo-960.avif 960w" sizes="(width <= 48rem) 90vw, 48rem">',
    '<source type="image/webp" srcset="https://cdn.example.test/photo-480.webp 480w, https://cdn.example.test/photo-960.webp 960w" sizes="(width <= 48rem) 90vw, 48rem">',
    '<img src="https://cdn.example.test/photo-960.jpg" srcset="https://cdn.example.test/photo-480.jpg 480w, https://cdn.example.test/photo-960.jpg 960w" sizes="(width <= 48rem) 90vw, 48rem" alt="Diagram" width="960" height="540">',
    "</picture>",
  ].join(""));

  expect(result.html).toContain("<picture>");
  expect(result.html).toContain('<source type="image/avif"');
  expect(result.html).toContain('srcset="https://cdn.example.test/photo-480.avif 480w, https://cdn.example.test/photo-960.avif 960w"');
  expect(result.html).toContain('sizes="(width &lt;= 48rem) 90vw, 48rem"');
  expect(result.html).toContain('src="https://cdn.example.test/photo-960.jpg"');
  expect(result.html).toContain('loading="lazy"');
  expect(result.html).toContain('decoding="async"');
});

it("strips unsafe responsive image candidates", () => {
  const result = renderMemoryMarkdown([
    '<img src="https://cdn.example.test/photo.jpg" srcset="javascript:alert(1) 320w, https://cdn.example.test/photo-640.jpg 640w, data:image/png;base64,abc 960w" sizes="100vw" alt="Safe">',
    '<source srcset="javascript:alert(1) 320w" type="image/webp">',
  ].join(""));

  expect(result.html).toContain('src="https://cdn.example.test/photo.jpg"');
  expect(result.html).toContain('srcset="https://cdn.example.test/photo-640.jpg 640w"');
  expect(result.html).not.toContain("javascript:");
  expect(result.html).not.toContain("data:image");
  expect(result.html).not.toContain("<source");
});
```

- [ ] **Step 2: Add importer tests for preserving source image variants**

In `tests/server/importer/extractor.test.ts`, add a fixture where the source
HTML contains a responsive image:

```ts
it("preserves safe responsive image variants from extracted HTML", async () => {
  const result = await extractArticleWithDefuddle({
    html: [
      "<main>",
      "<p>This article has enough readable words to preserve responsive image metadata without changing extraction fallback behavior.</p>",
      "<picture>",
      '<source type="image/avif" srcset="/photo-480.avif 480w, /photo-960.avif 960w" sizes="(width <= 48rem) 90vw, 48rem">',
      '<img src="/photo-960.jpg" srcset="/photo-480.jpg 480w, /photo-960.jpg 960w" sizes="(width <= 48rem) 90vw, 48rem" alt="Diagram" width="960" height="540">',
      "</picture>",
      "</main>",
    ].join(""),
    pageUrl: "https://example.com/article",
  });

  expect(result.markdown).toContain("<picture>");
  expect(result.markdown).toContain('srcset="https://example.com/photo-480.avif 480w, https://example.com/photo-960.avif 960w"');
  expect(result.markdown).toContain('sizes="(width &lt;= 48rem) 90vw, 48rem"');
  expect(result.markdown).toContain('src="https://example.com/photo-960.jpg"');
});
```

Also add a negative test with `javascript:`, `data:`, and private-host
candidates. Expected: unsafe candidates are removed; if no safe candidate
remains, the `srcset` attribute is omitted.

- [ ] **Step 3: Add brand mark responsive markup test**

In `tests/components/brand-assets.test.ts`, update the decorative image test:

```ts
expect(html).toContain("<picture");
expect(html).toContain("<source");
expect(html).toContain('srcset="/assets/trauma-mark.svg"');
expect(html).toContain('type="image/svg+xml"');
expect(html).toContain('src="/assets/trauma-mark.png"');
expect(html).toContain('decoding="async"');
```

Do not assert a fake raster `srcset` for the PNG fallback unless real raster
variants are generated in this same task.

- [ ] **Step 4: Implement reader responsive image sanitization**

In `src/server/reader/markdown-renderer.ts`:

- Allow `picture` and `source` tags.
- Allow `img` attributes `srcset`, `sizes`, and `decoding`.
- Allow `source` attributes `media`, `sizes`, `srcset`, and `type`.
- Add a `sanitizeSourceSet` helper that parses comma-separated candidates,
  keeps only `http:` and `https:` URLs, and keeps only width descriptors such as
  `480w` or density descriptors such as `2x`.
- Add `sanitizePictureSource` that drops a `<source>` tag when `srcset` has no
  safe candidates.
- Extend `sanitizeImage` to preserve sanitized `srcset` and `sizes`, set
  `loading` to `lazy` by default, and set `decoding` to `async` by default.

- [ ] **Step 5: Preserve responsive image metadata during import**

In `src/server/importer/extractor.ts`:

- Detect `<picture>...</picture>` before the existing `<img>` replacement.
- Resolve each `src` and `srcset` candidate through the existing
  `resolveSafeDisplayUrl(pageUrl, value)` policy.
- Preserve safe responsive image markup as protected HTML in the generated
  Markdown.
- Keep the existing Markdown image output for simple images without responsive
  variants.
- Do not download, proxy, resize, or cache remote images in this task.

- [ ] **Step 6: Update `TraumaMark` to use an SVG source with PNG fallback**

In `src/components/brand/TraumaMark.tsx`, render:

```tsx
<picture>
  <source srcSet="/assets/trauma-mark.svg" type="image/svg+xml" />
  <img
    alt=""
    aria-hidden="true"
    class={props.class}
    decoding="async"
    height={size()}
    src="/assets/trauma-mark.png"
    style={{ display: "block", "object-fit": "contain" }}
    width={size()}
  />
</picture>
```

Keep the component decorative and keep the PNG fallback because existing
favicon/asset tests require the public PNG asset to remain shipped.

- [ ] **Step 7: Run targeted tests**

```bash
mise exec -- bun --bun x vitest run tests/server/reader/markdown-renderer.test.ts tests/server/importer/extractor.test.ts tests/components/brand-assets.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run responsive contract tests**

```bash
mise exec -- bun --bun x vitest run tests/components/mobile-responsive-contract.test.ts tests/components/app-shell.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit responsive image markup**

```bash
git add src/components/brand/TraumaMark.tsx src/server/importer/extractor.ts src/server/reader/markdown-renderer.ts tests/components/brand-assets.test.ts tests/server/importer/extractor.test.ts tests/server/reader/markdown-renderer.test.ts tests/components/mobile-responsive-contract.test.ts
git commit -m "feat: preserve responsive image markup"
```
