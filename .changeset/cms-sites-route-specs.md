---
"@jini-ai/cms": patch
---

The admin sites routes for the sites config read, the sites home write, the token sign-in plugin list, site create and site activate ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/sites/sites-home`, `@jini-ai/cms/admin-http/routes/system/sites`), with the sites folder rules beside them. The host injects the deployment gate, its sites workspace, a directory probe and the site-admin collaborators. Wire bodies and statuses are unchanged.
