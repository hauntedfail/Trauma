# Task 16c.1: Dependency And Runtime Boundary

## Goal

Introduce Defuddle v0.18+ and the minimum DOM runtime needed for server-side
content extraction without changing importer behavior yet.

## Ownership

Primary files:

- `package.json`
- `bun.lock`
- `tests/server/importer/importer.test.ts`

Conditional files:

- `docs/references/technology-stack.md` if dependency rationale is recorded in
  the same PR.

## Required Decisions

- Use `defuddle@^0.18.0` or higher.
- Prefer `linkedom` as the DOM implementation.
- Use `jsdom` only if a focused spike proves `linkedom` cannot satisfy Defuddle
  v0.18+ extraction for the representative fixtures.

## Execution Steps

1. Verify package availability:

   ```bash
   mise exec -- bun info defuddle version
   ```

   Expected: printed version is `0.18.0` or higher. If the registry reports a
   lower latest version, stop and record the blocker instead of installing an
   older version.

2. Install dependencies:

   ```bash
   mise exec -- bun add "defuddle@^0.18.0" linkedom
   ```

3. Confirm the lockfile records the expected packages:

   ```bash
   rg -n '"defuddle"|"linkedom"' package.json bun.lock
   ```

4. Add a minimal import smoke test in `tests/server/importer/importer.test.ts`
   or a new focused importer test file:

   ```ts
   it("can load the Defuddle node bundle in the Bun test runtime", async () => {
     const [{ Defuddle }, { parseHTML }] = await Promise.all([
       import("defuddle/node"),
       import("linkedom"),
     ]);
     const { document } = parseHTML("<html><body><article>Readable text</article></body></html>");

     expect(typeof Defuddle).toBe("function");
     expect(document.querySelector("article")?.textContent).toBe("Readable text");
   });
   ```

5. Run the focused test:

   ```bash
   mise exec -- bun run test tests/server/importer/importer.test.ts
   ```

6. Commit only dependency and smoke-test changes if this domain is implemented
   as a separate PR:

   ```bash
   git add package.json bun.lock tests/server/importer/importer.test.ts
   git commit -m "chore: add defuddle importer dependency"
   ```

## Acceptance Criteria

- Defuddle v0.18+ is installed.
- The chosen DOM implementation is installed.
- Bun test runtime can import `defuddle/node`.
- No production importer behavior changes are made in this domain plan.
