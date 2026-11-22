const bulletLine = (issue: string) => `- ${issue}`;

/** A module graph or React scope that cannot boot: lists every issue found, one per bullet. */
export class AdminConfigError extends Error {
  readonly issues: readonly string[];
  constructor({ issues }: { issues: readonly string[] }, _optional: Record<string, never> = {}) {
    super(`Invalid admin configuration:\n${issues.map(bulletLine).join('\n')}`);
    this.name = 'AdminConfigError';
    this.issues = Object.freeze([...issues]);
  }
}
