# Specs-As-Built Freshness

- Enforcement: advisory
- Artifact root: `ADS-project-knowledge/specs_as_built/`
- Source root: `<HOST_PROJECT_ROOT>`
- Validator: `python3 AI-Dev-Shop/harness-engineering/validators/validate_specs_as_built_freshness.py`

## Hard Blocking Change Types

- public/exported function contract changes
- route/API/job/event/CLI behavior changes
- data model or schema changes
- validation/error behavior changes
- side effects, integrations, transaction behavior
- auth/authorization/security/privacy/compliance behavior

## Advisory Change Types

- private helper refactors
- cosmetic UI/CSS-only changes
- test-only or doc-only changes
- dependency bumps without behavior changes

## Notes

Start brownfield projects in advisory mode while the initial `specs_as_built/` baseline is being extracted. Promote to `touched-scope` or `strict` once component metadata has reliable `source_scope` and `source_fingerprint` values.

During a cross-language rewrite, component artifacts may temporarily use `status: rewriting` while `source_scope` moves to replacement files. Resolve rewriting status back to `generated` or `hybrid` before the rewrite is marked complete.
