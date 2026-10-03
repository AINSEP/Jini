Spec ID: SPEC-JINI-DEVOPS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:ba5414a2ca233286e9ec6e7ec2a7f213c213abe51cba4a2f48dd2dfd1925300e
spec_mode: reverse_spec


# DevOps errors and caller actions

| Error class | Trigger and fields | Caller action |
|---|---|---|
| `DeployError` | message; status default 400; optional details/code. Unknown target uses status 404 and details.errorCode `deploy_target_not_found`; redirect guard uses 502 without code | Correct target/config; treat redirect as refused transport; map status at host boundary |
| `ExportPathError` | Invalid base/output/request URL encoding, traversal or Node directory/symlink boundary; inherits Error, no code/name override | Correct host paths/inventory; do not retry the same path |
| `ExportOutputNotEmptyError` | Node writer prepare sees existing contents without clean; inherits Error, no code/name override | Choose empty output or explicitly authorize clean in host workflow |
| `RangeError` | Invalid export timeout, coverage floor/tier percentage, or listener port | Correct input |
| `TypeError` | Invalid npm scope/dependency name or no published-types projects | Correct scope/project inventory |
| Plain `Error` | Agent-job validation; archive/payload/native/package closure checks; packaging process failure; invalid moving-path inputs; source/destination overlap | Correct input/closure, rebuild stale artifacts, or repair host port |

Provider errors may also throw DeployError with target-specific codes/status/details; this package supplies no provider-code registry. Raw filesystem, module, AST/SDK, callback and transport errors can propagate where not explicitly captured. Source-control error descriptions must already be caller-safe.

## Returned failures

| Surface | Codes/statuses | Caller response |
|---|---|---|
| Source-control orchestration | `INVALID_CONFIG`, `NO_CREDENTIALS_CONFIGURED`, `EXPORT_FAILED`, `REPOSITORY_NOT_FOUND`, `NO_CHANGES`, `DIVERGED_BRANCH`, `NETWORK_UNREACHABLE`, `PROVIDER_ERROR` | Fix configuration/credential/export; reconcile divergence; treat no changes as a completed no-op; retry transport only after checking whether a write landed |
| Provider commitSite | `repository-not-found`, `no-changes`, `diverged`, `network-unreachable`, `provider-error` | Same policy; orchestration maps to uppercase codes |
| Provider file/backup operations | Shared `provider-error` or `network-unreachable` (latter includes logDetail); plan `branch-not-found`; commits `diverged`; inspect `repo-not-found`, `repo-not-private`, `no-push-permission`, `repo-empty`, `branch-not-found`, `folder-is-file` | Repair repository/access/branch/path or approved plan before mutation |
| Registry parse/load/build | false/reason or message/refusals; inactive providers recorded in switchedOff | Display refusals; repair descriptor/trust/activation; never import a refused catalog entry |
| Static export | routes.failed/assets.failed with reason; `firstExportFailure` prioritizes routes | Refuse downstream publish of partial output; inspect item failures |
| Reachability | reachable false/statusMessage, optional protected/statusCode; polling link-delayed | Keep deployment acceptance separate from link health; retry probing later |
| Agent jobs | parsed false/reason; job status failed and optional exitCode | Preserve logs; retry only after investigating failure; success marker controls subsequent skips |
| Published types | `linked`, `drift`, `install-error`, `prerequisite-error`, `typecheck-error`, `operation-error`; pass/skipped are nonfailures | Remove links, fix declaration drift, repair prerequisite/install/compiler or cleanup; inspect captured diagnostics |
| Coverage/packaging checks | failure strings, mismatches or contaminated verdicts | Review evidence; no fabricated pass or automatic source repair |

`parseCodexRun` catches decoder errors per line; `runAgentJobs` catches execution/log-read errors per job. Later marker/write/remove errors propagate rather than becoming another job status. Registry catalog.list and provider module create errors propagate; individual imports/parses are folded into refusals. Export startup/inventory/close errors propagate; per-item requests/body/write errors become report failures. `check` captures project operational failures but not logger errors. LCOV reader and baseline JSON parse errors propagate. DNS/public-URL refusals inside reachability become unreachable data rather than thrown errors.

No package-wide error envelope, automatic retry policy or transaction for external publish is defined.
