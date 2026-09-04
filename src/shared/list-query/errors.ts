export type ListQueryIssue = Readonly<{
  field: string;
  message: string;
}>;

export class ListQueryValidationError extends Error {
  readonly issues: readonly ListQueryIssue[];

  constructor(issues: readonly ListQueryIssue[]) {
    super("Invalid list query");

    this.name = "ListQueryValidationError";
    this.issues = issues;
  }
}
