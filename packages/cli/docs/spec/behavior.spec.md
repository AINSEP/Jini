Spec ID: SPEC-JINI-CLI-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:8599d972eb51f01541c2e0eb63fd7c63987a27c234737c8e95bd4a825b00d289
spec_mode: reverse_spec


# CLI behavior contract

## Parsing and precedence

- WHEN either declared flag set is non-empty, parseFlags shall throw for an unknown `--name`; otherwise it shall accept arbitrary long flags and infer a following value unless that value begins `--`.
- WHEN a declared string flag has no following token, the parser shall throw. A following flag-shaped token still counts as its value. Inline `--name=value` shall remain a string even for a declared boolean flag.
- WHEN a flag repeats, its last value shall win. Short `-x` tokens shall be ignored by parseFlags and collected by positionalArgs.
- WHERE stopAtDoubleDash is true, positionalArgs shall collect all tokens after `--` verbatim; the default is false.
- WHEN coerceCliValue receives exactly true/false or a decimal matching `^-?\d+(\.\d+)?$`, it shall produce a boolean/number; other strings shall pass through.
- WHEN URL resolution runs, it shall choose non-empty flagUrl, then configured envVarName, then discovery, then defaultUrl, in that order. Discovery shall receive timeoutMs (default 800); the resolver shall not enforce that deadline itself.
- IF a resolved URL is remote and non-HTTPS, THEN the resolver shall call the warning sink; it shall not refuse the URL. Invalid URLs produce no policy warning.
- WHEN input contains both inline text and a file flag, inline shall win. Empty prompt shall fall through to file or null; empty body shall count as supplied. File path `-` shall select stdin.

## Defaults and limits

| Boundary | Current rule |
|---|---|
| JSON HTTP | 15000 ms deadline through fetch/body read; 10 MiB response byte cap; optional signal combined with internal timeout |
| Default file/stdin readers | 10 MiB; rejection past cap; optional cancellation; no built-in read deadline |
| Inline/injected text readers | No package size/cancellation enforcement |
| Diagnostic text | Strip controls, redact labeled credentials and opaque runs of 20+ characters, then retain first 500 UTF-16 units plus a truncation marker |
| Deep diagnostic sanitization | First 50 entries per object/array; depth above 4 replaced with a placeholder; keys use 100-character prefix limit plus marker |
| Run-watch buffer | 10 MiB of decoded string length before splitting frames; no byte-accurate limit, total stream cap, request timeout or cancellation option |

IF JSON response is empty or invalid JSON, THEN HTTP primitives shall return `{}` on success. Streaming/text bodies shall be size-checked; the json()-only response-double fallback shall not enforce the byte cap. No automatic retry shall occur.

WHEN control stripping runs, it shall preserve tab/LF/CR. Redaction shall preserve recognized uppercase host error identifiers and the delegated-tool-calls route token. It shall not guarantee removal of every possible credential format.

## Commands and ordering

The registry shall preserve insertion order and refuse duplicate registration unless override is true. Dispatch shall scan for the first token not beginning `-`, skipping known valueFlags' values, and pass every other token to the handler in original order. It shall not remove global flags for nested handlers.

The binary shall remove --daemon-url/--data-dir/--registry-path and their values before dispatch. Root help and version aliases shall be recognized as the first token. Library import shall not execute the binary.

| Command | Inputs | Request/output |
|---|---|---|
| run start | Required --context-ref; optional --agent-id/--idempotency-key | POST /api/runs; JSON |
| run list | Optional --context-ref | GET /api/runs with optional contextRef query; JSON |
| run get | Positional run id | GET /api/runs/:id; JSON |
| run cancel | Positional run id; optional --reason | POST /api/runs/:id/cancel; JSON |
| run watch | Positional run id; optional --after-cursor | GET /api/runs/:id/events; last-event-id header; data lines until end event or EOF |
| daemon status | Help switch recognized | GET /api/daemon/status; JSON |
| daemon stop | Help switch recognized | POST /api/daemon/shutdown with {}; completion means shutdown scheduled |
| version | Help switch recognized | GET /api/daemon/status; require non-empty string version, print it |

WHEN watch receives LF-separated blank-line-terminated SSE frames, it shall join their `data: ` lines, strip controls and print one newline-terminated value per frame; it shall stop after JSON data with kind end. It shall not reconnect, normalize CRLF, redact event contents, or emit an unterminated final frame.

WHEN introspection visits a tree, it shall list leaves in traversal order, exclude matching local command names and their descendants, and join nested names with spaces. MCP projection shall use the caller's prefix literally, replace spaces by underscores, expose arguments and value-taking options as strings, omit boolean switches and omit defaults from the generated schema. No tool-name collision check or command execution is supplied.

## Deliberate boundaries and known issues

The package shall not launch a daemon, implement run execution/idempotency, register product commands on library import, add authentication automatically, or provide UI. The host chooses commands and credentials.

JSON transport failures use structured envelopes, including unknown codes, oversized responses and body-read failures. Injected write/exit ports apply throughout. Sanitizer maxLength includes its truncation marker, which is shortened when the cap cannot fit the full marker.

Evidence: `src/flags.ts`, `daemon-url.ts`, `http.ts`, `prompt.ts`, `redact.ts`, `command-registry.ts`, command modules and `introspection.ts`; static tests under `src/__tests__/`. No runtime verification was run.

Decision rationale: [Introspection derives from the live command tree](../decisions/DR-001-live-command-introspection.md).
