# Specs As Built

Curated current-state documentation generated from implemented code and reverse-spec evidence lives here.

Use this folder as the rebuild and migration starting point for the project. Forward specs stay under `../specs/` by default. Raw extraction evidence stays under `reports/reverse-spec/`.

## Layout

```text
specs_as_built/
  README.md
  system-overview.md
  architecture.md
  dependency-graph.yaml
  global-ubiquitous-language.md
  components/
  changelog/
  _meta/
```

## Ownership

- `components/`: current implementation truth by component or bounded context
- `changelog/`: immutable historical impact entries for specs or reverse-spec runs
- `_meta/`: generation manifests and freshness policy

Use stable language-agnostic IDs in component contracts so traceability survives cross-language rewrites:

- `CMP-<component>` for components
- `API-<component>-<slug>` for public entrypoints
- `DATA-<component>-<slug>` for data contracts
- `ERR-<component>-<slug>` for error contracts
- `EFFECT-<component>-<slug>` for side effects
- `FUNC-<component>-<slug-or-nnn>` for functions

Generated or hybrid artifacts should include freshness metadata so validators can detect stale docs after source changes.
