/** Internal base preserving Error messages/causes with required and optional argument objects. */
export class IntegrationError extends Error {
  constructor({ message }: { message: string }, { options }: { options?: ErrorOptions } = {}) {
    super(message, options);
  }
}
