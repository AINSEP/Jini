/**
 * @file A stand-in for a host's request-error class and its `isRequestError` guard, so the shell-lib
 * classifiers are tested against the injected guard rather than any one host's error class.
 */
export class FakeRequestError extends Error {
  readonly status: number;
  readonly code?: string | undefined;
  readonly body?: Record<string, unknown> | undefined;
  constructor({ message, status }: { message: string; status: number }, { code, body }: { code?: string | undefined; body?: Record<string, unknown> | undefined } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export const isFakeRequestError = (required: { error: unknown }): required is { error: FakeRequestError } =>
  required.error instanceof FakeRequestError;
