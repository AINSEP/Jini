// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../concurrency.js";
export * from "../../../concurrency.js";
export function withEntryLock<T>(key: string, fn: () => Promise<T>): Promise<T> { return owner.withEntryLock({ key, fn }); }
