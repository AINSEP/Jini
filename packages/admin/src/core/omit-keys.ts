/**
 * @file Copy an object without some of its keys — what `const { a: _a, ...rest } = source` does,
 * without binding a throwaway name for every dropped key.
 */

/** A shallow copy of `source`'s own enumerable properties, minus `keys`. @complexity O(own keys). */
export function omitKeys<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Omit<T, K> {
  const copy: Partial<Record<PropertyKey, unknown>> = { ...source };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}
