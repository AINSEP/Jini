/** An expected manual-publishing refusal with a caller-safe message.
 * Unexpected storage/transport errors must retain their original type for private diagnostics.
 */
export class BackstopRefusal extends Error {
  readonly name = "BackstopRefusal";
  constructor({ message }: { message: string }, _options = {}) { super(message); }
}
