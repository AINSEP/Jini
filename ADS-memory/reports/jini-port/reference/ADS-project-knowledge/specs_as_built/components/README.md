# Components

Current implementation truth is organized by component or bounded context.

Each component may contain:

```text
<component>/
  README.md
  contracts/
    api.yaml
    data.yaml
    errors.yaml
    side-effects.yaml
    functions.yaml
  migration-guide.md
  traceability.md
  _meta.yaml
```

Contract YAML files use stable IDs as primary keys. Source-language names belong in `source_name` fields so migration notes and traceability survive rewrites.

Do not store historical spec deltas here. Use `../changelog/` for spec impact records.
