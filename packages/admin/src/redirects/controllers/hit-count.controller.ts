import { createControllerStore } from '../../core/module/controller-store.js';
/** Button-controlled query gate: many mounted rows never cause a burst of hit requests.
 * @example createHitCountController({}, {});
 */
export function createHitCountController(_required: Record<string, never>, _optional = {}) {
  const store = createControllerStore({ initial: { requested: false } });
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose,
    request(_input: Record<string, never> = {}, _options = {}) { store.set({ patch: { requested: true } }); } };
}
