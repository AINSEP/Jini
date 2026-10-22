import type { SecurityApiPort } from '../ports.js';
import type { CredentialProvider } from '../models.js';
import { credentialStore } from '../rules.js';
/** Use a disposable backend: this contract creates, updates and removes credentials. */
export async function runSecurityApiConformance({ createApi, provider }: { createApi: (required: Record<string, never>, optional?: Record<string, never>) => SecurityApiPort | Promise<SecurityApiPort>; provider: CredentialProvider }, _optional = {}) {
  const api = await createApi({}), target = credentialStore({ api, kind: provider.kind }); let passed = 0;
  function check(value: boolean, message: string) { if (!value) throw new Error(`Security contract: ${message}`); passed++; }
  const suffix = `${Date.now()}-${Math.random()}`; const secret = `contract-secret-${suffix}`;
  const connection = { providerId: provider.id, [provider.tokenField]: secret, ...Object.fromEntries(provider.fields.filter(f => f.name !== provider.tokenField).map(f => [f.name, 'test-value'])) };
  const ids: string[] = [];
  try {
    const a = await target.create({ label: `First ${suffix}`, connection }, {}); ids.push(a.id); check(a.configured, 'create produces configured summary'); check(!JSON.stringify(a).includes(secret), 'create cannot return secret');
    const b = await target.create({ label: `Second ${suffix}`, connection }, {}); ids.push(b.id);
    const renamed = await target.update({ id: a.id, patch: { label: `Renamed ${suffix}` } }, {}); check(renamed.id === a.id && renamed.label === `Renamed ${suffix}`, 'metadata update preserves identity');
    const replaced = await target.update({ id: a.id, patch: { connection } }, {}); check(!JSON.stringify(replaced).includes(secret), 'replacement cannot return secret');
    await target.update({ id: b.id, patch: { isDefault: true } }, {}); const listed = await target.list({}, {}); check(listed.filter(r => r.providerId === provider.id && r.isDefault).length === 1 && listed.find(r => r.id === b.id)?.isDefault === true, 'one server-owned default');
    await target.remove({ id: b.id }, {}); const remaining = await target.list({}, {}); check(!remaining.some(r => r.id === b.id) && remaining.some(r => r.providerId === provider.id && r.isDefault), 'remove promotes remaining connection');
    await target.remove({ id: b.id }, {}); check(true, 'remove is idempotent');
    const abort = new AbortController(); abort.abort(); let refused = false; try { await target.create({ label: `Aborted ${suffix}`, connection }, { signal: abort.signal }); } catch { refused = true; } check(refused && !(await target.list({}, {})).some(r => r.label === `Aborted ${suffix}`), 'aborted mutation writes nothing');
  } finally { for (const id of ids) await target.remove({ id }, {}); }
  return { passed };
}
