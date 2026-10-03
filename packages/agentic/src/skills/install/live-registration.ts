export interface SkillRegistration<Descriptor extends { id: string } = { id: string }, Context = unknown> {
  readonly descriptor: Descriptor;
  readonly policy: { authorize(required: { context: Context }): unknown };
  readonly handler: (required: { context: Context }) => unknown;
}
export interface SkillRegistryPort<Descriptor extends { id: string } = { id: string }, Context = unknown> {
  list(required: Record<string, never>): Descriptor[];
  has(required: { id: string }): boolean;
  register(required: { tool: SkillRegistration<Descriptor, Context> }): void;
}
export interface SkillsRefreshRegistry { refreshInstalledSkills?(required: Record<string, never>): Promise<boolean> }

/** Keep append-only registry slots while dispatching current registrations or failing closed. */
export function createLiveSkillRegistration<Descriptor extends { id: string }, Context>(required: {
  registry: SkillRegistryPort<Descriptor, Context>;
  inactiveError: (required: { id: string }) => Error;
}, _optional: Record<string, never> = {}) {
  const { registry } = required;
  const active = new Map<string, SkillRegistration<Descriptor, Context>>();
  const slots = new Map<string, SkillRegistration<Descriptor, Context>>();
  const list = registry.list.bind(registry), has = registry.has.bind(registry);
  registry.list = input => list(input).filter(d => !slots.has(d.id) || active.has(d.id));
  registry.has = input => slots.has(input.id) ? active.has(input.id) : has(input);
  let fingerprint = '';
  return ({ tools }: { tools: readonly SkillRegistration<Descriptor, Context>[] }): boolean => {
    const nextFingerprint = JSON.stringify(tools.map(t => t.descriptor));
    const next = new Map(tools.map(t => [t.descriptor.id, t]));
    if (next.size !== tools.length) throw new Error('Duplicate skill registration ID.');
    for (const tool of tools) {
      const id = tool.descriptor.id, existing = slots.get(id);
      if (existing) Object.assign(existing.descriptor, tool.descriptor);
      else {
        const slot: SkillRegistration<Descriptor, Context> = {
          descriptor: { ...tool.descriptor },
          policy: { authorize: input => active.get(id)?.policy.authorize(input) ?? 'deny' },
          handler: input => {
            const current = active.get(id);
            if (!current) throw required.inactiveError({ id });
            return current.handler(input);
          },
        };
        registry.register({ tool: slot }); slots.set(id, slot);
      }
    }
    active.clear(); for (const [id, tool] of next) active.set(id, tool);
    const changed = fingerprint !== nextFingerprint; fingerprint = nextFingerprint;
    return changed;
  };
}

/** Prevent older loads overwriting newer registrations; reset after both success and failure. */
export function createSkillRefresher<T>(required: {
  load: (required: Record<string, never>) => Promise<readonly T[]>;
  replace: (required: { tools: readonly T[] }) => boolean;
}, _optional: Record<string, never> = {}): { refreshInstalledSkills(required: Record<string, never>): Promise<boolean> } {
  let pending: Promise<boolean> | undefined;
  return { refreshInstalledSkills: (_required: Record<string, never>) => {
    if (!pending) pending = required.load({}).then(tools => required.replace({ tools })).finally(() => { pending = undefined; });
    return pending;
  } };
}

export function createSkillRefreshMiddleware(required: { registry: SkillsRefreshRegistry }, optional: { onChanged?: (required: Record<string, never>) => void } = {}) {
  return async ({ next }: { next: (required: Record<string, never>, optional?: { error?: unknown }) => void }): Promise<void> => {
    try {
      if (await required.registry.refreshInstalledSkills?.({})) optional.onChanged?.({});
    } catch (error) { next({}, { error }); return; }
    next({});
  };
}
