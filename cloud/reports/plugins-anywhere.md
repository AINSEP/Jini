# plugins-anywhere — in progress

Branch: `cloud/plugins-anywhere`; base: `01ff07e895d1f48a012f48b33ceb4ee5527c3358` (`origin/cloud/combine`).

Implementing the owner-approved job in `origin/cloud-plans-1105:cloud/jobs/plugins-anywhere.md`.
Shared parser, bundled payload migration, host reader migration and effective guidance tests are in progress.

Compatibility: installed plugin identities remain stable; legacy extension and MCP aliases remain supported with host-visible warnings. Exact support period will be recorded before completion.

Validation: rebuilding Jini from the specified base; Tovu relink follows. Focused checks pending.

## Bugs found

- Existing host readers bypass the portable manifest namespace and cannot read neutral manifests consistently (job scope; fix in progress).

## Open

All five job items and final validation remain in progress. No deployment or publication.

## Checkpoint validation (in progress)

- Jini rebuilt successfully after a frozen-lockfile dependency refresh using a writable workspace store.
- Tovu contracts rebuilt and website tsc passed.
- Portable host-neutrality test: all 34 bundled plugins passed with another host.
- Focused MCP/reader tests passed except one pre-existing stale Higgsfield grant expectation (actual base payload already differs).
- Customization compatibility regression and final catalog/content checks remain in progress.
