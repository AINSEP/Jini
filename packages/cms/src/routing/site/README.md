# CMS routing — site reserved paths

`@jini-ai/cms/routing/site/reserved-paths` is the one rule for "does this site path belong to the admin application rather than to the public site": `checkSitePathname`, `checkSiteRelativeTarget` and `RESERVED_SEGMENTS` (`admin`, `api`), narrowing the generic `@jini-ai/core/contracts/server/verified-origin` verdicts to this app's two surfaces.

## Wiring

- Pure and I/O-free: nothing is injected; the reserved segment set is a module constant passed to the shared verified-origin checks.
- Called by the host's public route resolver and redirects (write chokepoint and `Location` read gate), slug/content-type validation, and site-path inspection, all of which must refuse admin/API surfaces identically.
- Hosts import the subpath directly (`@jini-ai/cms/routing/site/reserved-paths`); there is no barrel.
