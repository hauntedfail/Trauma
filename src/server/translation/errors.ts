import type { TranslationValidationDiagnostic } from "./types";

export class TranslationOutputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputSchemaError";
  }
}

export class TranslationOutputValidationError extends Error {
  readonly diagnostics: TranslationValidationDiagnostic[] | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      diagnostics?: TranslationValidationDiagnostic[];
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "TranslationOutputValidationError";
    this.diagnostics = options.diagnostics;
    this.retryable = options.retryable ?? true;
  }
}
