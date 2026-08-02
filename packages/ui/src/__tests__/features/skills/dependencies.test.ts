import { describe, expect, it } from 'vitest';

// Through the barrel — a symbol missing from `index.ts` fails here rather
// than at some host's build.
import { createFakeSkillsPort } from '../../../features/skills/dependencies.js';
import type { SkillDetail } from '../../../features/skills/types.js';

describe('createFakeSkillsPort', () => {
  describe('listSkills', () => {
    it('resolves the default seeded built-in skill by default', async () => {
      const port = createFakeSkillsPort();
      const skills = await port.listSkills();
      expect(skills).toEqual([
        {
          id: 'skill-summarize',
          name: 'summarize',
          description: 'Summarizes long documents into a short brief.',
          triggers: ['summarize', 'tl;dr'],
          mode: 'assistant',
          source: 'built-in',
        },
      ]);
    });

    it('strips the body from the summary projection', async () => {
      const port = createFakeSkillsPort();
      const [summary] = await port.listSkills();
      expect(summary).not.toHaveProperty('body');
    });

    it('resolves seeded skills instead of the default when provided', async () => {
      const seed: SkillDetail = {
        id: 'skill-x',
        name: 'x',
        description: 'd',
        mode: 'assistant',
        source: 'user',
        body: 'B',
      };
      const port = createFakeSkillsPort({ skills: [seed] });
      const skills = await port.listSkills();
      expect(skills.map((s) => s.id)).toEqual(['skill-x']);
    });
  });

  describe('fetchSkillDetail', () => {
    it('resolves the full detail, body included, for a known id', async () => {
      const port = createFakeSkillsPort();
      const detail = await port.fetchSkillDetail('skill-summarize');
      expect(detail.body).toBe('# Summarize\n\n1. Read the document.\n2. Write a short brief.');
    });

    it('rejects for an unknown id', async () => {
      const port = createFakeSkillsPort();
      await expect(port.fetchSkillDetail('nope')).rejects.toThrow('Unknown skill: nope');
    });

    it('resolves a copy, not the same reference held internally', async () => {
      const port = createFakeSkillsPort();
      const first = await port.fetchSkillDetail('skill-summarize');
      first.name = 'mutated';
      const second = await port.fetchSkillDetail('skill-summarize');
      expect(second.name).toBe('summarize');
    });
  });

  describe('fetchSkillFiles', () => {
    it('resolves seeded files for a known id', async () => {
      const port = createFakeSkillsPort({
        files: { 'skill-summarize': [{ path: 'SKILL.md', kind: 'file', size: 42 }] },
      });
      await expect(port.fetchSkillFiles('skill-summarize')).resolves.toEqual([
        { path: 'SKILL.md', kind: 'file', size: 42 },
      ]);
    });

    it('resolves an empty list for an id with no seeded files', async () => {
      const port = createFakeSkillsPort();
      await expect(port.fetchSkillFiles('skill-summarize')).resolves.toEqual([]);
    });

    it('resolves an empty list for an entirely unknown id too — this call never rejects', async () => {
      const port = createFakeSkillsPort();
      await expect(port.fetchSkillFiles('nope')).resolves.toEqual([]);
    });
  });

  describe('createSkill', () => {
    it('creates a user-owned skill and returns its detail', async () => {
      const port = createFakeSkillsPort();
      const created = await port.createSkill({ name: 'new', description: 'd', body: 'B', triggers: ['t'] });
      expect(created).toMatchObject({ name: 'new', description: 'd', body: 'B', triggers: ['t'], source: 'user', mode: 'assistant' });
      expect(created.id).toMatch(/^fake-skill-/);
    });

    it('defaults description to empty when omitted', async () => {
      const port = createFakeSkillsPort();
      const created = await port.createSkill({ name: 'new', body: 'B', triggers: [] });
      expect(created.description).toBe('');
    });

    it('is reflected by a subsequent listSkills', async () => {
      const port = createFakeSkillsPort();
      const created = await port.createSkill({ name: 'new', body: 'B', triggers: [] });
      const skills = await port.listSkills();
      expect(skills.map((s) => s.id)).toContain(created.id);
    });
  });

  describe('updateSkill', () => {
    it('updates a user-owned skill in place — the returned id matches the requested one', async () => {
      const seed: SkillDetail = {
        id: 'skill-user',
        name: 'old',
        description: '',
        mode: 'assistant',
        source: 'user',
        body: 'old body',
      };
      const port = createFakeSkillsPort({ skills: [seed] });
      const updated = await port.updateSkill('skill-user', { name: 'new', body: 'new body', triggers: [] });
      expect(updated.id).toBe('skill-user');
      expect(updated).toMatchObject({ name: 'new', body: 'new body', source: 'user' });
    });

    /**
     * The distinction this port exists to preserve: editing a BUILT-IN skill
     * must never mutate it in place. It writes a NEW user-owned shadow copy
     * under a different id, and the original built-in entry survives
     * untouched — a test that only checked the returned detail's fields
     * (and not its id, and not that the original is still fetchable) could
     * pass even if the implementation mutated the built-in in place instead.
     */
    it('updating a BUILT-IN skill returns a detail with a DIFFERENT id — a shadow copy, not an in-place edit', async () => {
      const port = createFakeSkillsPort();
      const updated = await port.updateSkill('skill-summarize', {
        name: 'summarize (edited)',
        body: 'edited body',
        triggers: ['summarize'],
      });

      expect(updated.id).not.toBe('skill-summarize');
      expect(updated.source).toBe('user');
      expect(updated.name).toBe('summarize (edited)');

      // The original built-in entry is untouched, not overwritten.
      const original = await port.fetchSkillDetail('skill-summarize');
      expect(original.name).toBe('summarize');
      expect(original.source).toBe('built-in');

      // Both the original and the new shadow copy now exist independently.
      const all = await port.listSkills();
      expect(all.map((s) => s.id).sort()).toEqual(['skill-summarize', updated.id].sort());
    });

    it('rejects for an unknown id', async () => {
      const port = createFakeSkillsPort();
      await expect(port.updateSkill('nope', { name: 'n', body: 'b', triggers: [] })).rejects.toThrow(
        'Unknown skill: nope',
      );
    });
  });

  describe('deleteSkill', () => {
    it('removes an existing skill', async () => {
      const port = createFakeSkillsPort();
      await port.deleteSkill('skill-summarize');
      await expect(port.fetchSkillDetail('skill-summarize')).rejects.toThrow();
    });

    it('rejects for an unknown id, and does not affect the existing list', async () => {
      const port = createFakeSkillsPort();
      await expect(port.deleteSkill('nope')).rejects.toThrow('Unknown skill: nope');
      await expect(port.listSkills()).resolves.toHaveLength(1);
    });
  });

  describe('latency', () => {
    it('simulates latency on read and write calls when latencyMs > 0', async () => {
      const port = createFakeSkillsPort({ latencyMs: 5 });
      const start = Date.now();
      await port.listSkills();
      expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    });
  });
});
