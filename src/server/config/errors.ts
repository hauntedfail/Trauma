export class TraumaConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = [message]) {
    super(message);
    this.name = "TraumaConfigError";
    this.issues = issues;
  }
}
