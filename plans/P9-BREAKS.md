# P9 breaks ledger

Product literals renamed or neutralised while moving files into Jini. One row per literal.

| Where (Jini) | Former literal (Tovu) | Now | Notes |
|---|---|---|---|
| `packages/admin/src/screens/settings/external-mcp-drift-copy.ts` (`remote-declares-destructive`) | `The server marks this tool as destructive. Tovu does not enable destructive external tools.` | `...{productName} does not enable destructive external tools.` | English dictionary key; now the existing `{productName}` placeholder the locale dictionaries already use, so rendered text is unchanged for the host |
| same (`missing-or-invalid-input-schema`) | `...so Tovu cannot offer it.` | `...so {productName} cannot offer it.` | same placeholder form; rendered text unchanged |
| same (`invalid-remote-tool-name`) | `...a name Tovu will not register.` | `...a name {productName} will not register.` | same placeholder form; rendered text unchanged |
| same (`duplicate-remote-tool-name`) | `...so Tovu kept only the first.` | `...so {productName} kept only the first.` | same placeholder form; rendered text unchanged |
| `packages/admin/src/screens/voice-input/push-to-talk-mic-button.css` | `.tovu-push-to-talk` (+ `--recording`, `--unavailable`, `__dot`, `__sr-status`, `@keyframes tovu-push-to-talk-pulse`) | `.jini-push-to-talk...` | renamed in Tovu `PushToTalkMicButton.tsx`, `mic-button-view.hooks.ts`, their tests and `development/scripts/check-idle-motion.ts` |
| `packages/admin/src/screens/providers/always-allow.css` | `.always-allow-panel`, `.always-allow-server`, `.always-allow-actions` | `.jini-always-allow-*` | renamed in Tovu `AlwaysAllowPanel.tsx` and its test (not product-named; renamed for the `jini-*` class rule) |
| `packages/admin/src/screens/voice-input/voice-unavailability.ts` | `Voice input needs the Tovu desktop app ...`, `Tovu is not allowed to use speech recognition ...` | spliced from the required `appName` field of `describeVoiceUnavailability` | rendered copy unchanged for the host (Tovu passes `"Tovu"`) |
