---
"@jini-ai/http-kit": patch
"@jini-ai/server": patch
---

`recordRouteRegistrations({ app, registrations })` adds routes mounted as a list to the route-registration inventory, and the preset's `mountRoutes` calls it, so `getRouteRegistrationInventory` still shows every route the app answers once route groups return lists.
