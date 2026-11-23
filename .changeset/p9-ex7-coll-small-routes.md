---
"@jini-ai/cms": patch
---

Admin route specs for the collections, taxonomy, menus, widgets, forms and comments features (K1): `./admin-http/routes/{content-types,entries,taxonomy,menus,widgets,forms,comments}/*` and `./admin-http/http/{menus,widgets}` export server-neutral `defineJsonRoute` specs, each with its own small deps type; hosts mount them behind their own ports. Also `./navigation/site/{import-menu,repoint-menu-refs}` (verbatim moves).
