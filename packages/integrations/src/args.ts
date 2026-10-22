/** Required and optional fields of an API argument record. */
export type RequiredArgs<T> = Pick<T, {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]>;
export type OptionalArgs<T> = Pick<T, Exclude<keyof T, keyof RequiredArgs<T>>>;

/** Package-local composition helper; public APIs expose the two records directly. */
export function partitionArgs<T extends object, K extends keyof T>(value: T, requiredKeys: readonly K[]): [Pick<T, K>, Omit<T, K>] {
  const required: Partial<T> = {};
  const optional: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    ((requiredKeys as readonly (keyof T)[]).includes(key) ? required : optional)[key] = value[key];
  }
  return [required as Pick<T, K>, optional as Omit<T, K>];
}
