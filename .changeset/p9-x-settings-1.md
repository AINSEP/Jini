---
"@jini-ai/cms": patch
---

Move host-neutral settings code from the host: `./settings/site/{admin-interface,chart-provider,form-delivery,form-destination,mail-sender,site-timezone}` (setting definitions and resolvers for the admin interface, chart provider, form delivery/destination, mail sender and site timezone), with a characterization test for `resolveSiteTimeZone`.
