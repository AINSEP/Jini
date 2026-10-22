Spec ID: SPEC-JINI-ANALYTICS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c99fc9947973613ee6c54130b5970af1d5147f173ca00898ff60c314166fecbc
spec_mode: reverse_spec

# Error Contract: @jini-ai/analytics

`AnalyticsPiiRejectedError({ message }, { cause? } = {})` is thrown by direct `validateEventProps` calls for PII-shaped keys, email-shaped strings, excessive string length, or aggregate key count (including nested object/array entries). Ingest converts only that class to `{ accepted: false, reason: 'pii_rejected' }`. Use `instanceof`; the class does not set a custom name/code.

Invalid positive privacy bounds or empty workspace/date/salt context throw `RangeError`. Hash/resolver/config/hook/sink failures propagate; no retry or error envelope is supplied. Ingest drop reasons are workspace_unresolved, analytics_disabled, dnt, gpc, excluded_path, excluded_ip, pii_rejected and dropped_by_hook. These are policy outcomes, not exceptions.

Typed JSON inputs must be acyclic; runtime traversal has no visited-object cycle guard. The date input is an unvalidated string alias. Hosts supply valid timestamps and well-formed exclusions; IPv6 CIDR exclusions are not implemented. These limits describe source behavior rather than promised validation.
