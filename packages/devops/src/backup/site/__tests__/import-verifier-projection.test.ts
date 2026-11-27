import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitProjectedDocuments, applyShareProjection, type DocumentAdmission, type ProjectionDeps } from '../import-verifier-projection.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function makeDeps(over: Partial<ProjectionDeps> = {}): ProjectionDeps & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    validateSharePath: ({ path }) => { paths.push(path); },
    refuseArchive: ({ message }) => { throw new Error(`refused: ${message}`); },
    sha256Hex: ({ bytes }) => createHash('sha256').update(bytes).digest('hex'),
    createDocumentAdmission: () => async () => undefined,
    ...over,
  };
}
const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, Buffer.from(v)]));

describe('applyShareProjection', () => {
  it('places archive media at its uploads key, once per key, and validates each destination path', async () => {
    const deps = makeDeps();
    const map = files({ 'media/one.bin': 'AAA' });
    await applyShareProjection({ files: map, projection: { media: [{ storageKey: 'k1', sha256: sha('AAA') }, { storageKey: 'k2', sha256: sha('AAA') }] }, manifest: { media: [{ path: 'media/one.bin', sha256: sha('AAA') }] }, deps });
    expect([...map.keys()].sort()).toEqual(['uploads/k1', 'uploads/k2']);
    expect(deps.paths).toContain('uploads/k1');
    expect(deps.paths).toContain('uploads/k2');
  });

  it('refuses archive media the database does not reference, unreferenced uploads, and corrupt blobs', async () => {
    const base = { deps: makeDeps() };
    await expect(applyShareProjection({ ...base, files: files({ 'media/x': 'A' }), projection: { media: [] }, manifest: { media: [{ path: 'media/x', sha256: sha('A') }] } })).rejects.toThrow('not referenced by the projected database');
    await expect(applyShareProjection({ ...base, files: files({ 'uploads/stray': 'A' }), projection: { media: [] }, manifest: { media: [] } })).rejects.toThrow('Unreferenced uploads');
    await expect(applyShareProjection({ ...base, files: files({ 'uploads/k': 'A' }), projection: { media: [{ storageKey: 'k', sha256: sha('B') }] }, manifest: { media: [] } })).rejects.toThrow('Referenced media is missing or failed its hash.');
    await expect(applyShareProjection({ ...base, files: files({}), projection: { media: [{ storageKey: 'd', sha256: sha('B') }], documents: [{ storageKey: 'd', sha256: sha('B'), originalFilename: 'a.doc' }] }, manifest: { media: [] } })).rejects.toThrow('Referenced document blob is missing or corrupt.');
  });

  it('moves verified bytes to the remapped destination and refuses conflicts or missing sources', async () => {
    const deps = makeDeps();
    const map = files({ 'uploads/old': 'A' });
    await applyShareProjection({ files: map, projection: { media: [{ storageKey: 'old', sha256: sha('A'), destinationStorageKey: 'new' }] }, manifest: { media: [] }, deps });
    expect([...map.keys()]).toEqual(['uploads/new']);
    expect(deps.paths).toContain('uploads/new');
    // A conflicting claim on the destination: two sources move to one key with different bytes.
    const clash = files({ 'uploads/a': 'A', 'uploads/b': 'B' });
    await expect(applyShareProjection({ deps, files: clash, manifest: { media: [] }, projection: { media: [{ storageKey: 'a', sha256: sha('A'), destinationStorageKey: 'z' }, { storageKey: 'b', sha256: sha('B'), destinationStorageKey: 'z' }] } })).rejects.toThrow('Conflicting imported document blob keys.');
  });
});

describe('admitProjectedDocuments', () => {
  const doc = { storageKey: 'd', sha256: sha('DOC'), originalFilename: 'a.docx' };
  it('uses the host default admission unless one is passed, and wraps a rejection in a refusal', async () => {
    const seen: string[] = [];
    const defaultAdmission: DocumentAdmission = async ({ filename }) => { seen.push('default:' + filename); };
    const deps = makeDeps({ createDocumentAdmission: () => defaultAdmission });
    await admitProjectedDocuments({ files: files({ 'uploads/d': 'DOC' }), documents: [doc], deps });
    expect(seen).toEqual(['default:a.docx']);
    await admitProjectedDocuments({ files: files({ 'uploads/d': 'DOC' }), documents: [doc], deps }, { admitDocument: async ({ filename }) => { seen.push('custom:' + filename); } });
    expect(seen).toEqual(['default:a.docx', 'custom:a.docx']);
    await expect(admitProjectedDocuments({ files: files({ 'uploads/d': 'DOC' }), documents: [doc], deps }, { admitDocument: async () => { throw new Error('too big'); } })).rejects.toThrow('refused: Invalid Library document: too big');
    await expect(admitProjectedDocuments({ files: files({ 'uploads/d': 'DOC' }), documents: [doc], deps }, { admitDocument: async () => { throw 'opaque'; } })).rejects.toThrow('Invalid Library document: document ingress rejected');
  });

  it('refuses a document whose blob is missing or fails its hash, and honours the abort signal', async () => {
    const deps = makeDeps();
    await expect(admitProjectedDocuments({ files: files({}), documents: [doc], deps })).rejects.toThrow('Referenced document blob is missing or corrupt.');
    await expect(admitProjectedDocuments({ files: files({ 'uploads/d': 'other' }), documents: [doc], deps })).rejects.toThrow('missing or corrupt');
    const controller = new AbortController(); controller.abort(new Error('stop'));
    await expect(admitProjectedDocuments({ files: files({ 'uploads/d': 'DOC' }), documents: [doc], deps }, { signal: controller.signal })).rejects.toThrow('stop');
  });
});

it('keeps a rendition whose media reference has no checksum and preserves its bytes', async () => {
  const map = files({ 'uploads/rendition': 'derivative byte fixture' });
  const deps = makeDeps({ sha256Hex: () => { throw new Error('No checksum was declared'); } });
  await applyShareProjection({
    deps, files: map, projection: { media: [{ storageKey: 'rendition' }] }, manifest: { media: [] },
  });
  expect(map).toEqual(new Map([['uploads/rendition', Buffer.from('derivative byte fixture')]]));
});
