Spec ID: SPEC-JINI-AGENTIC-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:600a6ede8b273f5970dffb1e4c2ccd6fe97187b380e66565432bf5b28546ab1c
spec_mode: reverse_spec


# Agentic state contract

## GenUI encoder

Each encoder holds a pending-tool-call map keyed by tool-use id. Tool-use events replace entries; results consume them, falling back to an unknown name/null arguments when absent. Run-end clears the map. Run ids decorate output and do not partition this map. Allocate separate encoders for concurrent runs. State is process-local and has no timeout, capacity limit, persistence or public reset/dispose method.

## DOM highlights and host registrations

The DOM driver's intended implementation retains highlight timers/style snapshots by handle; re-highlighting restarts the marker and eventual cleanup restores original styling. The current construction defect prevents treating this lifecycle as operational. No general driver disposal method is exposed. Consumers own root lifetime and tool registration/unregistration on the host model context.

## A2UI interpreter

An interpreter starts with no surfaces and an empty subscriber set. Creation adds a catalog-bound surface containing validated components, model data and pending action state. Component updates insert/replace ids; there is no dedicated per-component deletion operation. Data updates replace or immutably patch the model. Surface deletion removes it and its pending actions.

An agent action requesting a response allocates a host-generated action id and remembers its response path. A matching response consumes that entry; successful values update the model, errors are discarded. Unknown responses do nothing. There is no pending-action expiry or maximum number of surfaces/components/actions.

`getSurface` exposes a snapshot whose map/model values are shared with internal state, rather than a deeply immutable copy. Consumers must treat it as readonly. Subscriptions run synchronously; unsubscribe accepts `{}` and removes the listener. Listener failure does not undo already-applied state. No persistence, replay, disposal or automatic transport synchronization is supplied.

## Installer filesystem lifecycle

Layout maps a validated workspace id to an absolute workspace root, staging root and state filename. Installation validates the complete input, enters an instance-local queue keyed by resolved workspace root, stages exclusive 0600 files, writes managed state and renames the directory into its final skill-name location. The staging directory is cleaned up on success/failure. Independent installer instances do not share a lock.

Managed state contains `enabled` and source (`uploaded` or GitHub URL/commit), not a tool registry. Missing state defaults to enabled/uploaded. A present state file must be regular, bounded to 8192 bytes and parse to valid state. Enable/disable writes via temporary file/rename; uninstall recursively removes the skill directory. These changes survive process restarts according to the filesystem, without fsync/durability guarantees beyond its operations.

The loader discovers managed skill descriptors. The installer resolves tool identity through the injected factory. Change callbacks run after filesystem mutation and can fail after commit. Consumers must reconcile filesystem state after such errors and protect/provision the roots they supply.

## Live tools and refresh

Live registration installs one permanent delegate per seen id and keeps mutable current slots. Replacements activate/deactivate slots, update descriptors by assignment and wrap registry discovery to hide inactive ids. Removed ids remain as inactive slots/delegates; there is no eviction/dispose. This state is not persistent and should be scoped to one owned registry.

The refresher holds only the current refresh promise; overlapping callers share it and a `finally` clears it. It does not schedule polling or persist a revision. A boolean change result reflects descriptor serialization, not every policy/handler mutation. Consumers decide when to refresh, update caches and release the registry.
