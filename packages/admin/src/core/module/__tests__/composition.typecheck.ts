import { createAdmin, defineAdminModule, adminPort } from '../index.js';
const demo = defineAdminModule({
  id: 'demo',
  requires: { api: adminPort<{ list(): void }>({ id: 'demo.api' }) },
  pages: { library: { path: '/demo', label: 'Demo', tabs: { all: { label: 'All' } } } },
});
// This file is compiled by tsc; never executed by Vitest.
// @ts-expect-error required api is missing
createAdmin({ modules: [demo], ports: {} });
// @ts-expect-error misspelled tab id
createAdmin({ modules: [demo], ports: { api: { list() {} } } }, { omit: ['demo.library.al'] });
// @ts-expect-error misspelled port
createAdmin({ modules: [demo], ports: { api: { list() {} }, apii: { list() {} } } });
createAdmin({ modules: [demo], ports: { api: { list() {} } } }, { omit: ['demo.library.all'] });

const tabOnly = defineAdminModule({
  id: 'tabonly',
  pages: {
    main: {
      path: '/tabonly',
      label: 'Tabs',
      tabs: {
        first: { label: 'First' },
        second: { label: 'Second', requires: { extra: adminPort<number>({ id: 'tab.extra' }) } },
      },
    },
  },
});
// @ts-expect-error the second tab's required port is missing
createAdmin({ modules: [tabOnly], ports: {} });
createAdmin({ modules: [tabOnly], ports: { extra: 1 } });
