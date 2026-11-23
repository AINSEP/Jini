---
"@jini-ai/admin": patch
---

Add `@jini-ai/admin/screens/fs-files/hooks/use-native-folder-picker.hooks` (`useNativeFolderPicker`, moved from the Tovu admin app): the chat composer's folder-button controller (shown only after the host confirms a server-side folder dialog is available, one pick at a time, Cancel is a no-op, a failure hides the button). The host now injects, as fields on the existing `input` object, `probe` (the availability request), `pick` (the request that opens the OS folder dialog) and `isDialogAlreadyOpen({ error })` (whether a pick rejection means a dialog is already open elsewhere), in place of the previous built-in defaults bound to the host's HTTP client.
