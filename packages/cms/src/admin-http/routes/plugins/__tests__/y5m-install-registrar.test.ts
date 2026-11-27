import { expect, it, vi } from 'vitest';
import { readZipUpload, registerPluginInstallRoutes, respondInstallFailure } from '../install.js';

it('constructs one parser, defers ZIP reading past authorization and keeps failure event counts', async () => {
  const parse = vi.fn<() => Promise<unknown>>(async () => undefined);
  const parserFactory = vi.fn(() => parse);
  const onFailure = vi.fn(); const json = vi.fn();
  const routes: { path: string; run(denied?: boolean): Promise<unknown>; fail(): void }[] = [];
  class InstallError extends Error { code = 'PLUGIN_ID_CONFLICT'; }
  const installer = { preview: vi.fn(async () => ({ id: 'sample' })), install: vi.fn(async () => ({ id: 'sample' })) };
  const failureFacts = () => ({ error: new InstallError('refused'), principalId: () => 'owner', json, incident: vi.fn() });
  const required: Parameters<typeof registerPluginInstallRoutes<ReturnType<typeof parserFactory>>>[0] = {
    parserFactory, maxArchiveBytes: 1024, uploadLimitText: 'Limit copy', operation: 'install', installError: InstallError,
    installer: () => installer as unknown as ReturnType<typeof required.installer>, onInstalled: vi.fn(), onFailure,
    mountJson: input => { routes.push({ path: input.spec.path, fail: () => input.failure(failureFacts()), run: async denied => {
      const parsed = input.spec.parse({ params: {}, query: {}, body: { source: { kind: 'folder', path: '/folder' }, expectedDigest: 'sha256-' + 'a'.repeat(64) } });
      if (!parsed.ok) throw new Error('parse');
      return input.spec.handle({ input: parsed.value, deps: input.deps, context: { id: 'owner' }, authorize: async () => { if (denied) throw new Error('denied'); } });
    } }); },
    mountRaw: input => { routes.push({ path: input.spec.path, fail: () => input.failure(failureFacts()), run: async denied => {
      const deps = input.requestDeps({ isZip: () => true, parseZip: reader => reader(), body: () => new Uint8Array([1]), isBuffer: (value): value is Uint8Array => value instanceof Uint8Array });
      expect(parse).not.toHaveBeenCalled();
      return input.spec.handle({ raw: { params: {}, query: { expectedDigest: 'sha256-' + 'a'.repeat(64) }, body: undefined }, deps, context: { id: 'owner' }, authorize: async () => { if (denied) throw new Error('denied'); } });
    } }); },
  };
  registerPluginInstallRoutes(required);
  expect(parserFactory.mock.calls).toEqual([[{ type: 'application/zip', limit: 1024, inflate: false }]]);
  expect(parse).not.toHaveBeenCalled();
  await expect(routes[2]!.run(true)).rejects.toThrow('denied');
  await routes[0]!.run(); await routes[1]!.run();
  expect(parse).not.toHaveBeenCalled();
  parse.mockResolvedValueOnce({ type: 'entity.too.large' });
  const response = await routes[2]!.run() as Response;
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ code: 'PLUGIN_PACKAGE_TOO_LARGE', error: 'Limit copy' });
  for (const route of routes) route.fail();
  expect(onFailure.mock.calls).toEqual([[{ actorId: 'owner', reasonClass: 'refused' }], [{ actorId: 'owner', reasonClass: 'refused' }]]);
  expect(json).toHaveBeenCalledTimes(4);
});

it('preserves media-type and malformed ZIP refusal copy', async () => {
  const parseZip = vi.fn(async () => new Error('private parser detail'));
  const deps = { isZip: () => false, parseZip, body: () => undefined, isBuffer: (value: unknown): value is Uint8Array => value instanceof Uint8Array, uploadLimitText: 'Limit copy' };
  expect(await readZipUpload({ deps })).toEqual({ ok: false, refusal: { status: 400, code: 'PLUGIN_INSTALL_INPUT_INVALID', error: 'An application/zip upload is required.' } });
  expect(parseZip).not.toHaveBeenCalled();
  expect(await readZipUpload({ deps: { ...deps, isZip: () => true } })).toEqual({ ok: false, refusal: { status: 400, code: 'PLUGIN_ARCHIVE_INVALID', error: 'ZIP upload could not be read.' } });
});

it.each([
  { label: "a missing body", body: undefined },
  { label: "a JSON-shaped body", body: { archive: [1, 2] } },
])("refuses an otherwise successful ZIP parse that leaves $label", async ({ body }) => {
  const parseZip = vi.fn(async () => undefined);
  expect(await readZipUpload({ deps: {
    isZip: () => true, parseZip, body: () => body, isBuffer: Buffer.isBuffer, uploadLimitText: "ZIP exceeds the limit",
  } })).toStrictEqual({ ok: false, refusal: { status: 400, code: "PLUGIN_ARCHIVE_INVALID", error: "ZIP upload could not be read." } });
  expect(parseZip.mock.calls).toEqual([[]]);
});

it("hands the exact parsed ZIP bytes to the installer boundary", async () => {
  const archive = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...Array<number>(18).fill(0)]);
  expect(await readZipUpload({ deps: {
    isZip: () => true, parseZip: async () => undefined, body: () => archive, isBuffer: Buffer.isBuffer, uploadLimitText: "ZIP exceeds the limit",
  } })).toStrictEqual({ ok: true, archive });
});

it("leaves an unexpected installer failure to the host without serializing its private message", () => {
  class InstallError extends Error { code = "PLUGIN_ID_CONFLICT"; }
  const error = new Error("private storage failure");
  const json = vi.fn();
  const failure = vi.fn();
  respondInstallFailure({ error, deps: { installError: InstallError, json, failure } });
  expect(json).not.toHaveBeenCalled();
  expect(failure.mock.calls).toEqual([[error]]);
});
