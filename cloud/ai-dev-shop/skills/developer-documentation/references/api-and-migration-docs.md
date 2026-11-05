# API and Migration Docs

## API Reference Minimums

For each public endpoint or API surface include:
- purpose
- auth requirement
- request shape
- response shape
- error behavior
- rate limits or operational caveats
- one working example

If OpenAPI exists, derive documentation from the contract instead of rewriting it freehand.

## Changelog Rules

Prefer a stable format such as:
- Added
- Changed
- Deprecated
- Removed
- Fixed
- Security

Entries should describe user-visible change, not internal implementation trivia.

## Migration Guide Minimums

Write a migration guide when:
- a public API changes
- configuration keys change
- environment variables change
- behavior changes in a way that can break automation or integrations

Include:
- who is affected
- what changed
- before/after examples
- step-by-step migration path
- compatibility window and deadlines if applicable

## Release Notes

Release notes are not the changelog verbatim. Summarize:
- value delivered
- notable behavior changes
- action required from users, if any
