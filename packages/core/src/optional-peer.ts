/**
 * Load a host-selected feature's optional library, synchronously or asynchronously.
 * Keep the import/require literal in the caller so bundlers and closure guards can see it.
 * @throws A feature-specific load error with the original resolution/ABI error as `cause`.
 * @complexity O(1) wrapper work; loading cost belongs to the supplied loader.
 */
export function loadOptionalPeer<T>(
  { feature, dependency, load }: { feature: string; dependency: string; load: () => T },
  { createError = ({ message, cause }) => new Error(message, { cause }) }: {
    createError?: (input: { message: string; cause: unknown }) => Error;
  } = {},
): T {
  const failed = (cause: unknown): never => {
    throw createError({ message: optionalPeerLoadMessage({ feature, dependency, cause }), cause });
  };
  try {
    const library = load();
    // Native import() returns a Promise. Synchronous factories must keep their return contract.
    if (library instanceof Promise) return library.catch(failed) as T;
    return library;
  } catch (cause) {
    return failed(cause);
  }
}

/** Classify loader failures without echoing paths or other untrusted driver diagnostics.
 * Resolution of an internal dependency is not evidence the selected peer is absent.
 * Pure; O(1) branches and O(message length) matching; no errors or side effects. */
function optionalPeerLoadMessage(
  { feature, dependency, cause }: { feature: string; dependency: string; cause: unknown }, _options = {},
): string {
  const prefix = `${feature} could not load ${dependency}.`;
  const { message: detail = '', code } = cause instanceof Error ? cause as Error & { code?: string } : {};
  if (/NODE_MODULE_VERSION|compiled against a different Node\.js version/.test(detail)) {
    return `${prefix} Its native binary was built for a different Node.js/Electron ABI. Rebuild ${dependency} for the host runtime.`;
  }
  if (code === 'ERR_DLOPEN_FAILED') {
    return `${prefix} Its native binary is incompatible with this runtime or architecture. Rebuild ${dependency} for the host runtime.`;
  }
  const missing = code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
  if (missing && (detail.includes(`Cannot find module '${dependency}'`) || detail.includes(`Cannot find package '${dependency}'`))) {
    return `${prefix} It is not installed. Install ${dependency} to enable this feature.`;
  }
  return `${prefix} Check its installed dependencies and native binaries.`;
}
