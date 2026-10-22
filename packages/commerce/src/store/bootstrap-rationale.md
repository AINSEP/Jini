# Historical opt-in CMS bootstrap rationale

Tovu boot no longer activates commerce. Its explicit CMS preparation adapter remains for future use.
The retired composition fragment and its behavior rationale are preserved here; this is not executable wiring.

`newsletter`/`comments`/`store-plugin` are OPTIONAL, matching their pre-existing log-and-continue
behavior. `store-plugin` is omitted entirely in memory mode — it was never invoked there before
either.

```ts
  if (!options.useMemory) {
    modules.push({
      name: "store-plugin",
      owner: "features/plugins/store",
      criticality: "optional",
      prepare: async () => {
        if (deps.contentKernel === undefined) {
          throw new Error("store-plugin: the composition root supplied no content kernel (deps.contentKernel)");
        }
        deps.store = await bootstrapStore({ kernel: deps.contentKernel, dbPath: options.defaultContentDbPath() });
      },
      start: noop,
      stop: noop,
    });
  }
```
