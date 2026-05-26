import type { TranslationValidationDiagnostic } from "./types";

export class TranslationOutputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputSchemaError";
  }
}

export class TranslationOutputValidationError extends Error {
  readonly diagnostics: TranslationValidationDiagnostic[] | undefined;

  constructor(
    message: string,
    options: { diagnostics?: TranslationValidationDiagnostic[] } = {},
  ) {
    super(message);
    this.name = "TranslationOutputValidationError";
    this.diagnostics = options.diagnostics;
  }
}
