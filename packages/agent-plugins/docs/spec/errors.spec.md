Spec ID: SPEC-JINI-AGENT-PLUGINS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1267dbd038b5ef08ee24db6f0e57c98f27d3835d3dd302495c1b7c0f7c651cd8
spec_mode: reverse_spec


# Error Contract: Agent Plugins

Generic `FileLockTimeoutError` / `FileLockLostError` come from `@jini-ai/platform/fs/file-lock`; activation translates them into its domain busy error.

## Typed boundary errors

| Class / current constructor | Condition | Caller response |
|---|---|---|
| `AgentPluginFetchError({ code, message }, { cause? } = {})` | Archive URL/request/status/body failure | Use the code table below; use the safe generic cause for diagnostics |
| `AgentPluginInstallError({ code, message }, { cause? } = {})` | Digest/extraction/manifest/publication refusal | Correct the artifact or filesystem condition before retrying |
| `AgentPluginActivationsUnreadableError({ filePath, reason })` | Strict write/read preflight cannot safely read the activation document or target toggle record | Repair the document; retain operator decisions; do not substitute an empty authority projection |
| `AgentPluginActivationsBusyError({ lockPath, holder, lost })` | Activation lock timeout or ownership loss | Retry after contention clears; inspect the holder; avoid committing through a lost lock |
| `FileLockTimeoutError({ lockPath, holder, waitedMs })` | Exclusive lock not acquired within configured wait | Back off; inspect holder/liveness |
| `FileLockLostError({ lockPath })` | Ownership check sees another token or no lock | Abandon that critical-section commit and retry from a fresh read |
| `PackagePathViolation({ message }, optional: ErrorOptions = {})` | Absolute/traversal/NUL/escaping-symlink package path | Reject the package path; do not load or extract it |
| `AgentPluginNotInstalledError({ pluginId })` | Enable/disable target absent from installed inventory | Install the plugin or refresh inventory |
| `AgentPluginNotFoundError({ message }, optional: ErrorOptions = {})` | Preview/uninstall has no matching installed package | Refresh inventory; no target was removed |
| `AgentPluginNotUninstallableError({ message }, optional: ErrorOptions = {})` | Bundled uninstall without retirement override or undetermined activation | Disable a bundled plugin or repair activation; retirement is explicit host policy |
| `AgentPluginChangedSincePreviewError({ message }, optional: ErrorOptions = {})` | Current digests differ from confirmed preview | Obtain a new preview before retrying |

Fetch/install errors expose `code` and explicit class `name`. Activation/lock errors expose the listed diagnostic fields, with no code. Not-installed errors set their name but do not retain a plugin-id property. Path and three uninstall error subclasses inherit the ordinary Error name; use `instanceof`, not `.name`, to identify them. Their second-argument signatures currently differ from the empty optional-object convention.

## Fetch codes

| Code | Trigger | Recovery |
|---|---|---|
| `UNSUPPORTED_URL` | Initial absolute URL or returned final URL uses an invalid/unsupported scheme | Supply HTTP/HTTPS; reject suspicious final URLs |
| `REQUEST_FAILED` | Guard rejection, fetch rejection, invalid redirect hop, missing Location, or redirect-loop exhaustion | Inspect cause and host egress policy; retry only after resolving the cause |
| `HTTP_ERROR` | Non-2xx final HTTP response | Handle provider status; do not blindly retry permanent refusal |
| `ARCHIVE_TOO_LARGE` | Declared or streamed body exceeds configured cap | Use a smaller package |
| `EMPTY_BODY` | Successful response has zero bytes | Correct archive endpoint |

An invalid redirected scheme detected inside the redirect loop is wrapped as `REQUEST_FAILED`; an invalid final `response.url` checked after that loop throws `UNSUPPORTED_URL`. Invalid `maxBytes` throws `RangeError`. Body-stream failures are wrapped as `REQUEST_FAILED` with a safe generic cause; cap failures remain `ARCHIVE_TOO_LARGE`. Requested/redirect URL diagnostics strip credentials, query and fragment (malformed URLs use a placeholder), and HTTP status labels are standardized. Raw transport/body messages and causes are never preserved.

## Install codes

| Code | Trigger |
|---|---|
| `ARCHIVE_TOO_LARGE` | Archive exceeds 32 MiB |
| `DIGEST_MISMATCH` | Expected digest is not lowercase 64-hex or does not equal the archive digest |
| `TOO_MANY_ENTRIES` | More than 4096 entries |
| `UNSAFE_ENTRY_PATH` | Lexical path or on-disk containment check fails |
| `SYMLINK_ENTRY_REJECTED` | Link, hardlink, device, or FIFO entry; code covers more than symlinks |
| `UNSUPPORTED_ENTRY_KIND` | Reserved in the exported code union; no current throw site |
| `DUPLICATE_ENTRY` | Normalized entry path already seen |
| `FILE_TOO_LARGE` | Declared file size exceeds 16 MiB |
| `DECOMPRESSION_BOMB` | Actual streamed file bytes exceed 16 MiB |
| `TOTAL_SIZE_EXCEEDED` | Aggregate extracted bytes exceed 64 MiB |
| `MANIFEST_MISSING` | Root plugin manifest absent |
| `MANIFEST_INVALID` | Manifest JSON or lifecycle parser rejects it |
| `PUBLISH_FAILED` | Publication rename fails outside accepted existing-directory races |

Artifact errors require correcting/re-authorizing the bytes and digest. Publication errors require inspecting the target filesystem before retrying. Archive-reader, filesystem, freezing, and cleanup errors can propagate without an install code; a rejection after rename does not prove no package exists.

## Returned refusals and other failures

Manifest parsers return error arrays and warnings rather than typed exceptions; an empty extension namespace throws ordinary `Error`. Invalid factory policy, non-absolute layout roots, unsafe segments/activation ids, malformed bundled framing, and excessive bundled source file count also throw ordinary errors. `resolveAgentPluginRefs` returns `{ ok: false, reason }`; trust discovery returns refusal text; module import returns error/refusal text. Per-plugin seeding and retirement failures are outcome records, and ledger failure is a separate result field.

MCP provisioning helpers propagate host errors. If notification fails after the underlying operation succeeds, reconcile/notify through host policy rather than assuming the operation was rolled back. No HTTP-status mapping or global error observer is supplied for all operations.

Evidence: `src/lifecycle/{fetch-archive,install,activation,package-paths,set-enabled,uninstall,manifest,mcp-provisioning}.ts`.
