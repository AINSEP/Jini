import { InMemoryPluginActivationRepo as Repo } from '../../repo.memory.js';
import type { PluginActivationRecord } from '../../activation.js';
export class InMemoryPluginActivationRepo extends Repo {
  constructor(initialRows: PluginActivationRecord[] = []) { super({ initialRows }); }
}
