# Specs

Provider-native forward specs and planning artifacts live here by default.

Use this folder for new greenfield features, brownfield changes, migrations, and provider-owned planning packages that describe intended future behavior.

## Default Layout

The active provider owns the exact files under each feature folder. With the default Speckit compatibility provider, use:

```text
specs/
  <NNN>-<feature-name>/
    feature.spec.md
    spec-manifest.md
    spec-dod.md
    traceability.spec.md
```

Other providers may add provider-specific subfolders under `specs/`, such as `openspec/` or `bmad/`.

## Boundary

- `specs/`: forward-looking requirements and planning for future changes
- `specs_as_built/`: curated current-state implementation knowledge generated from code and reverse-spec evidence
- `reports/pipeline/`: AI Dev Shop pipeline state, ADRs, tasks, test certification, and stage artifacts
