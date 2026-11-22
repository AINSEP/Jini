/** Collect unknown and missing manifest keys in their existing validation order. */
export function collectManifestKeyErrors<ErrorType>(
  { raw, allowedKeys, requiredKeys, malformed }: { raw: Readonly<Record<string, unknown>>; allowedKeys: ReadonlySet<string>; requiredKeys: readonly string[]; malformed: (message: string) => ErrorType },
  _optional: Record<string, never> = {},
): ErrorType[] {
  const errors: ErrorType[] = [];
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      errors.push(malformed(`unknown manifest key '${key}'`));
    }
  }
  for (const key of requiredKeys) {
    if (raw[key] === undefined) {
      errors.push(malformed(`missing required manifest field '${key}'`));
    }
  }
  return errors;
}
