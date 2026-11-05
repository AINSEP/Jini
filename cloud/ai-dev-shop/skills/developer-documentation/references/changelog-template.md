<!-- Source: Addy Osmani / agent-skills / documentation-and-adrs -->

# Changelog Template

Use this structure for `CHANGELOG.md`.

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- 

### Changed

- 

### Fixed

- 

### Removed

- 

## [1.2.0] - 2026-06-18

### Added

- Added saved search filters. ([#124](https://github.com/org/repo/pull/124))

### Changed

- Changed export behavior to stream large files instead of buffering them in memory. ([#128](https://github.com/org/repo/pull/128))

### Fixed

- Fixed session refresh failure after password reset. ([#131](https://github.com/org/repo/issues/131))

### Removed

- Removed deprecated `legacyExport` option. ([#135](https://github.com/org/repo/pull/135))
```

## Version Header Format

Use:

```markdown
## [version] - YYYY-MM-DD
```

Keep an `Unreleased` section at the top so changes accumulate during development and are easy to finalize at release time.

## Document Decisions, Not Just Features

Changes that affect behavior belong in the changelog even if they feel small. Document defaults, migration requirements, compatibility changes, removals, renamed options, and operational behavior changes.

## Known Gotchas Pattern

Use `@important` comments for traps future engineers are likely to hit.

```ts
// @important: This endpoint must keep returning 200 for empty exports.
// Some customers use the response status, not the body, to detect success.
```

Good gotcha comments explain the trap, why it exists, and what breaks if it is changed.
