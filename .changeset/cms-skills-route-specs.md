---
"@jini-ai/cms": patch
---

The admin skills files and management routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/skills/{files,install,set-enabled,uninstall,guidance}`). Each spec reads only its own small deps type; the host injects the authorizer, skill discovery, the Node package-file reader and its caps, the install-record file name, the install/enable/uninstall services, the skill tool-registration builder and its skill input-error test. Wire bodies and statuses are unchanged; the skills list route (which answers `ETag`/`304`) stays host-side.
