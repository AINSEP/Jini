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
  const message = `${feature} could not load ${dependency}. Install ${dependency} to enable this feature, or check its installed version and native binaries.`;
  try {
    const library = load();
    // Native import() returns a Promise. Synchronous factories must keep their return contract.
    if (library instanceof Promise) return library.catch((cause: unknown) => { throw createError({ message, cause }); }) as T;
    return library;
  } catch (cause) {
    throw createError({ message, cause });
  }
}
