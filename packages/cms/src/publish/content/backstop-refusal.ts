/** An expected manual-publishing refusal with a caller-safe message.
 * Unexpected storage/transport errors must retain their original type for private diagnostics.
 */
export class BackstopRefusal extends Error {
  readonly name = "BackstopRefusal";
  constructor({ message }: { message: string }, _options = {}) { super(message); }
}

/** Host-owned immutable table, file and value rules for hand-sent ("backstop") rows and files.
 * Each returns a caller-safe refusal message, or `null` when the item may be sent. The tables,
 * patterns and copy behind them stay in the host and are injected, so this package carries none.
 */
export interface RawBackstopPolicy {
  checkRawTable(args: { table: string; columns: readonly string[] }, _optional?: object): string | null;
  checkRawFilePath(args: { relPath: string; isSymbolicLink?: boolean }, _optional?: object): string | null;
  checkRawValues(args: { values: Readonly<Record<string, unknown>>; table?: string }, _optional?: object): string | null;
}

/** Host-owned rules for the raw site-file adapter: the path deny-list, the per-file byte cap and
 * the mode normalizer whose output is part of the checked hash.
 */
export interface RawFilePolicy {
  checkRawFilePath: RawBackstopPolicy["checkRawFilePath"];
  maxBytes: number;
  normalizeMode(args: { mode: number }, _optional?: object): number;
}
