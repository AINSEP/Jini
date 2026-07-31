import type { SkillDetail, SkillFileEntry, SkillSummary } from './types.js';
import type { SkillsPort, SkillWritePayload } from './ports.js';

export interface FakeSkillsPortOptions {
  /** Seed skills, body included. Defaults to one built-in demo skill. */
  skills?: readonly SkillDetail[];
  /** Seed file trees, keyed by skill id. Defaults to none. */
  files?: Readonly<Record<string, readonly SkillFileEntry[]>>;
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

const DEFAULT_FAKE_SKILLS: readonly SkillDetail[] = [
  {
    id: 'skill-summarize',
    name: 'summarize',
    description: 'Summarizes long documents into a short brief.',
    triggers: ['summarize', 'tl;dr'],
    mode: 'assistant',
    source: 'built-in',
    body: '# Summarize\n\n1. Read the document.\n2. Write a short brief.',
  },
];

let nextFakeId = 1;

function toSummary(detail: SkillDetail): SkillSummary {
  const { body: _body, ...summary } = detail;
  return summary;
}

/**
 * An in-memory test/demo double. Per this package's established convention
 * (see `execution/dependencies.ts`, `integrations/dependencies.ts`), ships a
 * fake rather than a real transport — a real host supplies its own
 * `SkillsPort` pointed at its own skill registry.
 */
export function createFakeSkillsPort(options: FakeSkillsPortOptions = {}): SkillsPort {
  const skills = new Map<string, SkillDetail>((options.skills ?? DEFAULT_FAKE_SKILLS).map((skill) => [skill.id, { ...skill }]));
  const files = new Map<string, readonly SkillFileEntry[]>(Object.entries(options.files ?? {}));
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);

  return {
    listSkills() {
      return delay([...skills.values()].map(toSummary));
    },
    fetchSkillDetail(id: string) {
      const detail = skills.get(id);
      if (!detail) return Promise.reject(new Error(`Unknown skill: ${id}`));
      return delay({ ...detail });
    },
    fetchSkillFiles(id: string) {
      return delay([...(files.get(id) ?? [])]);
    },
    createSkill(payload: SkillWritePayload) {
      const id = `fake-skill-${nextFakeId++}`;
      const detail: SkillDetail = {
        id,
        name: payload.name,
        description: payload.description ?? '',
        triggers: payload.triggers,
        mode: 'assistant',
        source: 'user',
        body: payload.body,
      };
      skills.set(id, detail);
      return delay({ ...detail });
    },
    updateSkill(id: string, payload: SkillWritePayload) {
      const existing = skills.get(id);
      if (!existing) return Promise.reject(new Error(`Unknown skill: ${id}`));
      // A built-in edit writes a NEW user-owned shadow copy, same as the
      // origin — the requested id is never mutated in place.
      const targetId = existing.source === 'user' ? id : `fake-skill-${nextFakeId++}`;
      const detail: SkillDetail = {
        ...existing,
        id: targetId,
        name: payload.name,
        description: payload.description ?? '',
        triggers: payload.triggers,
        source: 'user',
        body: payload.body,
      };
      skills.set(targetId, detail);
      return delay({ ...detail });
    },
    deleteSkill(id: string) {
      if (!skills.has(id)) return Promise.reject(new Error(`Unknown skill: ${id}`));
      skills.delete(id);
      return delay(undefined);
    },
  };
}
