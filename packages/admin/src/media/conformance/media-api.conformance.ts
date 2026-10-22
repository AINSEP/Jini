import { canReplaceMedia } from '../rules.js';
import type { MediaApiPort } from '../ports.js';
/** Destructive checklist: run only against an isolated backend with no production data.
 * Returns named checks and throws at the first failed contract. No test-framework dependency. */
export async function runMediaApiConformance(
  { api }: { api: MediaApiPort },
  _optional: Record<string, never> = {},
): Promise<readonly string[]> {
  const checks: string[] = [];
  function assert(condition: boolean, name: string) {
    if (!condition) throw new Error(`Media API conformance: ${name}`);
    checks.push(name);
  }
  async function rejects(run: () => Promise<unknown>, name: string) {
    let rejected = false;
    try {
      await run();
    } catch {
      rejected = true;
    }
    assert(rejected, name);
  }
  const input = {
    filename: 'conformance.png',
    contentType: 'image/png',
    dataBase64:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=',
  };
  const created = await api.upload(input, { alt: 'initial alt' });
  assert(created.id.length > 0 && created.status === 'active', 'upload creates an active asset');
  try {
    const before = await api.list({});
    assert(
      before.some((item) => item.id === created.id),
      'list contains upload',
    );
    const updated = await api.update({ id: created.id, patch: { title: 'renamed' } });
    assert(
      updated.title === 'renamed' && updated.alt === 'initial alt',
      'partial metadata patch preserves untouched fields',
    );
    assert(created.title === 'conformance.png', 'prior snapshots do not mutate');
    const images = await api.list({ filter: 'images' });
    assert(
      images.every((item) => item.contentType?.startsWith('image/')),
      'image filter',
    );
    assert(typeof api.originalUrl({ id: created.id }) === 'string', 'original URL is synchronous');
    await rejects(() => api.delete({ id: created.id }), 'active asset cannot be purged');
    if (canReplaceMedia({ api })) {
    const replaced = await api.replace!({
      id: created.id,
      upload: { ...input, filename: 'replacement.png' },
    });
    assert(
      replaced.id === created.id &&
        replaced.alt === updated.alt &&
        replaced.title === updated.title,
      'replace retains identity and metadata',
    );
    } else {
      assert(api.replace === undefined || api.replaceSupported === false, 'replacement is optional and unavailable');
    }
    const abort = new AbortController();
    abort.abort();
    await rejects(() => api.list({}, { signal: abort.signal }), 'aborted list rejects');
    await rejects(
      () =>
        api.update({ id: created.id, patch: { title: 'must not save' } }, { signal: abort.signal }),
      'aborted write rejects',
    );
    assert(
      (await api.list({})).find((item) => item.id === created.id)?.title === 'renamed',
      'aborted write has no effects',
    );
    const trashed = await api.trash({ id: created.id });
    assert(trashed.status === 'trashed', 'trash is a distinct state');
    assert((await api.delete({ id: created.id })).purged, 'trashed asset can be purged');
    assert(!(await api.list({})).some((item) => item.id === created.id), 'purge removes asset');
    await rejects(() => api.update({ id: created.id, patch: {} }), 'missing asset rejects');
    return Object.freeze(checks);
  } finally {
    if ((await api.list({})).some((item) => item.id === created.id)) {
      await api.trash({ id: created.id });
      await api.delete({ id: created.id });
    }
  }
}
