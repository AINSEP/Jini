Spec ID: SPEC-JINI-ANALYTICS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5a5cf8c6a0b419ab21b6baee009e998676089392c90bc34b2aa1eaa3d4f2da89
spec_mode: reverse_spec

# Behavior Contract: @jini-ai/analytics

Analytics first validates privacy bounds, resolves workspace, checks enabled/DNT/GPC/path/IP exclusions, validates event properties, derives daily salt/coarse identity/session, applies optional hook, then sends to the sink. Rejections return reason values. IP is coarsened and raw IP/UA is omitted from NormalizedHit; referrer is reduced to host and path query/fragment removed except selected UTM values. IPv4 CIDR and exact IPv6 exclusion are supported; IPv6 CIDR is not. Sessions are fixed daily time windows, not sliding sessions. Property validation walks nested keys/arrays, limits total entries/string lengths, and rejects PII-shaped names/email strings; hooks are trusted and their replacement hit is not revalidated. There is no geolocation, rollup, goals, aggregate query, retention worker, forwarding adapter, or authorization implementation. LocalBufferSink accumulates without eviction; list defaults 50, clamps 1..500, newest first.

Ingest validates positive safe-integer privacy bounds, resolves the host's workspace, loads its config, then applies enabled/DNT/GPC/path/IP exclusions before property validation and hashing. It truncates IPv4 to /24 and IPv6 to its first three groups, classifies UA into coarse device/browser/OS, and hashes salt + host + coarse signal. The daily HKDF-SHA256 salt has 32 bytes and includes caller extractionSalt and infoPrefix plus workspace/date. Path storage strips query/fragment while recognized UTM query values are retained; malformed referrers yield null. Session IDs use fixed UTC windows, not sliding inactivity. Hooks receive only the normalized hit; null drops it, a replacement is accepted without revalidation. Acceptance occurs only after sink.accept resolves.

Acceptance: a disabled config returns analytics_disabled without calling the sink; a PII-shaped property returns pii_rejected; a throwing sink rejects ingest rather than reporting accepted. No HTTP route, authentication, geolocation, rollup, retention scheduler or durable adapter is shipped.
