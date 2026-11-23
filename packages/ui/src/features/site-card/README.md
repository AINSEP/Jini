# site-card

A site list's card frame (`SiteCard`), its toolbar (`SiteListToolbar`), the pure view rules
(`siteListView`, `parseSiteListPrefs`) and the two list hooks (`useSiteListView`,
`useSiteListPrefs`). Public entry: `@jini-ai/ui/site-card`. Architecture:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- **Needs injected:** `useSiteListPrefs({ port: SiteListPrefsPort }, { describeError?, seed? })`.
  `port.load()` reads the stored choices (async); `port.save({ next })` writes one change and may
  return nothing when the store is synchronous. `seed` is an optional synchronous read for a store
  that answers at once (browser storage): the first render then shows the stored choices and
  `port.load` is never called. `describeError` is host wording for `loadError`/`saveError`.
- **Provides:** `SiteListPrefsController` (`prefs`, `ready`, `onPrefsChange`, `loadError`,
  `saveError`). Saves are ordered; after a failed read nothing is saved, but changes still apply for
  the session.
- **Must never import:** host storage keys, host bridges/IPC, host hooks, product copy, `console`.

```ts
import { useSiteListPrefs, type SiteListPrefsPort } from '@jini-ai/ui/site-card';

const KEY = 'my-host.site-list';
const port: SiteListPrefsPort = {
  load: async () => JSON.parse(localStorage.getItem(KEY) ?? 'null'),
  save: ({ next }) => { localStorage.setItem(KEY, JSON.stringify(next)); },
};
const seed = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');
export const useHostSiteListPrefs = () => useSiteListPrefs({ port }, { seed });
```
