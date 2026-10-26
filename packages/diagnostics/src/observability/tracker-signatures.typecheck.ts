/** Compile-only contract: every facade method accepts one required object and optional settings. */
import type { Tracker } from "./tracker-types.js";

type Assert<T extends true> = T;
type TwoObjects<F extends (...args: never[]) => unknown> = Parameters<F> extends [object, object?] ? true : false;
export type TrackerSignatureChecks = [
  Assert<TwoObjects<Tracker["capture"]>>,
  Assert<TwoObjects<Tracker["error"]>>,
  Assert<TwoObjects<Tracker["trace"]>>,
  Assert<TwoObjects<Tracker["metric"]>>,
];
