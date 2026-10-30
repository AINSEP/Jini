/**
 * Closes an exhaustive `switch` over a closed union.
 *
 * `value` is typed `never`, so the compiler still flags any union member the
 * switch forgot. At runtime a value outside the declared union yields
 * `undefined` — exactly what falling off the end of the switch did before — so
 * ending a switch with `return unhandledCase(x)` changes no behaviour.
 */
export function unhandledCase(_value: never): never {
  return undefined as never;
}
