/** A shallow copy of `value` without `keys` — the rest-destructuring "omit" idiom, minus the unused bindings. */
export function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy: T = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy;
}
