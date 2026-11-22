---
"@jini-ai/server": minor
---

`featureOptions.terminal` accepts `terminalService`: a `TerminalService` the host built itself, used as given (the guidance error already named it). `loadSpawnPty` and the tuning options configure the service the preset builds when none is given. `buildTerminalService` takes an injectable `createService` so its tests record what the preset hands the engine without mocking a module.
