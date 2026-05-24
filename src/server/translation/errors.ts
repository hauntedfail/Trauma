export class TranslationOutputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputSchemaError";
  }
}

export class TranslationOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputValidationError";
  }
}
