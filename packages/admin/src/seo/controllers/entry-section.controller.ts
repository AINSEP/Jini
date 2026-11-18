import { createControllerStore } from '@jini-ai/core/admin-runtime';
/** Selection belongs to the section; changing tabs unmounts and resets it. */
export function createSeoEntrySectionController(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const store = createControllerStore({ initial: { entryId: '' } });
  return { ...store, setEntryId({ entryId }: { entryId: string }, _optional: Record<string, never> = {}) { store.set({ patch: { entryId } }); } };
}
