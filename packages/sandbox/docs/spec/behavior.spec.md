Spec ID: SPEC-JINI-SANDBOX-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:ba796bfdfc7cdb1fd41e80b2b11c948caf46afc9e5270ba3dffe0629bfaa691b
spec_mode: reverse_spec


# Behavior Rules: sandbox

## Provider and file behavior

WHEN importing `./core`, the package shall load the error class and no adapter. WHEN booting the E2B provider, it shall pass only explicitly supplied SDK credentials/lifetime/template and prepare a project directory plus recursive watcher before returning. Defaults: project root `/home/user/app`, preview port 5173, preview-check deadline 3000 ms. SDK lifetime/credential defaults belong to the SDK; these options are not locally validated.

WHEN mounting files, the adapter shall upsert the supplied files in one batch, skip an empty batch, preserve UTF-8 strings and convert byte views using their exact offset/length. It shall not delete omitted files. Reads shall request raw bytes.

WHEN listing files, the adapter shall request depth 20, return only entries with type `file`, strip the project-root prefix when present, and exclude any path segment `node_modules`, `.git`, `dist`, `build`, or `.next`. Directory/symlink entries are omitted. Ordering follows the backend; no sorting occurs. The core contract permits these documented adapter limits; the result is a bounded project-file listing.

The E2B adapter joins paths with the configured root but does not reject traversal, absolute/unexpected backend paths or symlink escape. Consumers must supply trusted project-relative paths; this is not an enforced filesystem security boundary.

## Commands, events and preview

WHEN running or starting a command, the adapter shall quote arguments with POSIX single-quote escaping and execute in the project root. The `command` string itself remains shell code and must be trusted. Dependency installation shall use `npm install`, appending quoted packages only when the list is nonempty. A foreground command returns `{stdout,stderr,exitCode}`; nonzero results returned by the backend are not independently rejected by the wrapper.

WHEN starting a background process, the adapter shall return before readiness, track the process and deliver future output to subscribed listeners. Output produced before registration is not buffered. Subscription removal is idempotent. No operation-level command timeout or abort option is supplied by core.

WHEN filesystem events arrive, the adapter shall map create/write/rename/remove to created/modified/modified/deleted and drop chmod. It forwards watcher-relative names as received. Create/write events for paths currently being mounted are suppressed; delayed host echoes are suppressed by comparing current bytes with the last mounted content fingerprint. Subsequent differing sandbox content, removals and renames are reported. E2B exposes no writer identity: identical-content rewrites cannot be distinguished from mount echoes and are also suppressed. Failed mount suppression is cleared. Listener exceptions are not isolated from other listeners.

WHEN checking preview, the adapter shall make one HEAD request to `https://<handle.getHost({port})>`, accepting any HTTP status including 404. IF fetch rejects or aborts, THEN preview shall reject with category `timeout`. Polling, readiness meaning beyond connectivity and retries belong to the host.

WHEN tearing down, the adapter shall attempt every tracked process kill using all-settled aggregation, then stop the watcher, then kill the sandbox. A sandbox-kill error takes precedence over a watcher-stop error; process-kill failures alone are swallowed because successful VM termination also stops them. Failed process kills remain tracked until an individual kill or VM termination succeeds. No teardown idempotency guard or post-teardown method guard exists.

## Worker limits and ordering

WHEN parsing timeout configuration, the helper shall accept trimmed decimal digits for positive safe integers no larger than the supplied maximum, otherwise return the supplied default. Default/maximum arguments themselves are not validated.

IF an invocation timeout is not a positive safe integer at most 2,147,483,647 ms, THEN invocation shall reject before creating a worker. Per-call resource limits replace rather than merge with defaults. Limits constrain Node worker resources, not filesystem, network or process access.

WHEN the first message/error/exit/deadline arrives, the harness shall settle once, cancel its timer and attempt worker termination. Decoder/registration/scheduling errors shall reject and trigger cleanup. Exit without a message shall reject even for exit code zero. Termination is best effort and is not awaited before the result resolves/rejects; late events cannot change that result.

WHEN creating a native worker, the factory shall copy the supplied environment, use no inherited `execArgv`, and pass payload as `workerData`. Explicit TypeScript bootstrap shall require an absolute string entry, execute registration via an eval bootstrap and remove `NODE_V8_COVERAGE` from worker environment. Scheduler construction starts no timer.

## Deliberate exclusions and known issues

No local-process or browser-container provider is exported. The package does not capture audio, render host windows, persist sessions, reconnect by ID, delete individual files, poll previews automatically, authorize commands or make worker threads safe for hostile Node code.

E2B boot wraps SDK-create failures as SandboxOperationError with cause/category. If SDK creation succeeded but project/watcher setup fails, the newly created sandbox is not automatically killed. File-event origin is inferred from mount fingerprints, listing has documented adapter bounds and teardown has no idempotency latch. See [errors.spec.md](errors.spec.md) and [state.spec.md](state.spec.md) for caller obligations.

Evidence: [wrapper tests](../../src/e2b/__tests__/wrap-e2b-sandbox.test.ts), [provider tests](../../src/e2b/__tests__/provider.test.ts), [worker tests](../../src/__tests__/node-worker.test.ts), [native worker cases](../../src/__tests__/node-worker-native.test.ts). Tests were read, not executed.
