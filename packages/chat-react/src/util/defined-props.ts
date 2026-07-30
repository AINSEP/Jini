/**
 * Drops keys whose value is `undefined`, preserving required keys as required.
 *
 * `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`, so `{ placeholder: undefined }` is
 * NOT assignable to `{ placeholder?: string }` — the property has to be absent, not present-and-
 * undefined. Forwarding a handful of optional props therefore costs one
 * `...(x === undefined ? {} : { x })` ternary each, and those ternaries were the single largest
 * contributor to this feature's complexity scores (14 of `ChatPane`'s 52 cyclomatic points, 10 of
 * `useChatPane`'s 15). This collapses all of them into one branch, here.
 */

/**
 * `T` with `undefined` removed from every value type, and only the keys that admitted `undefined`
 * made optional. Keys that never admitted it stay required, so a caller cannot accidentally launder
 * a required prop into an optional one by routing it through {@link definedProps}.
 */
export type DefinedProps<T> =
  & { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
  & { [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined> };

/**
 * Returns `source` without its `undefined`-valued keys.
 *
 * `null` is preserved — it is a meaningful value for props like `workingDirectory`, where `null`
 * means "explicitly none" and `undefined` means "not supplied". Collapsing the two would silently
 * change which of a controlled/uncontrolled pair wins.
 *
 * @complexity Time: O(n) in the key count; space: O(n) for the returned object.
 */
export function definedProps<T extends object>(source: T): DefinedProps<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result as DefinedProps<T>;
}
