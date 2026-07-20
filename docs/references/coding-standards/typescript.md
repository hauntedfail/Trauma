# TypeScript Rules

## Type Safety

- MUST keep TypeScript `strict` clean.
- MUST keep the strict compiler options used by the project, including
  `allowUnreachableCode: false`, `allowUnusedLabels: false`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`,
  `noImplicitReturns`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and
  `noUnusedParameters`.
- MUST treat indexed access and map/object lookups as possibly missing. Narrow
  or guard the value before use instead of adding non-null assertions.
- MUST NOT use `any`, `as any`, or implicit `any`.
- MUST NOT export APIs whose caller must pass or receive `unknown`.
- MUST treat `unknown` as a boundary type only. It is appropriate for
  `catch` bindings, parsed JSON, external extractor output, config file input,
  request bodies, and other untrusted values.
- MUST narrow or validate `unknown` before using it or passing it into domain
  code.
- MUST NOT use type assertions to bypass validation. Assertions are acceptable
  only when a prior runtime check established the invariant and the assertion is
  kept local.
- SHOULD prefer discriminated unions and string literal unions over loose
  strings or untyped status values.
- SHOULD use `satisfies` for object literals that must conform to a contract
  without losing literal precision.
- SHOULD use `import type` for type-only imports.
- AVOID non-null assertions. If one is unavoidable, keep it local to the
  invariant and make the invariant obvious.
- AVOID broad domain types such as `{}`, `object`, `Function`, or
  `Record<string, unknown>`. `Record<string, unknown>` is acceptable inside
  validation helpers before a value is narrowed.

## Error Handling

- MUST handle errors explicitly at trust boundaries and persistence boundaries.
- MUST NOT silently swallow errors or return empty values that hide failures.
- MUST expose user-safe messages to UI code and keep diagnostic detail on the
  server side.
- MUST narrow caught errors from `unknown` before reading properties.
- SHOULD use typed error classes or discriminated error results for recoverable
  domain failures.
- AVOID catch-all `try/catch` blocks that mix unrelated operations.
