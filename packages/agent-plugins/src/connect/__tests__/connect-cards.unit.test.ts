import { SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM, ToolInputError, type SurfaceAskThenReport, type SurfaceEmission, type SurfaceExchangeStore, type SurfaceMessage, type ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardSecretForm, SurfaceCardFormSpec } from '@jini-ai/core/contracts/cards';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import { expect, it, vi } from 'vitest';
import { buildAgentPluginAccessTokenFormWithPorts, buildAgentPluginAccessTokenOutcomeWithPorts, buildAgentPluginConnectCardWithPorts, resolveAgentPluginCardIdentity, type AgentPluginCardsPort } from '../connect-card-ui.js';
import { chooseApiConnectionDestinationWithPorts } from '../connect-destination.js';
import { waitAtAgentPluginSignInCardWithPorts } from '../connect-sign-in-wait.js';

const unused = (): never => { throw new Error('unexpected card adapter'); };
const toolId = 'studio_connect';
const cardIdentity = { uriNamespace: 'studio', appNames: { connect: 'Studio sign-in', tokenForm: 'Token entry', tokenOutcome: 'Token result' } };
const identity = resolveAgentPluginCardIdentity({ cardIdentity, toolId });
const credentialCard: PluginCredentialCard = { pluginId: 'team-sync', providerId: 'sync', label: 'Sync', category: 'general',
  baseUrl: 'https://sync.example.test', title: 'Allow Studio to sync', intro: 'Use a team account.', keyHint: 'Read only', permissions: 'View shared files.', saveKind: 'oauth' };
const context = (signal: AbortSignal): ToolExecutionContext => ({ executionId: 'call', principal: { id: 'operator' }, run: { id: 'run' }, input: {}, signal });
const formBuilders = {
  buildFormSurface: (spec: SurfaceCardFormSpec) => spec,
  defineSecretCardTool: unused, buildSignInCard: unused, buildOutcomeSurface: unused,
};

it('uses one encoded connect URI across waiting, connected and skipped states, with declared or fallback copy', () => {
  const plugin = { pluginId: 'team/sync', pluginDisplayName: 'Team Sync' };
  const cards = { ...formBuilders, buildSignInCard: (
    spec: Parameters<AgentPluginCardsPort<unknown>['buildSignInCard']>[0],
  ) => spec, buildFormSurface: unused };
  const waiting = buildAgentPluginConnectCardWithPorts({ identity: identity.connect, cards, spec: { ...plugin, state: 'waiting', signInUrl: '/oauth/start', exchangeId: 'e', credentialCard } });
  const connected = buildAgentPluginConnectCardWithPorts({ identity: identity.connect, cards, spec: { ...plugin, state: 'connected' } });
  const skipped = buildAgentPluginConnectCardWithPorts({ identity: identity.connect, cards, spec: { ...plugin, state: 'skipped' } });
  expect([waiting, connected, skipped].map(card => [card.uri, card.toolId, card.app, card.state])).toEqual(
    ['waiting', 'connected', 'skipped'].map(state => ['ui://studio/agent-plugins-connect/team%2Fsync', 'studio_connect', { appName: 'Studio sign-in', appVersion: '1' }, state]),
  );
  expect(waiting.waiting).toEqual({ title: 'Allow Studio to sync', description: 'Use a team account. View shared files.',
    message: 'Waiting for you to sign in...', openLinkLabel: 'Sign in to Team Sync', cancelLabel: 'Skip' });
  expect(connected.waiting.title).toBe("Let's connect Team Sync");
  expect(skipped.skipped.message).toBe('Skipped connecting Team Sync. The assistant can continue without this plugin.');
  expect(connected).not.toHaveProperty('signInUrl');
});

it('builds an empty masked token field and an outcome carrying only the supplied safe copy', () => {
  expect(identity.token).toEqual({ formApp: { appName: 'Token entry', appVersion: '1' }, outcomeApp: { appName: 'Token result', appVersion: '1' } });
  const apply = vi.fn(({ form }: { form: SurfaceCardSecretForm }) => form);
  const spec = { credentials: { apply }, pluginDisplayName: 'Team Sync', helpUrl: 'https://sync.example.test/setup', credentialCard };
  const form = buildAgentPluginAccessTokenFormWithPorts({ app: identity.token.formApp, spec,
    messages: { description: ({ pluginDisplayName, helpUrl }) => `Get a ${pluginDisplayName} token at ${helpUrl}.` } });
  expect(form).toEqual({
    title: 'Connect Team Sync with an access token', description: 'Get a Team Sync token at https://sync.example.test/setup.',
    submitLabel: 'Save token', cancelLabel: 'Cancel', app: { appName: 'Token entry', appVersion: '1' },
    fields: [{ kind: 'string', name: 'token', label: 'Team Sync access token', hint: 'Pasted here only. Never shown to the assistant.', required: true, secret: true }],
  });
  expect(apply.mock.calls).toEqual([[{ card: credentialCard, form }]]);
  expect(buildAgentPluginAccessTokenOutcomeWithPorts({ app: identity.token.outcomeApp, spec: {
    pluginDisplayName: 'Team Sync', state: 'failure', title: 'Token not saved', message: 'Enter a token with read access.',
  } })).toEqual({ title: 'Token not saved', details: [{ label: 'Connection', value: 'Team Sync' }], state: 'failure',
    message: 'Enter a token with read access.', app: { appName: 'Token result', appVersion: '1' } });
});

function destinationFixture() {
  const controller = new AbortController();
  const ctx = context(controller.signal);
  let deliverMessage!: (value: SurfaceMessage) => void;
  const message = new Promise<SurfaceMessage>(resolve => { deliverMessage = resolve; });
  const emissions: SurfaceEmission[] = [];
  const emitSurface = vi.fn(async (emission: SurfaceEmission) => { emissions.push(emission); });
  let live = false;
  const close = vi.fn(() => { live = false; deliverMessage({ status: 'abandoned' }); });
  const open = vi.fn<SurfaceExchangeStore['open']>(({ emit }) => {
    if (live) throw new Error('exchange already open');
    live = true;
    return { id: 'exchange-7', close, expiresAtMs: () => 1000, send: ({ emission }) => emit(emission), receive: () => message };
  });
  const surfaceExchanges: SurfaceExchangeStore = { open, deliver: unused, findTypedAnswerTarget: unused, size: () => Number(live) };
  const answer = (value: SurfaceMessage) => {
    if (!live) throw new Error('exchange not open');
    deliverMessage(value);
  };
  const askThenReport: SurfaceAskThenReport = async ({ exchange, confirmationEmission, handle }) => {
    await exchange.send({ emission: confirmationEmission });
    return (await handle(await exchange.receive({}))).result;
  };
  const required = { ...identity.destination, cards: formBuilders, ctx, pluginDisplayName: 'Team Sync', available: true,
    host: { channel: 'studio-ui', messages: { description: 'Choose a location.', sharedOptionLabel: 'All sites' } }, surfaces: { surfaceExchanges }, askThenReport };
  return { required, controller, emitSurface, open, close, answer, emissions, surfaceExchanges };
}

it('asks in the current tool exchange and returns the exact human-selected shared destination', async () => {
  const f = destinationFixture();
  const pending = chooseApiConnectionDestinationWithPorts(f.required, { emitSurface: f.emitSurface });
  f.answer({ status: 'received', params: { destination: 'shared', [SURFACE_EXCHANGE_ID_PARAM]: 'exchange-7' } });
  expect(await pending).toBe('shared');
  expect(f.open.mock.calls).toEqual([[{ binding: { toolId, channel: 'studio-ui', principalId: 'operator' }, emit: f.emitSurface }]]);
  expect(f.emissions).toEqual([{ channel: 'studio-ui', payload: { resource: {
    uri: 'ui://studio/sign-in-destination/exchange-7', title: 'Connect Team Sync', description: 'Choose a location.',
    fields: [{ kind: 'enum', name: 'destination', label: 'Save this connection', required: true, options: [{ value: 'site', label: 'Use only on this site' }, { value: 'shared', label: 'All sites' }] }],
    submitLabel: 'Continue to sign in', toolName: toolId, preferredFrameSize: ['100%', '1px'], baseParams: { [SURFACE_EXCHANGE_ID_PARAM]: 'exchange-7' },
    cancel: { label: 'Cancel', toolName: toolId, params: { [SURFACE_EXCHANGE_ID_PARAM]: 'exchange-7', [SURFACE_DISMISSED_PARAM]: true } },
  } } }]);
  expect(f.surfaceExchanges.size()).toBe(0);
});

it.each([
  { status: 'expired' },
  { status: 'received', params: { destination: 'shared', [SURFACE_DISMISSED_PARAM]: true } },
] satisfies SurfaceMessage[])('dismisses the choice without authorizing shared sign-in for %j', async message => {
  const f = destinationFixture();
  const pending = chooseApiConnectionDestinationWithPorts(f.required, { emitSurface: f.emitSurface });
  f.answer(message);
  expect(await pending).toBeNull();
  expect(f.surfaceExchanges.size()).toBe(0);
});

it.each([{ destination: 'team' }, { destination: 'shared', workspaceId: 'unrelated' }])('refuses a malformed destination answer %j and closes the exchange', async params => {
  const f = destinationFixture();
  const pending = chooseApiConnectionDestinationWithPorts(f.required, { emitSurface: f.emitSurface });
  f.answer({ status: 'received', params });
  await expect(pending).rejects.toThrow(new ToolInputError({ message: 'Choose where to save this connection in its sign-in card. No site identity or credential can be submitted.' }));
  expect(f.surfaceExchanges.size()).toBe(0);
});

it('defaults locally when sharing is unavailable and fails before opening an exchange without an emitter', async () => {
  const f = destinationFixture();
  expect(await chooseApiConnectionDestinationWithPorts({ ...f.required, available: false })).toBe('site');
  await expect(chooseApiConnectionDestinationWithPorts(f.required)).rejects.toThrow('Choosing where to save a connection requires the interactive sign-in card.');
  expect(f.open.mock.calls).toEqual([]);
});

it('aborting a pending choice releases the exchange and never returns a destination', async () => {
  const f = destinationFixture();
  const pending = chooseApiConnectionDestinationWithPorts(f.required, { emitSurface: f.emitSurface });
  f.controller.abort();
  expect(await pending).toBeNull();
  expect(f.surfaceExchanges.size()).toBe(0);
});

it('the sign-in waiter preserves host result and options and uses declaration copy only while waiting', async () => {
  const f = destinationFixture();
  const result = { status: 'connected', ref: 'new-connection' };
  const show = vi.fn(async (_input: { signInUrl: string }) => {});
  const connect = vi.fn(async ({ showSignIn }: { showSignIn: (input: { signInUrl: string }) => Promise<void> }) => {
    await showSignIn({ signInUrl: '/sign-in' });
    return result;
  });
  type Spec = Parameters<Parameters<AgentPluginCardsPort<unknown>['waitAtSignInCard']>[0]['card']>[0];
  const states: unknown[] = [];
  const options = { emitSurface: f.emitSurface };
  const cards: AgentPluginCardsPort<unknown> = {
    ...formBuilders,
    async waitAtSignInCard(required, actualOptions) {
      expect(actualOptions).toBe(options);
      expect(required.ctx).toBe(f.required.ctx);
      expect(required.toolId).toBe('studio_connect');
      expect(required.surfaceExchanges).toBe(f.surfaceExchanges);
      expect(required.missingEmitterMessage).toBe('Open this in chat.');
      const done = await required.connect({ signal: f.controller.signal, showSignIn: async ({ signInUrl }) => {
        const state: Spec = { state: 'waiting', signInUrl, exchangeId: 'exchange-7' };
        states.push(required.card(state));
        await show({ signInUrl });
      } });
      states.push(required.card({ state: 'connected' }));
      return done;
    },
  };
  expect(await waitAtAgentPluginSignInCardWithPorts({ surfaceExchanges: f.surfaceExchanges, cards, buildCard: spec => spec, toolId,
    missingEmitterMessage: 'Open this in chat.', skippedResult: () => ({ status: 'skipped', ref: '' }),
    ctx: f.required.ctx, pluginId: 'team-sync', pluginDisplayName: 'Team Sync', credentialCard, connect,
  }, options)).toBe(result);
  expect(states).toEqual([
    { pluginId: 'team-sync', pluginDisplayName: 'Team Sync', state: 'waiting', signInUrl: '/sign-in', exchangeId: 'exchange-7', credentialCard },
    { pluginId: 'team-sync', pluginDisplayName: 'Team Sync', state: 'connected' },
  ]);
  expect(show.mock.calls).toEqual([[{ signInUrl: '/sign-in' }]]);
});
