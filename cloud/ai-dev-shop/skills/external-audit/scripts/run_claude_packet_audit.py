#!/usr/bin/env python3
"""Run a packet-first Claude audit with durable offloads and empty-result fallback.

This runner exists because Claude Code packet audits in JSON mode can sometimes
return a success wrapper with an empty final result. The script makes that
failure explicit, preserves raw outputs, and retries once in plain-text mode.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

MAX_TRANSIENT_RETRIES = 2
INITIAL_BACKOFF_SECONDS = 5
TRANSIENT_FAILURE_MARKERS = (
    "429",
    "503",
    "rate limit",
    "rate-limit",
    "capacity",
    "temporarily unavailable",
    "try again later",
    "overloaded",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, help="Authoring packet path")
    parser.add_argument(
        "--dispatch",
        required=True,
        help="Peer-readable dispatch packet path",
    )
    parser.add_argument(
        "--offload-prefix",
        required=True,
        help="Prefix for raw offload files, without extension",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=300,
        help="Hard timeout for the Claude audit call",
    )
    parser.add_argument(
        "--probe-timeout-seconds",
        type=int,
        default=120,
        help="Hard timeout for the readability probe",
    )
    parser.add_argument(
        "--retain-dispatch",
        action="store_true",
        help="Keep the dispatch copy after the run",
    )
    parser.add_argument(
        "--text-retry-timeout-seconds",
        type=int,
        default=120,
        help="Hard timeout for the plain-text fallback after an empty JSON result",
    )
    parser.add_argument(
        "--model",
        help="Exact Claude model override to pass through to every Claude CLI invocation.",
    )
    parser.add_argument(
        "--effort",
        choices=("low", "medium", "high", "xhigh"),
        help="Claude reasoning effort to pass through to every CLI invocation.",
    )
    parser.add_argument(
        "--suggest-changes",
        choices=("patches", "notes", "none"),
        default="patches",
        help="Whether the audit prompt should request proposed changes.",
    )
    parser.add_argument(
        "--audit-output-format",
        choices=("json", "stream-json"),
        default="json",
        help="Claude output transport for the substantive audit call.",
    )
    return parser.parse_args()


def write_output_text(path: Path, value: str | bytes | None) -> None:
    if value is None:
        text = ""
    elif isinstance(value, bytes):
        text = value.decode("utf-8", errors="replace")
    else:
        text = value
    path.write_text(text, encoding="utf-8")


def require_file(path: Path, label: str) -> None:
    """Raise a human-readable error before subprocess work begins."""
    if not path.exists():
        raise FileNotFoundError(f"{label} does not exist: {path}")
    if not path.is_file():
        raise IsADirectoryError(f"{label} is not a file: {path}")


def validate_paths(packet: Path, dispatch: Path, offload_prefix: Path) -> None:
    require_file(packet, "Packet")
    if dispatch.exists() and dispatch.is_dir():
        raise IsADirectoryError(f"Dispatch path points to a directory: {dispatch}")
    if offload_prefix.exists() and offload_prefix.is_dir():
        raise IsADirectoryError(
            f"Offload prefix points to a directory, not a file prefix: {offload_prefix}"
        )
    if packet.resolve() == dispatch.resolve():
        raise ValueError(
            "--dispatch must differ from --packet because the dispatch copy is transient."
        )


def ensure_claude_cli_available() -> None:
    if shutil.which("claude") is None:
        raise FileNotFoundError("Claude CLI was not found on PATH; expected `claude`.")


def run_command(
    cmd: list[str],
    timeout_seconds: int,
    stdout_path: Path,
    stderr_path: Path,
) -> tuple[subprocess.CompletedProcess[str] | None, float, str | None]:
    start = time.monotonic()
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        elapsed = time.monotonic() - start
        write_output_text(stdout_path, completed.stdout)
        write_output_text(stderr_path, completed.stderr)
        return completed, elapsed, None
    except subprocess.TimeoutExpired as exc:
        elapsed = time.monotonic() - start
        write_output_text(stdout_path, exc.stdout)
        write_output_text(stderr_path, exc.stderr)
        return None, elapsed, "timeout"


def parse_json_result(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def parse_stream_json_result(raw: str) -> dict | None:
    """Return the terminal result event from Claude's newline-delimited stream."""
    terminal: dict | None = None
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("type") == "result":
            terminal = payload
    return terminal


def run_stream_command(
    cmd: list[str],
    timeout_seconds: int,
    stdout_path: Path,
    stderr_path: Path,
    peer_name: str,
) -> tuple[subprocess.CompletedProcess[str] | None, float, str | None, list[dict[str, object]]]:
    """Run a stream-json peer call with durable live offloads and heartbeats."""
    start = time.monotonic()
    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open(
        "w", encoding="utf-8"
    ) as stderr_file:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        def pump(source, destination, chunks: list[str]) -> None:
            for line in iter(source.readline, ""):
                chunks.append(line)
                destination.write(line)
                destination.flush()
            source.close()

        stdout_thread = threading.Thread(
            target=pump,
            args=(process.stdout, stdout_file, stdout_chunks),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=pump,
            args=(process.stderr, stderr_file, stderr_chunks),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        next_heartbeat = 30.0
        failure: str | None = None
        while process.poll() is None:
            elapsed = time.monotonic() - start
            if elapsed >= timeout_seconds:
                failure = "timeout"
                process.kill()
                break
            if elapsed >= next_heartbeat:
                print(
                    f"[peer-heartbeat] {peer_name} | alive | {int(elapsed)}s",
                    file=sys.stderr,
                    flush=True,
                )
                next_heartbeat += 30.0
            time.sleep(0.25)

        returncode = process.wait()
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

    elapsed = time.monotonic() - start
    stdout_text = "".join(stdout_chunks)
    stderr_text = "".join(stderr_chunks)
    completed = subprocess.CompletedProcess(cmd, returncode, stdout_text, stderr_text)
    attempts = [{
        "attempt": 1,
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "elapsed_seconds": round(elapsed, 2),
        "timeout_seconds": timeout_seconds,
        "failure": failure,
        "returncode": returncode,
        "stdout_length": len(stdout_text),
        "stderr_length": len(stderr_text),
    }]
    return completed, elapsed, failure, attempts


def quoted(value: str) -> str:
    return json.dumps(value)


def extract_models(payload: dict | None) -> list[str]:
    if not isinstance(payload, dict):
        return []
    model_usage = payload.get("modelUsage", {})
    if isinstance(model_usage, dict):
        return [str(key) for key in model_usage.keys()]
    return []


def attempt_path(base: Path, attempt: int) -> Path:
    if attempt == 0:
        return base
    return base.with_name(f"{base.stem}.retry{attempt}{base.suffix}")


def is_transient_failure(stdout: str, stderr: str, returncode: int) -> bool:
    if returncode == 0:
        return False
    combined = f"{stdout}\n{stderr}".lower()
    return any(marker in combined for marker in TRANSIENT_FAILURE_MARKERS)


def run_command_with_transient_retries(
    cmd: list[str],
    timeout_budget_seconds: int,
    stdout_path: Path,
    stderr_path: Path,
    max_retries: int = MAX_TRANSIENT_RETRIES,
) -> tuple[
    subprocess.CompletedProcess[str] | None,
    float,
    str | None,
    list[dict[str, object]],
]:
    start = time.monotonic()
    attempts: list[dict[str, object]] = []

    for attempt in range(max_retries + 1):
        remaining_seconds = max(1, int(timeout_budget_seconds - (time.monotonic() - start)))
        current_stdout = attempt_path(stdout_path, attempt)
        current_stderr = attempt_path(stderr_path, attempt)
        completed, elapsed, failure = run_command(
            cmd,
            remaining_seconds,
            current_stdout,
            current_stderr,
        )
        total_elapsed = time.monotonic() - start
        attempt_record: dict[str, object] = {
            "attempt": attempt + 1,
            "stdout_path": str(current_stdout),
            "stderr_path": str(current_stderr),
            "elapsed_seconds": round(elapsed, 2),
            "timeout_seconds": remaining_seconds,
            "failure": failure,
        }
        if completed is not None:
            attempt_record["returncode"] = completed.returncode
            attempt_record["stdout_length"] = len(completed.stdout)
            attempt_record["stderr_length"] = len(completed.stderr)
        attempts.append(attempt_record)

        if failure == "timeout":
            return None, total_elapsed, "timeout", attempts

        if completed is None:
            return None, total_elapsed, "malformed_or_no_output", attempts

        if not is_transient_failure(completed.stdout, completed.stderr, completed.returncode):
            return completed, total_elapsed, None, attempts

        attempts[-1]["failure"] = "capacity_or_rate_limit"
        if attempt >= max_retries:
            return completed, total_elapsed, "capacity_or_rate_limit", attempts

        remaining_after = timeout_budget_seconds - (time.monotonic() - start)
        if remaining_after <= 1:
            return completed, total_elapsed, "capacity_or_rate_limit", attempts

        backoff_seconds = min(
            INITIAL_BACKOFF_SECONDS * (2**attempt),
            max(0, int(remaining_after) - 1),
        )
        attempts[-1]["backoff_seconds"] = backoff_seconds
        if backoff_seconds > 0:
            time.sleep(backoff_seconds)

    return None, time.monotonic() - start, "capacity_or_rate_limit", attempts


def extract_file_paths_from_packet(packet: Path) -> list[str]:
    text = packet.read_text(encoding="utf-8")
    in_table = False
    paths: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "## Files And Artifacts":
            in_table = True
            continue
        if in_table and stripped.startswith("## "):
            break
        if not in_table or not stripped.startswith("|"):
            continue
        if stripped.startswith("| Path |") or stripped.startswith("|---|"):
            continue
        columns = [column.strip() for column in stripped.strip("|").split("|")]
        if not columns:
            continue
        path = columns[0].strip().strip("`")
        if path:
            paths.append(path)
    return paths


def build_probe_prompt(dispatch: Path) -> str:
    return (
        f"Read the file at path {quoted(str(dispatch))} and return exactly the first "
        "Markdown heading line, nothing else."
    )


def build_suggested_changes_instruction(mode: str) -> str:
    if mode == "none":
        return "Do not include suggested file changes."
    if mode == "notes":
        return (
            "Include a `Suggested Changes` section with file-level edit guidance "
            "and concise replacement snippets when useful."
        )
    return (
        "Include a `Suggested Changes` section plus `Proposed File Changes` with "
        "unified diffs or bounded replacement snippets only for files you actually "
        "reviewed. If the scope is too uncertain for safe patch proposals, fall "
        "back to note-style suggestions and say why."
    )


def build_audit_prompt(dispatch: Path, suggest_changes: str) -> str:
    return (
        f"Read the packet at path {quoted(str(dispatch))} and inspect only the files "
        "listed in its Files And Artifacts section using Read. Follow the packet's "
        f"Auditor Instructions exactly. {build_suggested_changes_instruction(suggest_changes)}"
    )


def build_text_retry_prompt(dispatch: Path, file_paths: list[str], suggest_changes: str) -> str:
    if file_paths:
        file_block = "\n".join(f"- {quoted(path)}" for path in file_paths)
        file_instruction = f"Inspect only these listed files:\n{file_block}\n"
    else:
        file_instruction = (
            "Inspect only the files named in the packet's Files And Artifacts section.\n"
        )
    suggested_sections = ""
    if suggest_changes != "none":
        suggested_sections += "## Suggested Changes\n"
    if suggest_changes == "patches":
        suggested_sections += "## Proposed File Changes\n"
    return (
        f"Read the packet at path {quoted(str(dispatch))}. "
        "This is a bounded retry after an empty JSON audit result.\n"
        f"{file_instruction}"
        "Use Read only. Do not review the wider repo. Return plain text with exactly "
        "these sections:\n"
        "## Auditor Scope Check\n"
        "## Findings (Ordered by Severity)\n"
        "## Blockers vs. Optional Improvements\n"
        "## What Looks Solid and Should Stay Unchanged\n"
        f"{suggested_sections}"
        "If any listed path is unreadable, say so in Auditor Scope Check and continue "
        "with the rest."
    )


def build_claude_base_cmd(args: argparse.Namespace) -> list[str]:
    cmd = ["claude"]
    if args.model:
        cmd += ["--model", args.model]
    if args.effort:
        cmd += ["--effort", args.effort]
    return cmd


def main() -> int:
    args = parse_args()

    packet = Path(args.packet)
    dispatch = Path(args.dispatch)
    offload_prefix = Path(args.offload_prefix)

    summary: dict[str, object] = {
        "status": "failed",
        "packet": str(packet),
        "dispatch": str(dispatch),
        "offload_prefix": str(offload_prefix),
        "requested_model": args.model,
        "requested_effort": args.effort,
        "suggest_changes": args.suggest_changes,
        "audit_output_format": args.audit_output_format,
    }

    try:
        validate_paths(packet, dispatch, offload_prefix)
        ensure_claude_cli_available()
        packet_file_paths = extract_file_paths_from_packet(packet)

        dispatch.parent.mkdir(parents=True, exist_ok=True)
        offload_prefix.parent.mkdir(parents=True, exist_ok=True)
        # The dispatch copy is the immutable packet Claude reads during the run.
        shutil.copyfile(packet, dispatch)

        probe_stdout = offload_prefix.with_name(offload_prefix.name + "-probe.stdout.json")
        probe_stderr = offload_prefix.with_name(offload_prefix.name + "-probe.stderr.txt")
        audit_stdout = offload_prefix.with_name(offload_prefix.name + "-audit.stdout.json")
        audit_stderr = offload_prefix.with_name(offload_prefix.name + "-audit.stderr.txt")
        audit_result = offload_prefix.with_name(offload_prefix.name + "-audit.result.md")
        text_stdout = offload_prefix.with_name(
            offload_prefix.name + "-audit.text-retry.stdout.txt"
        )
        text_stderr = offload_prefix.with_name(
            offload_prefix.name + "-audit.text-retry.stderr.txt"
        )
        text_result = offload_prefix.with_name(
            offload_prefix.name + "-audit.text-retry.result.txt"
        )

        claude_base_cmd = build_claude_base_cmd(args)
        probe_cmd = claude_base_cmd + [
            "-p",
            "--output-format",
            "json",
            build_probe_prompt(dispatch),
        ]
        probe_completed, probe_elapsed, probe_failure, probe_attempts = (
            run_command_with_transient_retries(
                probe_cmd,
                args.probe_timeout_seconds,
                probe_stdout,
                probe_stderr,
                max_retries=1,
            )
        )
        summary["probe"] = {
            "elapsed_seconds": round(probe_elapsed, 2),
            "failure": probe_failure,
            "attempts": probe_attempts,
        }
        if probe_failure:
            summary["status"] = "probe_failed"
            print(json.dumps(summary, indent=2))
            return 1

        probe_payload = parse_json_result(probe_completed.stdout)
        if (
            probe_completed.returncode != 0
            or not probe_payload
            or not probe_payload.get("result")
        ):
            summary["status"] = "probe_failed"
            summary["probe"] |= {
                "returncode": probe_completed.returncode,
                "result_length": len(probe_completed.stdout),
            }
            print(json.dumps(summary, indent=2))
            return 1

        probe_models = extract_models(probe_payload)
        summary["probe"] |= {
            "returncode": probe_completed.returncode,
            "result": probe_payload.get("result", ""),
            "model": probe_models[0] if probe_models else None,
            "models": probe_models,
        }
        print(
            "[peer-handshake] claude | ACK_PACKET_RECEIVED "
            f"{dispatch.name} | {probe_payload.get('result', '').strip()}",
            file=sys.stderr,
            flush=True,
        )

        audit_cmd = claude_base_cmd + [
            "-p",
            "--allowedTools",
            "Read",
            "--output-format",
            args.audit_output_format,
        ]
        if args.audit_output_format == "stream-json":
            audit_cmd += ["--verbose"]
        audit_cmd += ["--", build_audit_prompt(dispatch, args.suggest_changes)]

        if args.audit_output_format == "stream-json":
            audit_completed, audit_elapsed, audit_failure, audit_attempts = run_stream_command(
                audit_cmd,
                args.timeout_seconds,
                audit_stdout,
                audit_stderr,
                "Claude Sonnet 5 xhigh",
            )
        else:
            audit_completed, audit_elapsed, audit_failure, audit_attempts = (
                run_command_with_transient_retries(
                    audit_cmd,
                    args.timeout_seconds,
                    audit_stdout,
                    audit_stderr,
                )
            )
        summary["audit"] = {
            "elapsed_seconds": round(audit_elapsed, 2),
            "failure": audit_failure,
            "attempts": audit_attempts,
        }
        if audit_failure == "timeout":
            summary["status"] = "timeout"
            print(json.dumps(summary, indent=2))
            return 1
        if audit_failure == "capacity_or_rate_limit":
            summary["status"] = "capacity_or_rate_limit"
            print(json.dumps(summary, indent=2))
            return 1

        raw_stdout = audit_completed.stdout
        if args.audit_output_format == "stream-json":
            audit_payload = parse_stream_json_result(raw_stdout)
        else:
            audit_payload = parse_json_result(raw_stdout)
        if audit_completed.returncode != 0 or not audit_payload:
            summary["status"] = "malformed_or_no_output"
            summary["audit"] |= {
                "returncode": audit_completed.returncode,
                "stdout_length": len(raw_stdout),
                "stderr_length": len(audit_completed.stderr),
            }
            print(json.dumps(summary, indent=2))
            return 1

        result_text = audit_payload.get("result", "")
        audit_models = extract_models(audit_payload)
        summary["audit"] |= {
            "returncode": audit_completed.returncode,
            "stdout_length": len(raw_stdout),
            "stderr_length": len(audit_completed.stderr),
            "num_turns": audit_payload.get("num_turns"),
            "model": audit_models[0] if audit_models else None,
            "models": audit_models,
        }

        if result_text:
            audit_result.write_text(result_text, encoding="utf-8")
            summary["status"] = "responded"
            summary["audit"]["result_path"] = str(audit_result)
            summary["audit"]["result_length"] = len(result_text)
        else:
            text_cmd = claude_base_cmd + [
                "-p",
                "--allowedTools",
                "Read",
                "--",
                build_text_retry_prompt(dispatch, packet_file_paths, args.suggest_changes),
            ]
            text_completed, text_elapsed, text_failure, text_attempts = (
                run_command_with_transient_retries(
                    text_cmd,
                    min(args.text_retry_timeout_seconds, args.timeout_seconds),
                    text_stdout,
                    text_stderr,
                    max_retries=1,
                )
            )
            summary["text_retry"] = {
                "elapsed_seconds": round(text_elapsed, 2),
                "failure": text_failure,
                "timeout_seconds": min(
                    args.text_retry_timeout_seconds, args.timeout_seconds
                ),
                "attempts": text_attempts,
            }
            if text_failure == "timeout":
                summary["status"] = "empty_result_transport_failure"
            elif text_failure == "capacity_or_rate_limit":
                summary["status"] = "capacity_or_rate_limit"
            else:
                text_output = text_completed.stdout
                summary["text_retry"] |= {
                    "returncode": text_completed.returncode,
                    "stdout_length": len(text_output),
                    "stderr_length": len(text_completed.stderr),
                }
                if text_completed.returncode == 0 and text_output.strip():
                    text_result.write_text(text_output, encoding="utf-8")
                    summary["status"] = "responded_text_retry"
                    summary["text_retry"]["result_path"] = str(text_result)
                else:
                    summary["status"] = "empty_result_transport_failure"

        print(json.dumps(summary, indent=2))
        return 0 if summary["status"] in {"responded", "responded_text_retry"} else 1
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        message = str(exc)
        summary["status"] = "missing_dependency" if "claude" in message.lower() else "invalid_input"
        summary["error"] = message
        print(json.dumps(summary, indent=2))
        return 1
    finally:
        if not args.retain_dispatch:
            try:
                dispatch.unlink()
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    sys.exit(main())
