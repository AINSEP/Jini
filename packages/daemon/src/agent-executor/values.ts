
export function isRecord(required: { value: unknown }, _optional: Record<string, never> = {}): required is { value: Record<string, unknown> } {
  const { value } = required;
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString({ value }: { value: unknown }, { fallback = '' }: { fallback?: string | undefined } = {}): string {
  return typeof value === 'string' ? value : fallback;
}

export function asOptionalString({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function errorMessage({ err }: { err: unknown }, _optional: Record<string, never> = {}): string {
  return err instanceof Error ? err.message : String(err);
}
