#!/usr/bin/env python3
"""Run a small CLI compatibility matrix for Swarm Consensus peers."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
from typing import List
import tomllib

END_MARKER = "<<SWARM_END>>"
DEFAULT_AGY_MODEL = "Gemini 3.1 Pro (High)"
DISCOVERY_CACHE_VERSION = 1
REPO_ROOT = Path(__file__).resolve().parents[3]
HOST_ROOT = REPO_ROOT.parent
MODEL_CANDIDATE_LADDERS_PATH = (
    REPO_ROOT / "skills" / "swarm-consensus" / "references" / "model-candidate-ladders.json"
)


def resolve_workspace_root() -> Path:
    for key in ("ADS_MEMORY_ROOT", "ADS_PROJECT_KNOWLEDGE_ROOT", "ADS_WORKSPACE_ROOT"):
        raw = os.environ.get(key)
        if raw:
            return Path(raw).expanduser().resolve()
    return HOST_ROOT / "ADS-memory"


def display_path(path: Path) -> str:
    for base in (HOST_ROOT, REPO_ROOT):
        try:
            return path.relative_to(base).as_posix()
        except ValueError:
            continue
    return path.as_posix()


WORKSPACE_ROOT = resolve_workspace_root()
WORKSPACE_LABEL = display_path(WORKSPACE_ROOT)
DEFAULT_SMOKE_TEST_DIR = WORKSPACE_ROOT / "reports" / "swarm-consensus" / "smoke-tests"
LEGACY_SMOKE_TEST_DIR = WORKSPACE_ROOT / ".local-artifacts" / "swarm-consensus" / "smoke-tests"
DEFAULT_DISCOVERY_CACHE_PATH = str(DEFAULT_SMOKE_TEST_DIR / "last-known-good.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smoke-test peer CLI flags and output modes for Swarm Consensus."
    )
    parser.add_argument(
        "--prompt",
        default=f"Reply with OK and then {END_MARKER} only.",
        help="Prompt to send to each CLI.",
    )
    parser.add_argument(
        "--case-timeout",
        type=int,
        default=75,
        help="Per-case timeout in seconds.",
    )
    parser.add_argument(
        "--claude-model",
        help="Explicit Claude model override for this test run.",
    )
    parser.add_argument(
        "--gemini-model",
        help="Explicit Gemini model override for this test run.",
    )
    parser.add_argument(
        "--codex-model",
        help="Explicit Codex model override for this test run.",
    )
    parser.add_argument(
        "--codex-cd",
        default=os.getcwd(),
        help="Directory passed to `codex exec --cd`. Use /tmp to isolate Codex from repo startup rules.",
    )
    parser.add_argument(
        "--save-artifact",
        action="store_true",
        help="Save the rendered report to a dated file.",
    )
    parser.add_argument(
        "--output-format",
        choices=("markdown", "json"),
        default="markdown",
        help="Report format for stdout.",
    )
    parser.add_argument(
        "--model-plan-only",
        action="store_true",
        help="Resolve peer model identities from saved preferences/proof artifacts without dispatching any peer prompt.",
    )
    parser.add_argument(
        "--artifacts-dir",
        default=str(DEFAULT_SMOKE_TEST_DIR),
        help=(
            "Directory for dated smoke-test artifacts when --save-artifact is used. "
            f"Defaults to the retained cache/proof path at {WORKSPACE_LABEL}/reports/swarm-consensus/smoke-tests. "
            f"Override with {WORKSPACE_LABEL}/.local-artifacts/swarm-consensus/smoke-tests for transient local-only runs."
        ),
    )
    parser.add_argument(
        "--discover-claude",
        action="store_true",
        help="Probe candidate Claude model names and return the first working exact model.",
    )
    parser.add_argument(
        "--claude-require",
        choices=("json", "both"),
        default="json",
        help="Success requirement for Claude discovery. Use 'both' when the workflow may need both JSON and plain-text transport.",
    )
    parser.add_argument(
        "--claude-candidate",
        action="append",
        default=[],
        help="Additional Claude model candidate to probe during discovery. Repeatable.",
    )
    parser.add_argument(
        "--discovery-cache-path",
        default=DEFAULT_DISCOVERY_CACHE_PATH,
        help="Path for the environment-keyed Claude discovery cache.",
    )
    parser.add_argument(
        "--agy-model",
        default=None,
        help="agy model name for this test run (e.g. 'Gemini 3.1 Pro (High)'). Defaults to DEFAULT_AGY_MODEL.",
    )
    parser.add_argument(
        "--agy-cd",
        default="/tmp",
        help="Working directory for agy dispatch. Defaults to /tmp to avoid loading AGENTS.md.",
    )
    parser.add_argument("--skip-claude", action="store_true")
    parser.add_argument(
        "--skip-gemini",
        action="store_true",
        default=True,
        help="Skip legacy gemini CLI (default: True — gemini is sunsetted).",
    )
    parser.add_argument(
        "--include-legacy-gemini",
        action="store_true",
        help="Probe the legacy gemini CLI even though it is sunsetted for the individual tier. Overrides --skip-gemini.",
    )
    parser.add_argument("--skip-codex", action="store_true")
    parser.add_argument("--skip-agy", action="store_true")
    return parser


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def is_jsonish(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.startswith("{") or stripped.startswith("["):
        return True
    lines = [line for line in stripped.splitlines() if line.strip()]
    return bool(lines) and all(line.lstrip().startswith("{") for line in lines)


def ensure_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def load_json_file(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def load_model_candidate_ladders() -> dict:
    payload = load_json_file(MODEL_CANDIDATE_LADDERS_PATH)
    if not isinstance(payload, dict):
        return {}
    return payload


def load_saved_claude_model() -> str | None:
    payload = load_json_file(Path.home() / ".claude" / "settings.json")
    if not isinstance(payload, dict):
        return None
    model = payload.get("model")
    return str(model).strip() if model else None


def is_exact_model_identifier(model: str | None) -> bool:
    if not model:
        return False
    normalized = model.strip().lower()
    if normalized in {"opus", "sonnet", "haiku", "latest", "default"}:
        return False
    if not any(character.isdigit() for character in normalized):
        return False
    if any(marker in normalized for marker in (".", "[", ":", "/")):
        return True
    if normalized.startswith(("gemini-", "gpt-")):
        return True
    # Claude family strings like `claude-opus-4-6` are still aliases unless
    # they carry a dated model suffix.
    if normalized.startswith("claude-"):
        return re.search(r"\d{8}", normalized) is not None
    return False


def extract_markdown_model(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    model = match.group(1).strip()
    return model if is_exact_model_identifier(model) else None


def unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    result: list[Path] = []
    for path in paths:
        try:
            key = path.expanduser().resolve(strict=False)
        except OSError:
            key = path.expanduser().absolute()
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def model_memory_roots() -> list[Path]:
    roots: list[Path] = []
    for key in ("ADS_MEMORY_ROOT", "ADS_PROJECT_KNOWLEDGE_ROOT", "ADS_WORKSPACE_ROOT"):
        raw = os.environ.get(key)
        if raw:
            roots.append(Path(raw))
    roots.extend(
        [
            WORKSPACE_ROOT,
            REPO_ROOT,
        ]
    )
    return unique_paths(roots)


def model_memory_cache_paths() -> list[Path]:
    paths: list[Path] = [
        DEFAULT_SMOKE_TEST_DIR / "last-known-good.json",
        LEGACY_SMOKE_TEST_DIR / "last-known-good.json",
    ]
    for root in model_memory_roots():
        paths.extend(
            [
                root / "reports" / "swarm-consensus" / "smoke-tests" / "last-known-good.json",
                root
                / ".local-artifacts"
                / "swarm-consensus"
                / "smoke-tests"
                / "last-known-good.json",
            ]
        )
    return unique_paths(paths)


def model_memory_report_patterns() -> list[tuple[Path, str]]:
    patterns: list[tuple[Path, str]] = []
    for root in model_memory_roots():
        patterns.extend(
            [
                (root / "reports" / "swarm-consensus" / "smoke-tests", "*-claude-discovery.md"),
                (
                    root / ".local-artifacts" / "swarm-consensus" / "smoke-tests",
                    "*-claude-discovery.md",
                ),
                (root / "reports" / "swarm-consensus" / "runs", "*.md"),
                (root / ".local-artifacts" / "swarm-consensus" / "runs", "*.md"),
                (root / "tmp" / "peer-dispatch", "**/*.md"),
            ]
        )
    return [(path, pattern) for path, pattern in unique_report_patterns(patterns)]


def unique_report_patterns(patterns: list[tuple[Path, str]]) -> list[tuple[Path, str]]:
    seen: set[tuple[Path, str]] = set()
    result: list[tuple[Path, str]] = []
    for directory, pattern in patterns:
        try:
            key = (directory.expanduser().resolve(strict=False), pattern)
        except OSError:
            key = (directory.expanduser().absolute(), pattern)
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def peer_markdown_patterns(peer: str) -> list[str]:
    display = {
        "claude": "Claude",
        "gemini": "Gemini",
        "codex": "Codex",
    }.get(peer, peer.title())
    cli = re.escape(peer)
    name = re.escape(display)
    return [
        rf"Saved {name} model:\s*`([^`]+)`",
        rf"\|\s*Peer\s*\|\s*{name}\s*\|\s*`([^`]+)`\s*\|",
        rf"\|\s*(?:Peer|Primary)\s*\|\s*{name}\s*\|\s*`([^`]+)`\s*\|",
        rf"\|\s*Peer\s*\|\s*{cli}\s*\|\s*(?:`[^`]*`|[^|]*)\|\s*`([^`]+)`\s*\|",
        rf"\|\s*Primary\s*\|\s*{cli}(?:\s+session)?\s*\|\s*(?:`[^`]*`|[^|]*)\|\s*`([^`]+)`\s*\|",
        rf"(?:^|\n)\s*[-*]\s*{name}:\s*`([^`]+)`",
        rf"(?:^|\n)\s*[-*]\s*{name}\s+peer:\s*`([^`]+)`",
    ]


def extract_peer_model_from_text(peer: str, text: str) -> str | None:
    for pattern in peer_markdown_patterns(peer):
        model = extract_markdown_model(pattern, text)
        if model:
            return model
    return None


def load_saved_peer_model_from_memory_map(peer: str) -> dict[str, str] | None:
    """Find a saved peer model preference from ADS and repo-local evidence."""

    cache_paths = model_memory_cache_paths() if peer == "claude" else []
    for cache_path in cache_paths:
        payload = load_json_file(cache_path)
        if not isinstance(payload, dict):
            continue
        entries = payload.get("entries")
        if not isinstance(entries, list):
            continue
        for entry in reversed(entries):
            if not isinstance(entry, dict):
                continue
            for field in ("winner_model", "requested_model"):
                model = str(entry.get(field) or "").strip()
                if is_exact_model_identifier(model):
                    artifact_path = resolve_cache_artifact_path(entry.get("artifact_path"))
                    note = f"from {display_path(cache_path)} field {field}"
                    if artifact_path and not artifact_path.exists():
                        note += "; artifact path is stale"
                    return {
                        "model": model,
                        "source": "saved_smoke_cache",
                        "note": note,
                    }

    for directory, pattern in model_memory_report_patterns():
        try:
            candidates = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime)
        except OSError:
            candidates = []
        for report_path in reversed(candidates):
            try:
                text = report_path.read_text(encoding="utf-8")
            except OSError:
                continue
            model = extract_peer_model_from_text(peer, text)
            if model:
                return {
                    "model": model,
                    "source": f"saved_{peer}_report",
                    "note": f"from {display_path(report_path)}",
                }
    return None


def load_saved_claude_model_from_memory_map() -> dict[str, str] | None:
    """Find a saved Claude model preference without running a fresh smoke test."""

    return load_saved_peer_model_from_memory_map("claude")


def load_saved_gemini_model() -> str | None:
    payload = load_json_file(Path.home() / ".gemini" / "settings.json")
    if not isinstance(payload, dict):
        return None
    model_block = payload.get("model")
    if not isinstance(model_block, dict):
        return None
    model = model_block.get("name")
    return str(model).strip() if model else None


def load_saved_codex_config() -> dict[str, str]:
    path = Path.home() / ".codex" / "config.toml"
    try:
        with path.open("rb") as handle:
            payload = tomllib.load(handle)
    except (FileNotFoundError, OSError, tomllib.TOMLDecodeError):
        return {}

    result: dict[str, str] = {}
    model = payload.get("model")
    reasoning = payload.get("model_reasoning_effort")
    if model:
        result["model"] = str(model).strip()
    if reasoning:
        result["reasoning_effort"] = str(reasoning).strip()
    if result:
        result["config_path"] = str(path)
    return result


def extract_model_suggestion(text: str) -> str | None:
    match = re.search(r"Try --model to switch to ([^\s\"']+)", text)
    if not match:
        return None
    return match.group(1).strip().rstrip(".,)")


def normalize_model_hint(model: str | None) -> str | None:
    if not model:
        return None
    normalized = model.strip().lower()
    if not normalized:
        return None
    normalized = re.sub(r"^(?:[a-z0-9_.-]*\.)?(claude-)", r"\1", normalized)
    match = re.search(r"claude-(opus|sonnet|haiku)-(\d+(?:-\d+)?)", normalized)
    if match:
        return f"claude-{match.group(1)}-{match.group(2)}"
    if normalized in {"opus", "sonnet", "haiku"}:
        return f"claude-{normalized}"
    return normalized


def extract_claude_family(model: str | None) -> str | None:
    normalized = normalize_model_hint(model)
    if not normalized:
        return None
    for family in ("opus", "sonnet", "haiku"):
        if f"claude-{family}" in normalized:
            return family
    return None


def normalize_hostname() -> str:
    raw = socket.gethostname()
    for suffix in (".local", ".lan"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]
    return raw


def build_claude_environment(cli_versions: list[dict[str, str]], requirement: str) -> dict[str, str]:
    record = next((item for item in cli_versions if item["cli"] == "claude"), None)
    return {
        "cli": "claude",
        "cli_path": record["path"] if record else "not installed",
        "cli_version": record["version"] if record else "n/a",
        "hostname": normalize_hostname(),
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "transport_requirement": requirement,
    }


def build_environment_key(environment: dict[str, str]) -> str:
    return "|".join(
        [
            environment["cli"],
            environment["hostname"],
            environment["system"],
            environment["release"],
            environment["machine"],
            environment["transport_requirement"],
        ]
    )


def load_discovery_cache(path: Path) -> dict:
    payload = load_json_file(path)
    if not isinstance(payload, dict):
        return {"version": DISCOVERY_CACHE_VERSION, "entries": []}
    entries = payload.get("entries")
    if not isinstance(entries, list):
        payload["entries"] = []
    payload.setdefault("version", DISCOVERY_CACHE_VERSION)
    return payload


def resolve_discovery_cache_read_path(path: Path) -> Path:
    if path.exists():
        return path
    default_cache = Path(DEFAULT_DISCOVERY_CACHE_PATH)
    legacy_cache = LEGACY_SMOKE_TEST_DIR / "last-known-good.json"
    if path.resolve() == default_cache.resolve() and legacy_cache.exists():
        return legacy_cache
    return path


def save_discovery_cache(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def resolve_cache_artifact_path(value: str | None) -> Path | None:
    if not value:
        return None
    candidate = Path(str(value))
    if candidate.is_absolute():
        return candidate
    if candidate.parts[:1] == (WORKSPACE_ROOT.name,):
        return (WORKSPACE_ROOT.parent / candidate).resolve()
    host_candidate = (HOST_ROOT / candidate).resolve()
    if host_candidate.exists():
        return host_candidate
    return (REPO_ROOT / candidate).resolve()


def normalize_environment_key(key: str) -> str:
    parts = key.split("|")
    # Cache validity is about whether the same host/OS/machine/transport can
    # reach the same model. CLI patch versions drift frequently and are kept as
    # diagnostics in the environment record, but they should not invalidate a
    # proven model ID by themselves.
    if len(parts) >= 7:
        parts = [parts[0], *parts[2:]]
    if len(parts) >= 2:
        for suffix in (".local", ".lan"):
            if parts[1].endswith(suffix):
                parts[1] = parts[1][: -len(suffix)]
    return "|".join(parts)


def find_cached_discovery(
    cache: dict,
    environment_key: str,
    requested_model: str | None,
    requested_hint: str | None,
) -> dict | None:
    entries = cache.get("entries", [])
    if not isinstance(entries, list):
        return None

    normalized_key = normalize_environment_key(environment_key)
    exact_match: dict | None = None
    hint_match: dict | None = None
    exact_requested = is_exact_model_identifier(requested_model)
    for entry in reversed(entries):
        if not isinstance(entry, dict):
            continue
        entry_key = normalize_environment_key(entry.get("environment_key", ""))
        if entry_key != normalized_key:
            continue
        artifact_path = resolve_cache_artifact_path(entry.get("artifact_path"))
        if not artifact_path or not artifact_path.exists():
            continue
        if requested_model and entry.get("requested_model") == requested_model:
            exact_match = entry
            break
        if requested_model and entry.get("winner_model") == requested_model:
            exact_match = entry
            break
        if exact_requested:
            continue
        if requested_hint and entry.get("requested_model_hint") == requested_hint:
            hint_match = entry
    return exact_match or hint_match


def extract_response(case_name: str, stdout: str) -> str:
    stripped = stdout.strip()
    if not stripped:
        return ""

    try:
        if case_name == "claude_json":
            payload = json.loads(stripped)
            return str(payload.get("result", ""))
        if case_name == "gemini_json":
            payload = json.loads(stripped)
            return str(payload.get("response", ""))
        if case_name == "agy_text":
            return stripped
        if case_name == "codex_json":
            messages: List[str] = []
            for line in stripped.splitlines():
                obj = json.loads(line)
                if obj.get("type") == "item.completed":
                    item = obj.get("item", {})
                    if item.get("type") == "agent_message":
                        messages.append(str(item.get("text", "")))
            return "\n".join(part for part in messages if part)
    except Exception:
        return stripped

    return stripped


def snippet(text: str, limit: int = 160) -> str:
    compact = text.replace("\n", "\\n")
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def resolve_model_plan(
    args: argparse.Namespace,
    discovery: dict[str, object] | None,
    cli_versions: list[dict[str, str]],
) -> dict[str, dict[str, object]]:
    installed = {record["cli"] for record in cli_versions if record["path"] != "not installed"}
    codex_config = load_saved_codex_config()
    plan: dict[str, dict[str, object]] = {}

    if "claude" in installed:
        saved_claude_model = load_saved_claude_model()
        saved_claude_is_exact = is_exact_model_identifier(saved_claude_model)
        memory_map_claude = load_saved_claude_model_from_memory_map()
        claude_requested = args.claude_model
        claude_source = "unknown"
        claude_resolved = (
            claude_requested
            or (memory_map_claude.get("model") if memory_map_claude else None)
            or (saved_claude_model if saved_claude_is_exact else None)
            or saved_claude_model
        )
        claude_note = ""
        if claude_requested:
            claude_source = "per_run_override"
            claude_note = "explicit --claude-model"
        elif memory_map_claude:
            claude_source = memory_map_claude["source"]
            claude_note = memory_map_claude["note"]
            if saved_claude_is_exact:
                claude_note += f"; home fallback {saved_claude_model!r} from ~/.claude/settings.json"
        elif saved_claude_is_exact:
            claude_source = "local_default"
            claude_note = "from ~/.claude/settings.json"
        elif saved_claude_model:
            claude_source = "local_default_alias"
            claude_note = (
                f"alias {saved_claude_model!r} from ~/.claude/settings.json; "
                "no exact ID found in memory map"
            )
        if discovery and discovery.get("winner"):
            winner = discovery["winner"]
            if isinstance(winner, dict):
                claude_resolved = winner.get("model") or claude_resolved
                claude_source = str(winner.get("source") or "smoke_test_discovery")
                claude_note = f"discovery requirement={discovery.get('requirement', 'json')}"
        plan["claude"] = {
            "cli": "claude",
            "requested_model": claude_requested or "",
            "resolved_model": claude_resolved or "",
            "selection_source": claude_source,
            "command_model": (
                claude_requested
                or (memory_map_claude.get("model") if memory_map_claude else "")
                or (saved_claude_model if saved_claude_is_exact else None)
                or saved_claude_model
                or ""
            ),
            "note": claude_note,
        }

    if "gemini" in installed:
        gemini_saved_model = load_saved_gemini_model()
        memory_map_gemini = load_saved_peer_model_from_memory_map("gemini")
        gemini_requested = args.gemini_model
        gemini_source = "unknown"
        gemini_resolved = (
            gemini_requested
            or (memory_map_gemini.get("model") if memory_map_gemini else None)
            or gemini_saved_model
        )
        gemini_note = ""
        if gemini_requested:
            gemini_source = "per_run_override"
            gemini_note = "explicit --gemini-model"
        elif memory_map_gemini:
            gemini_source = memory_map_gemini["source"]
            gemini_note = memory_map_gemini["note"]
            if gemini_saved_model:
                gemini_note += f"; home fallback {gemini_saved_model!r} from ~/.gemini/settings.json"
        elif gemini_saved_model:
            gemini_source = "local_default"
            gemini_note = "from ~/.gemini/settings.json"
        plan["gemini"] = {
            "cli": "gemini",
            "requested_model": gemini_requested or "",
            "resolved_model": gemini_resolved or "",
            "selection_source": gemini_source,
            "command_model": gemini_resolved or "",
            "note": gemini_note,
        }

    if "codex" in installed:
        codex_requested = args.codex_model
        codex_saved_model = codex_config.get("model", "")
        memory_map_codex = load_saved_peer_model_from_memory_map("codex")
        codex_source = "unknown"
        codex_resolved = (
            codex_requested
            or (memory_map_codex.get("model") if memory_map_codex else None)
            or codex_saved_model
        )
        codex_note = ""
        if codex_requested:
            codex_source = "per_run_override"
            codex_note = "explicit --codex-model"
        elif memory_map_codex:
            codex_source = memory_map_codex["source"]
            codex_note = memory_map_codex["note"]
            if codex_saved_model:
                codex_note += (
                    f"; home fallback {codex_saved_model!r} "
                    f"from {codex_config.get('config_path', '~/.codex/config.toml')}"
                )
        elif codex_saved_model:
            codex_source = "local_default"
            codex_note = f"from {codex_config.get('config_path', '~/.codex/config.toml')}"
        reasoning = codex_config.get("reasoning_effort")
        if reasoning:
            codex_note = f"{codex_note}; reasoning={reasoning}" if codex_note else f"reasoning={reasoning}"
        plan["codex"] = {
            "cli": "codex",
            "requested_model": codex_requested or "",
            "resolved_model": codex_resolved or "",
            "selection_source": codex_source,
            "command_model": codex_resolved or "",
            "note": codex_note,
        }

    if "agy" in installed:
        agy_requested = args.agy_model  # None when user did not pass --agy-model
        agy_resolved = agy_requested or DEFAULT_AGY_MODEL
        plan["agy"] = {
            "cli": "agy",
            "requested_model": agy_requested or "",
            "resolved_model": agy_resolved,
            "selection_source": "per_run_override" if agy_requested else "default",
            "command_model": agy_resolved,
            "note": f"agy replaces gemini CLI; run from {args.agy_cd} to avoid AGENTS.md pickup",
        }

    return plan


def build_cases(
    args: argparse.Namespace,
    model_plan: dict[str, dict[str, object]],
) -> list[tuple[str, list[str], str | None]]:
    prompt = args.prompt
    cases: list[tuple[str, list[str], str | None]] = []

    if not args.skip_claude and command_exists("claude"):
        claude_base = ["claude"]
        claude_model = str(model_plan.get("claude", {}).get("command_model", "")).strip()
        if claude_model:
            claude_base += ["--model", claude_model]
        cases.append(("claude_text", claude_base + ["-p", prompt], None))
        cases.append(
            ("claude_json", claude_base + ["-p", "--output-format", "json", prompt], None)
        )

    include_gemini = getattr(args, "include_legacy_gemini", False) or not args.skip_gemini
    if include_gemini and command_exists("gemini"):
        gemini_base = ["gemini"]
        gemini_model = str(model_plan.get("gemini", {}).get("command_model", "")).strip()
        if gemini_model:
            gemini_base += ["-m", gemini_model]
        cases.append(("gemini_text", gemini_base + ["-p", prompt], None))
        cases.append(("gemini_json", gemini_base + ["-o", "json", "-p", prompt], None))

    if not args.skip_codex and command_exists("codex"):
        codex_base = ["codex", "exec", "--json"]
        codex_model = str(model_plan.get("codex", {}).get("command_model", "")).strip()
        if codex_model:
            codex_base += ["-m", codex_model]
        codex_base += ["--cd", args.codex_cd, "--skip-git-repo-check"]
        cases.append(("codex_json", codex_base + [prompt], None))

    if not args.skip_agy and command_exists("agy"):
        agy_model = str(model_plan.get("agy", {}).get("command_model", DEFAULT_AGY_MODEL)).strip()
        # cwd isolates agy from the repo so it doesn't load AGENTS.md
        cases.append(("agy_text", ["agy", "--model", agy_model, "--print", prompt], args.agy_cd))

    return cases


def probe_cli_versions() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for cli in ("claude", "gemini", "codex", "agy"):
        path = shutil.which(cli)
        if not path:
            records.append({"cli": cli, "path": "not installed", "version": "n/a"})
            continue
        try:
            completed = subprocess.run(
                [cli, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            version_text = ensure_text(completed.stdout or completed.stderr).strip() or "unknown"
        except subprocess.TimeoutExpired:
            version_text = "timeout"
        records.append(
            {
                "cli": cli,
                "path": path,
                "version": snippet(version_text, limit=120),
            }
        )
    return records


def run_case(
    case_name: str,
    command: list[str],
    timeout_seconds: int,
    cwd: str | None = None,
) -> dict[str, object]:
    start = time.time()
    status = "ok"
    rc = 0
    stdout = ""
    stderr = ""

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=cwd,
        )
        rc = completed.returncode
        stdout = ensure_text(completed.stdout)
        stderr = ensure_text(completed.stderr)
        if rc != 0:
            status = "failed"
    except FileNotFoundError as exc:
        status = "unavailable"
        rc = 127
        stderr = ensure_text(exc)
    except subprocess.TimeoutExpired as exc:
        status = "timeout"
        rc = -1
        stdout = ensure_text(exc.stdout)
        stderr = ensure_text(exc.stderr)

    duration = round(time.time() - start, 1)
    parsed = extract_response(case_name, stdout)

    return {
        "case": case_name,
        "status": status,
        "rc": rc,
        "duration_s": duration,
        "stdout_len": len(stdout),
        "stderr_len": len(stderr),
        "stdout_is_jsonish": is_jsonish(stdout),
        "parsed_has_end_marker": END_MARKER in parsed,
        "command": command,
        "parsed_snippet": snippet(parsed),
        "stdout_snippet": snippet(stdout),
        "stderr_snippet": snippet(stderr),
        "stdout_raw": stdout,
        "stderr_raw": stderr,
    }


def slim_case_result(result: dict[str, object]) -> dict[str, object]:
    return {
        "case": result["case"],
        "status": result["status"],
        "rc": result["rc"],
        "duration_s": result["duration_s"],
        "stdout_len": result["stdout_len"],
        "stderr_len": result["stderr_len"],
        "stdout_is_jsonish": result["stdout_is_jsonish"],
        "parsed_has_end_marker": result["parsed_has_end_marker"],
        "command": result["command"],
        "parsed_snippet": result["parsed_snippet"],
        "stdout_snippet": result["stdout_snippet"],
        "stderr_snippet": result["stderr_snippet"],
    }


def build_skipped_case_result(case_name: str) -> dict[str, object]:
    return {
        "case": case_name,
        "status": "skipped",
        "rc": 0,
        "duration_s": 0.0,
        "stdout_len": 0,
        "stderr_len": 0,
        "stdout_is_jsonish": False,
        "parsed_has_end_marker": False,
        "command": [],
        "parsed_snippet": "",
        "stdout_snippet": "",
        "stderr_snippet": "",
        "stdout_raw": "",
        "stderr_raw": "",
    }


def append_candidate(
    queue: list[str],
    sources: dict[str, str],
    seen: set[str],
    value: str | None,
    source: str,
) -> None:
    if not value:
        return
    normalized = value.strip()
    if not normalized or normalized in seen:
        return
    queue.append(normalized)
    sources[normalized] = source
    seen.add(normalized)


def append_family_candidates(
    queue: list[str],
    sources: dict[str, str],
    seen: set[str],
    ladders: dict,
    cli: str,
    family: str | None,
    source: str,
) -> None:
    if not family:
        return
    cli_ladders = ladders.get(cli, {})
    families = cli_ladders.get("families", {})
    candidates = families.get(family, [])
    if not isinstance(candidates, list):
        return
    for candidate in candidates:
        append_candidate(queue, sources, seen, str(candidate), f"{source}:{family}")


def append_remaining_family_candidates(
    queue: list[str],
    sources: dict[str, str],
    seen: set[str],
    ladders: dict,
    cli: str,
    exclude_families: set[str],
    source: str,
) -> None:
    cli_ladders = ladders.get(cli, {})
    family_order = cli_ladders.get("default_family_order", [])
    if not isinstance(family_order, list):
        return
    for family in family_order:
        family_name = str(family)
        if family_name in exclude_families:
            continue
        append_family_candidates(queue, sources, seen, ladders, cli, family_name, source)


def run_claude_discovery_with_environment(
    args: argparse.Namespace,
    cli_versions: list[dict[str, str]],
) -> dict[str, object]:
    ladders = load_model_candidate_ladders()
    saved_model = load_saved_claude_model()
    requested_hint = normalize_model_hint(args.claude_model)
    requested_family = extract_claude_family(args.claude_model)
    saved_family = extract_claude_family(saved_model)
    cache_path = Path(args.discovery_cache_path)
    cache_read_path = resolve_discovery_cache_read_path(cache_path)
    cache = load_discovery_cache(cache_read_path)
    environment = build_claude_environment(cli_versions, args.claude_require)
    environment_key = build_environment_key(environment)
    cache_entry = find_cached_discovery(cache, environment_key, args.claude_model, requested_hint)
    if cache_entry:
        winner_model = cache_entry.get("winner_model")
        return {
            "enabled": True,
            "requirement": args.claude_require,
            "saved_claude_model": saved_model,
            "requested_claude_model": args.claude_model,
            "requested_model_hint": requested_hint,
            "candidate_order": [],
            "winner": {
                "model": winner_model,
                "source": "discovery_cache",
                "json_ok": cache_entry.get("json_ok", False),
                "text_ok": cache_entry.get("text_ok", False),
                "requirement": args.claude_require,
            },
            "attempts": [],
            "cache_hit": True,
            "cache_entry": cache_entry,
            "cache_path": str(cache_read_path),
            "cache_write_path": str(cache_path),
            "environment": environment,
            "environment_key": environment_key,
        }

    queue: list[str] = []
    sources: dict[str, str] = {}
    seen: set[str] = set()
    used_families: set[str] = set()

    for candidate in args.claude_candidate:
        append_candidate(queue, sources, seen, candidate, "manual_candidate")
    append_candidate(queue, sources, seen, args.claude_model, "requested_model")
    append_family_candidates(
        queue, sources, seen, ladders, "claude", requested_family, "requested_family_ladder"
    )
    if requested_family:
        used_families.add(requested_family)
    append_candidate(queue, sources, seen, saved_model, "saved_claude_settings")
    append_family_candidates(
        queue, sources, seen, ladders, "claude", saved_family, "saved_family_ladder"
    )
    if saved_family:
        used_families.add(saved_family)
    append_remaining_family_candidates(
        queue, sources, seen, ladders, "claude", used_families, "fallback_family_ladder"
    )

    attempts: list[dict[str, object]] = []
    winner: dict[str, object] | None = None

    idx = 0
    while idx < len(queue):
        candidate = queue[idx]
        idx += 1

        json_result = run_case(
            "claude_json",
            ["claude", "--model", candidate, "-p", "--output-format", "json", args.prompt],
            args.case_timeout,
        )
        if args.claude_require == "both":
            text_result = run_case(
                "claude_text",
                ["claude", "--model", candidate, "-p", args.prompt],
                args.case_timeout,
            )
        else:
            text_result = build_skipped_case_result("claude_text")

        suggestions: list[str] = []
        raw_streams = [
            ensure_text(json_result["stdout_raw"]),
            ensure_text(json_result["stderr_raw"]),
        ]
        if args.claude_require == "both":
            raw_streams.extend(
                [
                    ensure_text(text_result["stdout_raw"]),
                    ensure_text(text_result["stderr_raw"]),
                ]
            )
        for raw in raw_streams:
            suggestion = extract_model_suggestion(raw)
            if suggestion and suggestion not in suggestions:
                suggestions.append(suggestion)
                append_candidate(queue, sources, seen, suggestion, f"suggested_by:{candidate}")

        json_ok = bool(
            json_result["status"] == "ok" and json_result["parsed_has_end_marker"]
        )
        text_ok = bool(
            text_result["status"] == "ok" and text_result["parsed_has_end_marker"]
        )
        success = json_ok if args.claude_require == "json" else json_ok and text_ok

        attempt = {
            "candidate": candidate,
            "candidate_source": sources.get(candidate, "unknown"),
            "success": success,
            "requirement": args.claude_require,
            "json_ok": json_ok,
            "text_ok": text_ok,
            "suggested_models": suggestions,
            "json_case": slim_case_result(json_result),
            "text_case": slim_case_result(text_result),
        }
        attempts.append(attempt)

        if success:
            winner = {
                "model": candidate,
                "source": sources.get(candidate, "unknown"),
                "json_ok": json_ok,
                "text_ok": text_ok,
                "requirement": args.claude_require,
            }
            break

    return {
        "enabled": True,
        "requirement": args.claude_require,
        "saved_claude_model": saved_model,
        "requested_claude_model": args.claude_model,
        "requested_model_hint": requested_hint,
        "requested_family": requested_family,
        "saved_family": saved_family,
        "candidate_order": queue,
        "winner": winner,
        "attempts": attempts,
        "cache_hit": False,
        "cache_entry": None,
        "cache_path": str(cache_read_path),
        "cache_write_path": str(cache_path),
        "candidate_ladder_path": str(MODEL_CANDIDATE_LADDERS_PATH),
        "environment": environment,
        "environment_key": environment_key,
    }


def render_report(
    results: list[dict[str, object]],
    args: argparse.Namespace,
    cli_versions: list[dict[str, str]],
    discovery: dict[str, object] | None,
    model_plan: dict[str, dict[str, object]],
) -> str:
    lines = [
        "# Swarm Consensus CLI Smoke Test",
        "",
        f"- Generated at: `{datetime.now(timezone.utc).isoformat()}`",
        f"- Host: `{normalize_hostname()}`",
        f"- Working directory: `{os.getcwd()}`",
        f"- Prompt: `{args.prompt}`",
        f"- Case timeout: `{args.case_timeout}s`",
        f"- Codex --cd: `{args.codex_cd}`",
        f"- agy --cd: `{args.agy_cd}`",
        "",
        "## CLI Versions",
        "",
        "| CLI | Path | Version |",
        "|---|---|---|",
    ]
    for record in cli_versions:
        lines.append(f"| `{record['cli']}` | `{record['path']}` | `{record['version']}` |")

    if model_plan:
        lines += [
            "",
            "## Model Resolution",
            "",
            "| CLI | Requested | Resolved | Selection Source | Note |",
            "|---|---|---|---|---|",
        ]
        for cli in ("claude", "gemini", "codex", "agy"):
            item = model_plan.get(cli)
            if not item:
                continue
            lines.append(
                f"| `{cli}` | `{item.get('requested_model') or 'n/a'}` | "
                f"`{item.get('resolved_model') or 'unknown'}` | "
                f"`{item.get('selection_source') or 'unknown'}` | "
                f"`{item.get('note') or 'n/a'}` |"
            )

    lines += [
        "",
        "| Case | Status | RC | Dur (s) | JSON-ish stdout | Parsed end marker | stdout | stderr |",
        "|---|---|---|---:|---|---|---:|---:|",
    ]
    for result in results:
        lines.append(
            f"| `{result['case']}` | `{result['status']}` | `{result['rc']}` | "
            f"{result['duration_s']} | `{result['stdout_is_jsonish']}` | "
            f"`{result['parsed_has_end_marker']}` | {result['stdout_len']} | {result['stderr_len']} |"
        )

    lines.append("")

    if discovery:
        winner = discovery.get("winner")
        lines += [
            "## Claude Discovery",
            "",
            f"- Requirement: `{discovery['requirement']}`",
            f"- Saved Claude model: `{discovery['saved_claude_model'] or 'none'}`",
            f"- Requested Claude model: `{discovery['requested_claude_model'] or 'none'}`",
            f"- Requested Claude family: `{discovery.get('requested_family') or 'none'}`",
            f"- Saved Claude family: `{discovery.get('saved_family') or 'none'}`",
            f"- Cache hit: `{discovery.get('cache_hit', False)}`",
            f"- Cache path: `{discovery.get('cache_path', 'n/a')}`",
            f"- Candidate ladder: `{discovery.get('candidate_ladder_path', 'n/a')}`",
            f"- Winning model: `{winner['model'] if winner else 'none'}`",
            f"- Winning source: `{winner['source'] if winner else 'n/a'}`",
            "",
            "| Candidate | Source | Success | JSON OK | Text OK | Suggested Models |",
            "|---|---|---|---|---|---|",
        ]
        if discovery["attempts"]:
            for attempt in discovery["attempts"]:
                suggested = ", ".join(attempt["suggested_models"]) if attempt["suggested_models"] else "none"
                lines.append(
                    f"| `{attempt['candidate']}` | `{attempt['candidate_source']}` | "
                    f"`{attempt['success']}` | `{attempt['json_ok']}` | `{attempt['text_ok']}` | `{suggested}` |"
                )
        else:
            lines.append("| `n/a` | `cache_hit` | `True` | `n/a` | `n/a` | `none` |")
        lines.append("")

    for result in results:
        lines.append(f"## {result['case']}")
        lines.append(f"- Command: `{ ' '.join(result['command']) }`")
        lines.append(f"- Parsed snippet: `{result['parsed_snippet']}`")
        lines.append(f"- stdout snippet: `{result['stdout_snippet']}`")
        if result["stderr_len"]:
            lines.append(f"- stderr snippet: `{result['stderr_snippet']}`")
        lines.append("")

    return "\n".join(lines)


def render_json_report(
    results: list[dict[str, object]],
    args: argparse.Namespace,
    cli_versions: list[dict[str, str]],
    discovery: dict[str, object] | None,
    model_plan: dict[str, dict[str, object]],
) -> str:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "host": normalize_hostname(),
        "working_directory": os.getcwd(),
        "prompt": args.prompt,
        "case_timeout_seconds": args.case_timeout,
        "codex_cd": args.codex_cd,
        "agy_cd": args.agy_cd,
        "cli_versions": cli_versions,
        "model_resolution": model_plan,
        "results": [slim_case_result(result) for result in results],
        "discovery": discovery,
    }
    return json.dumps(payload, indent=2)


def save_report(report: str, artifacts_dir: str, suffix: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    path = Path(artifacts_dir)
    path.mkdir(parents=True, exist_ok=True)
    target = path / f"{stamp}-cli-smoke-test{suffix}"
    target.write_text(report + "\n", encoding="utf-8")
    return target


def persist_claude_discovery(
    discovery: dict[str, object],
    cli_versions: list[dict[str, str]],
    args: argparse.Namespace,
    model_plan: dict[str, dict[str, object]],
) -> dict[str, str] | None:
    if not discovery or not discovery.get("enabled"):
        return None
    cache_write_path = Path(str(discovery.get("cache_write_path", args.discovery_cache_path)))

    if discovery.get("cache_hit"):
        cache_entry = discovery.get("cache_entry")
        if isinstance(cache_entry, dict):
            resolved_artifact_path = resolve_cache_artifact_path(cache_entry.get("artifact_path"))
            cache_read_path = Path(str(discovery.get("cache_path", args.discovery_cache_path)))
            if resolved_artifact_path and cache_read_path.exists():
                cache = load_discovery_cache(cache_read_path)
                changed = False
                for entry in cache.get("entries", []):
                    if not isinstance(entry, dict):
                        continue
                    if (
                        normalize_environment_key(entry.get("environment_key", ""))
                        == normalize_environment_key(cache_entry.get("environment_key", ""))
                        and entry.get("requested_model") == cache_entry.get("requested_model")
                        and entry.get("artifact_path") != str(resolved_artifact_path)
                    ):
                        entry["artifact_path"] = str(resolved_artifact_path)
                        changed = True
                if changed:
                    cache["updated_at"] = datetime.now(timezone.utc).isoformat()
                    save_discovery_cache(cache_write_path, cache)
                    write_cache_snapshot(cache_write_path, cache)
                elif cache_read_path != cache_write_path:
                    save_discovery_cache(cache_write_path, cache)
                    write_cache_snapshot(cache_write_path, cache)
            return {
                "artifact_path": str(resolved_artifact_path or ""),
                "cache_path": str(cache_write_path),
            }
        return {"artifact_path": "", "cache_path": str(cache_write_path)}

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    artifacts_dir = Path(args.artifacts_dir)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifacts_dir / f"{timestamp}-claude-discovery.md"

    markdown_report = render_report([], args, cli_versions, discovery, model_plan)
    artifact_path.write_text(markdown_report + "\n", encoding="utf-8")

    cache = load_discovery_cache(cache_write_path)
    environment = discovery.get("environment", {})
    environment_key = str(discovery.get("environment_key", ""))
    winner = discovery.get("winner")
    if isinstance(winner, dict) and winner.get("model"):
        new_entry = {
            "validated_at": datetime.now(timezone.utc).isoformat(),
            "environment_key": environment_key,
            "environment": environment,
            "requested_model": discovery.get("requested_claude_model"),
            "requested_model_hint": discovery.get("requested_model_hint"),
            "winner_model": winner.get("model"),
            "winner_source": "smoke_test_discovery",
            "json_ok": winner.get("json_ok"),
            "text_ok": winner.get("text_ok"),
            "artifact_path": str(artifact_path.resolve()),
        }
        entries = [
            entry
            for entry in cache.get("entries", [])
            if not (
                isinstance(entry, dict)
                and normalize_environment_key(entry.get("environment_key", ""))
                == normalize_environment_key(environment_key)
                and entry.get("requested_model") == discovery.get("requested_claude_model")
            )
        ]
        entries.append(new_entry)
        cache["entries"] = entries
        cache["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_discovery_cache(cache_write_path, cache)
        write_cache_snapshot(cache_write_path, cache)

    return {
        "artifact_path": str(artifact_path),
        "cache_path": str(cache_write_path),
    }


def write_cache_snapshot(cache_path: Path, payload: dict) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    history_dir = cache_path.parent / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = history_dir / f"{timestamp}-last-known-good.json"
    snapshot_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return snapshot_path


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    discovery: dict[str, object] | None = None

    cli_versions = probe_cli_versions()
    if args.discover_claude:
        discovery = run_claude_discovery_with_environment(args, cli_versions)
    model_plan = resolve_model_plan(args, discovery, cli_versions)
    if args.model_plan_only:
        if args.output_format == "json":
            report = render_json_report([], args, cli_versions, discovery, model_plan)
        else:
            report = render_report([], args, cli_versions, discovery, model_plan)
        print(report)
        return 0

    if args.discover_claude:
        persistence = persist_claude_discovery(discovery, cli_versions, args, model_plan)
        if persistence:
            discovery["persistence"] = persistence
    cases = build_cases(args, model_plan)
    if args.discover_claude:
        cases = [case for case in cases if not case[0].startswith("claude_")]  # case[0] is name

    if not cases and not args.discover_claude:
        print("No runnable cases found. Install at least one of: claude, agy, codex.", file=sys.stderr)
        return 1

    results = [run_case(name, command, args.case_timeout, cwd) for name, command, cwd in cases]
    if args.output_format == "json":
        report = render_json_report(results, args, cli_versions, discovery, model_plan)
        suffix = ".json"
    else:
        report = render_report(results, args, cli_versions, discovery, model_plan)
        suffix = ".md"
    print(report)

    if args.save_artifact:
        target = save_report(report, args.artifacts_dir, suffix)
        print(f"Saved artifact: {target}")

    if discovery and discovery.get("winner"):
        return 0
    if any(result["parsed_has_end_marker"] for result in results):
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
