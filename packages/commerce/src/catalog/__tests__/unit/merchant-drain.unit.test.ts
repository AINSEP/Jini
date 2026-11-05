import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectCommerceDrain } from '../../merchant-drain.js';

const original = { providerId: 'payments-example', accountId: 'merchant-original', mode: 'test' as const, publicOrigin: 'https://shop.example' };
const recorded = { provider_id: original.providerId, provider_account_id: original.accountId, mode: original.mode,
  dispatch_json: JSON.stringify({ returnUrl: `${original.publicOrigin}/commerce/return?orderId=durable-order` }) };

test('restart with changed account/mode/origin preserves durable original scope and blocks new checkout', () => {
  for (const configured of [{ ...original, accountId: 'another-account' }, { ...original, mode: 'live' as const }, { ...original, publicOrigin: 'https://another.example' }]) {
    const result = selectCommerceDrain({ configured, previous: null, recorded });
    assert.deepEqual(result.config, original); assert.match(result.problem!, /draining under their original account/);
  }
});

test('removing configuration during restart still reconstructs the original credential-free scope', () => {
  const result = selectCommerceDrain({ configured: null, previous: null, recorded });
  assert.deepEqual(result.config, original); assert.ok(result.problem);
});

test('restoring original settings enables checkout, and settled work permits a new selection', () => {
  assert.equal(selectCommerceDrain({ configured: original, previous: null, recorded }).problem, null);
  const changed = { ...original, mode: 'live' as const, accountId: 'another-account' };
  assert.deepEqual(selectCommerceDrain({ configured: changed, previous: original, recorded: null }), { config: changed, problem: null });
});

test('equivalent deployed origin spelling does not block an original account', () => {
  assert.equal(selectCommerceDrain({ configured: { ...original, publicOrigin: `${original.publicOrigin}:443/` }, previous: null, recorded }).problem, null);
});

test('removed configuration without pending work retains read access but disables new checkout', () => {
  const result = selectCommerceDrain({ configured: null, previous: original, recorded: null });
  assert.deepEqual(result.config, original); assert.match(result.problem!, /configuration is missing/);
});

test('old non-replayable rows require original configuration instead of inventing callback URLs', () => {
  const result = selectCommerceDrain({ configured: null, previous: null, recorded: { ...recorded, dispatch_json: null } });
  assert.equal(result.config, null); assert.match(result.problem!, /Restore the original payment configuration/);
});
