Spec ID: SPEC-JINI-SERVER-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:080fbba383ef36560ce951889bfab935b88b461d90ba33a10ee27ac80d4e1768
spec_mode: reverse_spec


# State contract: @jini-ai/server

## Composition lifecycle

```text
validate origins and activation
  -> acquire base and rehydrate
  -> build caller services, feature compositions and feature services
  -> register tools -> afterTools -> mount routes
  -> returned embedded kernel
  -> dispose features -> dispose caller packs -> close base
```

Activation output is a snapshot of active/inactive features, reasons, granted and denied capabilities. It is not a live feature-toggle service. Mounted routes cannot be dynamically unmounted by changing the configuration object. Features borrow kernel resources; only the base closes its SQLite handles.

Each dispose method caches its promise; base close also caches one promise. Embedded hosts own their listener and must drain it before disposing dependencies. The returned kernel itself does not install signal handlers or open a TCP listener.

## Standalone daemon

```text
compose -> listen -> publish actual URL/discovery -> accepting requests
       -> stop: shuttingDown -> HTTP close -> feature/caller disposal
       -> current discovery removal -> host hook -> base close
```

stop is idempotent and concurrent calls share its promise. Host hook failure does not skip base cleanup. A failed listener bind disposes the kernel. Discovery is a local process record, not durable coordination authority or a lock; another process's replacement record is not removed by this daemon's stop.

Durable files are events.db and journal.db, plus their SQLite side files. Event logs own two handles; feature storage borrows a separate owned connection to events.db. Memory storage loses all history at process exit. Run state reconstruction and retention behavior are owned by daemon; rehydration converts orphaned nonterminal runs into resumable failures before accepting requests.

The supplied environment object is mutable: standalone boot writes JINI_BIND_HOST into it. Hosts needing isolation supply a dedicated map. An optional graceful-shutdown installation adds process-global listeners; uninstall removes them but does not reset an already-running shutdown.

## Legacy local singleton and projects

openDatabase keeps a module-local `(dbInstance, dbFile)` singleton. Same-file open returns the cached connection; changing the path closes the previous one before acquisition. Host driver injection is still required on every open call. closeDatabase clears both references before calling close, permitting later clean acquisition even if close throws.

Legacy migrate creates projects, conversations, messages and rich agent-session tables in app.sqlite. It has no versioned migration ledger and no automatic conversion to modern owner-scoped ai_* tables. Project CRUD/status helpers borrow the handle and hold no independent cache; persistence, cascade enforcement and backup are host database responsibilities.

The staged boot/readiness source is currently outside the public export map, so no `/lifecycle` consumer lifecycle is promised here. Evidence: kernel/composition/preset, storage legacy ownership and project adapter source/tests read without execution.
