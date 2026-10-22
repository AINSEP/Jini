/**
 * Generic wrapper for surfacing filesystem-read failures (e.g. from a
 * drag-and-drop file/folder read) with a consistent, identifiable error
 * shape.
 */

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name || 'Error'}: ${error.message || String(error)}`;
  }
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name : 'Error';
    const message = typeof candidate.message === 'string' ? candidate.message : String(error);
    return `${name}: ${message}`;
  }
  return String(error);
}

export const FILE_SYSTEM_READ_ERROR_MESSAGE =
  'Could not read one or more dropped files or folders. Make sure they still exist and try again.';

/** Wraps an arbitrary caught error into a named `FileSystemReadError`. */
export function createFileSystemReadError(action: string, error: unknown): Error {
  const wrapped = new Error(`${action}: ${errorSummary(error)}`, { cause: error });
  wrapped.name = 'FileSystemReadError';
  return wrapped;
}

/** True iff `error` was produced by {@link createFileSystemReadError}. */
export function isFileSystemReadError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'FileSystemReadError';
}
