import type { Token } from '../token.js';
import {
  adminPort,
  defineAdminModule,
  type ScopedPorts,
} from '../contracts/admin-module.js';

export const asCoreToken: Token<number, 'a'> = adminPort<number, 'a'>({ id: 'a' });

const first = adminPort<{ one: 1 }, 'first'>({ id: 'first' });
const second = adminPort<{ two: 2 }, 'second'>({ id: 'second' });
const twoPageModule = defineAdminModule({
  id: 'm',
  pages: {
    a: { path: '/a', label: 'A', tabs: { t: { label: 'T', requires: { first } } } },
    b: { path: '/b', label: 'B', tabs: { t: { label: 'T', requires: { second } } } },
  },
});

export const scoped: ScopedPorts<typeof twoPageModule> = {};
export const bothTabPorts: ScopedPorts<typeof twoPageModule> = {
  first: { one: 1 },
  second: { two: 2 },
};
