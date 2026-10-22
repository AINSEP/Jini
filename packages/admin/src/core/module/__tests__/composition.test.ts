import { describe, it, expect } from 'vitest';
import { createAdmin, defineAdminModule, adminPort, AdminConfigError } from '../index.js';
const a = adminPort<{ read(): string }>({ id: 'test.a' });
const module = defineAdminModule({
  id: 'test',
  requires: { a },
  pages: {
    main: { path: '/test', label: 'Test', permissions: ['read'], tabs: { all: { label: 'All' } } },
  },
});
describe('admin composition', () => {
  it('aggregates missing ports, duplicate modules/routes and unknown tabs before running factories', () => {
    const invalid = { modules: [module, module], ports: {} };
    try {
      // Runtime validation also protects JavaScript callers.
      // @ts-expect-error missing a port
      createAdmin(invalid, { omit: ['test.main.typo'] });
      throw new Error('boot unexpectedly passed');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminConfigError);
      expect((error as AdminConfigError).issues).toEqual(
        expect.arrayContaining([
          'Missing port: a',
          'Duplicate module: test',
          'Duplicate route: /test',
          'Unknown tab: test.main.typo',
        ]),
      );
    }
  });
  it('fails closed on permissions and exposes only declared ports', () => {
    const admin = createAdmin({ modules: [module], ports: { a: { read: () => 'ok' } } });
    expect(admin.describe().pages[0]?.visible).toBe(false);
    expect(admin.describe().pages[0]?.agentReachable).toBe(false);
    expect(Object.keys(admin.scope({ module }))).toEqual(['a']);
    admin.dispose();
    expect(() => admin.scope({ module })).toThrow('scope unavailable');
  });
});

it('topologically constructs providers and requires explicit host overrides', () => {
  const service = adminPort<{ read(): string }>({ id: 'test.service' });
  const downstream = adminPort<string>({ id: 'test.downstream' });
  const producer = defineAdminModule({
    id: 'producer',
    provides: { service },
    pages: {},
    factories: { service: () => ({ read: () => 'ready' }) },
  });
  const consumer = defineAdminModule({
    id: 'consumer',
    requires: { service },
    provides: { downstream },
    pages: {},
    factories: { downstream: ({ ports }) => (ports.service as { read(): string }).read() },
  });
  const admin = createAdmin({ modules: [consumer, producer], ports: {} });
  expect(admin.scope({ module: consumer }).service.read()).toBe('ready');
  expect(admin.describe().ports.map((p) => p.name)).toEqual(['service', 'downstream']);
  expect(() =>
    createAdmin({ modules: [producer], ports: { service: { read: () => 'host' } } }),
  ).toThrow('Provider collision');
  const replaced = createAdmin(
    { modules: [consumer, producer], ports: { service: { read: () => 'host' } } },
    { overrides: ['service'] },
  );
  expect(replaced.scope({ module: consumer }).service.read()).toBe('host');
});
it('reports provider cycles before factories run, and recognizes omitted tab requirements', () => {
  let ran = false;
  const x = adminPort<number>({ id: 'cycle.x' }),
    y = adminPort<number>({ id: 'cycle.y' });
  const left = defineAdminModule({
    id: 'left',
    requires: { y },
    provides: { x },
    pages: {},
    factories: {
      x: () => {
        ran = true;
        return 1;
      },
    },
  });
  const right = defineAdminModule({
    id: 'right',
    requires: { x },
    provides: { y },
    pages: {},
    factories: {
      y: () => {
        ran = true;
        return 2;
      },
    },
  });
  expect(() => createAdmin({ modules: [left, right], ports: {} })).toThrow(
    'Provider cycle: x -> y -> x',
  );
  expect(ran).toBe(false);
  const tabs = defineAdminModule({
    id: 'tabs',
    pages: {
      main: { path: '/tabs', label: 'Tabs', tabs: { extra: { label: 'Extra', requires: { x } } } },
    },
  });
  // Runtime omission removes this requirement. The prototype's static host type conservatively
  // includes all mandatory tab ports; JavaScript callers still get correct boot behavior.
  // @ts-expect-error omitted required tab port at runtime
  const admin = createAdmin({ modules: [tabs], ports: {} }, { omit: ['tabs.main.extra'] });
  expect(admin.describe().pages[0]?.tabs[0]?.reason).toBe('omitted');
});
it('reports incompatible tokens and unknown host wiring together', () => {
  const one = defineAdminModule({
    id: 'one',
    optional: { api: adminPort<number>({ id: 'api' }) },
    pages: {},
  });
  const two = defineAdminModule({
    id: 'two',
    optional: { api: adminPort<number>({ id: 'api' }, { version: 2 }) },
    pages: {},
  });
  // @ts-expect-error unknown host port
  expect(() => createAdmin({ modules: [one, two], ports: { typo: 1 } })).toThrow(
    'Incompatible token: api',
  );
});
