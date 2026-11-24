# bridged-chat

`ChatPane` surfaces for a host with no HTTP server: the run transport, runtime access, working
directory access, file-path lookup and attachment uploader all come from one injected bridge
object (typically an Electron preload bridge). Subpath: `@jini-ai/chat/react/bridged-chat`.

- `useBridgedChatTransport({ getBridge, createTransport })` — returns `BridgedChatTransport<T>`
  (`transport`, `runtimeAccess`, `workingDirectoryAccess`, `getPathForFile`, `uploadAttachments`),
  every field `undefined` without a bridge. The transport is built and disposed in one effect, so a
  StrictMode replay never leaks the listener its construction installs, and a reconnect never
  exposes a disposed instance.
- `createStagedAttachmentUploader({ bridge })` — reads each `File`'s bytes and stages them through
  `bridge.saveChatAttachment`, preserving request order; an abort drops the batch.

## Wiring

The host injects:

- `getBridge` — its bridge lookup (structurally a `ChatBridgePort`), referentially stable.
- `createTransport` — its run-transport factory over that bridge (anything with `dispose()`),
  referentially stable.

The host's desktop renderer composes this in its workspace-chat transport hook, binding its preload
bridge lookup and its IPC run transport, and hands the result to its chat pane.
