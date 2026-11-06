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
