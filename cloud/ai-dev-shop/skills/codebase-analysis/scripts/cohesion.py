#!/usr/bin/env python3
"""Measure cohesion — whether a unit's own pieces belong together.

Coupling asks how a component relates to the rest of the tree. Cohesion asks
whether the component should have been one component at all. Both are needed:
splitting a painful module into two arbitrary halves improves every coupling
number and improves nothing.

Two granularities, one idea. Each builds a graph of a unit's internals and
counts **connected components** — how many independent pieces the unit is
really made of.

    LCOM4   per class    methods linked by a shared `self.X` or a call
    MC      per module   files linked by an import within the same module

A value of 1 means one connected thing. A value of 4 means the unit is four
unrelated things sharing a name, and the split is already drawn for you.

Source: Hitz & Montazeri (1995), the variant Sonar shipped as LCOM4 — chosen
over Chidamber & Kemerer's original because CK's LCOM counts *pairs* and grows
with class size, so it ranks big classes above incohesive ones.

This is a DIAGNOSTIC. It prints numbers and exits 0. It is not a gate, it has no
thresholds anyone has calibrated, and nothing in the harness consumes its
output.

Python only, for the reason given in ../references/cohesion-and-api-surface.md:
`ast` is exact, and a hand-written lexer for another language is where the wrong
numbers come from. Module cohesion reuses main_sequence.py's import resolution
rather than re-deriving it — one home for that rule.

Phase 2 of ../SKILL.md is the caller. Every counting rule is documented in
../references/cohesion-and-api-surface.md and tested in test_cohesion.py.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from api_surface import import_names, match_pattern_names  # noqa: E402
from main_sequence import (  # noqa: E402
    analyse as analyse_imports,
    discover_files,
)

# A constructor assigns every field, which links every method that reads any of
# them. Including it collapses LCOM4 to 1 for almost every class that has one --
# the metric's best-known failure, and the reason this defaults to excluding it.
# `--include-constructor` restores the naive reading for comparison.
CONSTRUCTOR_NAMES = frozenset({"__init__", "__new__", "__post_init__"})

# A static method has no receiver, so it can share nothing and would always be
# its own component -- inflating LCOM4 by the number of static helpers rather
# than by anything about cohesion.
STATIC_DECORATORS = frozenset({"staticmethod"})


@dataclass
class Method:
    name: str
    line: int
    refs: set[str] = field(default_factory=set)


@dataclass
class ClassUnit:
    name: str
    file: str
    line: int
    methods: list[Method] = field(default_factory=list)
    skipped_static: int = 0
    skipped_constructor: int = 0

    @property
    def method_names(self) -> set[str]:
        return {method.name for method in self.methods}

    @property
    def fields(self) -> set[str]:
        names = set()
        for method in self.methods:
            names |= method.refs
        return names - self.method_names

    @property
    def groups(self) -> list[list[str]]:
        return connected_groups(
            [method.name for method in self.methods],
            class_edges(self.methods, self.method_names),
        )

    @property
    def lcom4(self) -> int | None:
        # One method cannot be incohesive, and zero methods is a data holder.
        # Reporting 1 and 0 there would put dataclasses in the results.
        if len(self.methods) < 2:
            return None
        return len(self.groups)

    @property
    def notes(self) -> str:
        flags = []
        if self.skipped_static:
            flags.append(f"{self.skipped_static} static")
        if self.skipped_constructor:
            flags.append("constructor excluded")
        if self.methods and not self.fields:
            # Every link came from calls, not shared state. A namespace of
            # related functions is a legitimate shape; it is not the same
            # evidence as methods agreeing about data.
            flags.append("no shared fields")
        return ", ".join(flags)


@dataclass
class ModuleUnit:
    name: str
    files: list[str] = field(default_factory=list)
    edges: set[tuple[str, str]] = field(default_factory=set)

    @property
    def components(self) -> int | None:
        if len(self.files) < 2:
            return None
        return len(connected_groups(self.files, self.edges))

    @property
    def groups(self) -> list[list[str]]:
        return connected_groups(self.files, self.edges)

    @property
    def linkage(self) -> float:
        """Share of files reachable from the module's largest group."""
        if len(self.files) < 2:
            return 1.0
        largest = max((len(group) for group in self.groups), default=0)
        return largest / len(self.files)


# ------------------------------------------------------------------ graph


def connected_groups(nodes: list[str], edges: set[tuple[str, str]]) -> list[list[str]]:
    """Connected components, as sorted name lists, in a stable order."""
    adjacency: dict[str, set[str]] = {node: set() for node in nodes}
    for left, right in edges:
        if left in adjacency and right in adjacency:
            adjacency[left].add(right)
            adjacency[right].add(left)

    seen: set[str] = set()
    groups: list[list[str]] = []
    for node in nodes:
        if node in seen:
            continue
        stack = [node]
        group: list[str] = []
        seen.add(node)
        while stack:
            current = stack.pop()
            group.append(current)
            for neighbour in adjacency[current]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        groups.append(sorted(group))
    return sorted(groups, key=lambda group: (-len(group), group[0]))


def class_edges(methods: list[Method], method_names: set[str]) -> set[tuple[str, str]]:
    edges: set[tuple[str, str]] = set()
    for index, left in enumerate(methods):
        for right in methods[index + 1 :]:
            if left.refs & right.refs:
                # Shared `self.X`: either the same field, or both calling the
                # same helper. Both are evidence the two belong together.
                edges.add((left.name, right.name))
            elif right.name in left.refs or left.name in right.refs:
                # A call. The callee never references its own name, so the
                # intersection above cannot see this edge.
                edges.add((left.name, right.name))
    return edges


# ------------------------------------------------------------------ parsing


def receiver_name(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str | None:
    """The first parameter, which is what `self.X` is actually spelled here."""
    args = node.args.posonlyargs + node.args.args
    return args[0].arg if args else None


def decorator_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return decorator_name(node.func)
    return ""


def is_static(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(decorator_name(d) in STATIC_DECORATORS for d in node.decorator_list)


def binds_name(node: ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda, name: str) -> bool:
    """Does this nested callable rebind `name` as one of its own parameters?"""
    args = node.args
    parameters = {
        argument.arg
        for argument in args.posonlyargs + args.args + args.kwonlyargs
    }
    if args.vararg:
        parameters.add(args.vararg.arg)
    if args.kwarg:
        parameters.add(args.kwarg.arg)
    return name in parameters


CALLABLE_NODES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def callable_body(node: ast.AST) -> list[ast.AST]:
    """A callable's body as a list. A lambda's body is a single expression."""
    body = getattr(node, "body", [])
    return body if isinstance(body, list) else [body]


def signature_expressions(node: ast.AST) -> list[ast.AST]:
    """Parts of a callable's signature evaluated in the ENCLOSING scope.

    Decorators, parameter defaults and annotations all run where the callable is
    *written*, before its parameters exist. So in
    `def inner(value=self.shared, self=None)` the default reads the outer
    method's receiver, and treating the whole definition as shadowed lost a real
    reference.
    """
    out: list[ast.AST] = list(getattr(node, "decorator_list", []) or [])
    args = node.args
    out.extend(args.defaults)
    out.extend(default for default in args.kw_defaults if default is not None)
    for argument in args.posonlyargs + args.args + args.kwonlyargs:
        if argument.annotation is not None:
            out.append(argument.annotation)
    for argument in (args.vararg, args.kwarg):
        if argument is not None and argument.annotation is not None:
            out.append(argument.annotation)
    if getattr(node, "returns", None) is not None:
        out.append(node.returns)
    return out


def binds_in_body(body: list[ast.AST], name: str) -> bool:
    """Does this scope's own code rebind `name`? Nested scopes are not searched.

    Assignment is the obvious form, but an import alias, an `except … as`
    target and a `match` capture each bind an ordinary local too — and they
    carry the bound name on the node itself rather than on an assignment
    target, so a target walk alone never saw them. Which names those two forms
    bind is api_surface.py's rule; it is imported rather than restated here so
    the two scripts cannot drift apart.
    """

    def targets_of(node: ast.AST) -> list[ast.expr]:
        if isinstance(node, ast.Assign):
            return list(node.targets)
        if isinstance(node, (ast.AugAssign, ast.AnnAssign, ast.For, ast.AsyncFor)):
            return [node.target]
        if isinstance(node, ast.NamedExpr):
            return [node.target]
        if isinstance(node, (ast.With, ast.AsyncWith)):
            return [item.optional_vars for item in node.items if item.optional_vars]
        return []

    def binds(target: ast.expr) -> bool:
        if isinstance(target, ast.Name):
            return target.id == name
        if isinstance(target, (ast.Tuple, ast.List)):
            return any(binds(element) for element in target.elts)
        if isinstance(target, ast.Starred):
            return binds(target.value)
        return False

    def binds_without_a_target(node: ast.AST) -> bool:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return name in import_names(node)
        if isinstance(node, ast.ExceptHandler):
            return node.name == name
        if isinstance(node, ast.match_case):
            return name in match_pattern_names(node.pattern)
        return False

    stack = list(body)
    while stack:
        node = stack.pop()
        if isinstance(node, CALLABLE_NODES + (ast.ClassDef,)):
            continue
        if binds_without_a_target(node):
            return True
        if any(binds(target) for target in targets_of(node)):
            return True
        stack.extend(ast.iter_child_nodes(node))
    return False


def method_references(
    node: ast.FunctionDef | ast.AsyncFunctionDef, receiver: str
) -> set[str]:
    """Every `receiver.X` name read or written inside the method.

    Nested functions are walked: a closure inside a method that touches
    `self.x` is still that method touching `self.x`.

    Three things are NOT the method's own state:

    - **Nested classes.** Their `self` is a different object.
    - **A nested callable that rebinds the receiver**, either as a parameter
      (`def inner(self): …`) or by any local binding in its own body —
      assignment, `import … as self`, `except … as self`, `case … as self`.
      Its `self` is not this method's.
    - Only the callable's **body** is shadowed. Its signature — decorators,
      defaults, annotations — evaluates in the enclosing scope and still counts.
    """
    refs: set[str] = set()

    def visit(current: ast.AST, shadowed: bool) -> None:
        if isinstance(current, ast.ClassDef):
            return
        if isinstance(current, CALLABLE_NODES):
            for expression in signature_expressions(current):
                visit(expression, shadowed)
            body = callable_body(current)
            inner = (
                shadowed
                or binds_name(current, receiver)
                or binds_in_body(body, receiver)
            )
            for statement in body:
                visit(statement, inner)
            return
        if (
            not shadowed
            and isinstance(current, ast.Attribute)
            and isinstance(current.value, ast.Name)
            and current.value.id == receiver
        ):
            refs.add(current.attr)
        for child in ast.iter_child_nodes(current):
            visit(child, shadowed)

    # The method's own signature is evaluated at class-definition time, where the
    # receiver does not exist yet, so only its body is walked.
    for statement in node.body:
        visit(statement, False)
    return refs


def parse_classes(text: str, relative: str, include_constructor: bool) -> list[ClassUnit]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []

    units: list[ClassUnit] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        unit = ClassUnit(name=node.name, file=relative, line=node.lineno)
        for child in node.body:
            if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if is_static(child):
                unit.skipped_static += 1
                continue
            if child.name in CONSTRUCTOR_NAMES and not include_constructor:
                unit.skipped_constructor += 1
                continue
            receiver = receiver_name(child)
            if receiver is None:
                # No parameters at all: cannot reach shared state.
                unit.skipped_static += 1
                continue
            unit.methods.append(
                Method(
                    name=child.name,
                    line=child.lineno,
                    refs=method_references(child, receiver),
                )
            )
        units.append(unit)
    return units


# ----------------------------------------------------------------- analysis


def analyse_classes(
    root: Path,
    include_tests: bool,
    extra_excludes: frozenset[str],
    include_constructor: bool,
    unreadable: list[str] | None = None,
) -> list[ClassUnit]:
    """Class units, appending any file that could not be parsed to `unreadable`.

    A file that fails to parse used to be skipped in silence, which made "this
    module has no classes" and "this module could not be read" identical in the
    output. Every other measurement in this toolkit reports absence rather than
    a zero; this one now does too.
    """
    units: list[ClassUnit] = []
    for path in discover_files(root, include_tests, extra_excludes):
        relative = path.relative_to(root).as_posix()
        try:
            with tokenize.open(path) as handle:
                text = handle.read()
        except (OSError, SyntaxError, UnicodeDecodeError):
            if unreadable is not None:
                unreadable.append(relative)
            continue
        try:
            ast.parse(text)
        except (SyntaxError, ValueError, RecursionError):
            if unreadable is not None:
                unreadable.append(relative)
            continue
        units.extend(parse_classes(text, relative, include_constructor))
    return units


def analyse_modules(
    root: Path,
    depth: int,
    include_tests: bool,
    extra_excludes: frozenset[str],
) -> list[ModuleUnit]:
    """Intra-module file linkage, reusing main_sequence.py's resolver."""
    analysis = analyse_imports(
        root=root,
        depth=depth,
        include_tests=include_tests,
        extra_excludes=extra_excludes,
    )
    by_path = {source.path: source for source in analysis.files}
    modules: dict[str, ModuleUnit] = {}
    for source in analysis.files:
        module = modules.setdefault(source.component, ModuleUnit(name=source.component))
        module.files.append(source.relative)
    for source in analysis.files:
        module = modules[source.component]
        for target in source.resolved:
            other = by_path.get(target)
            if other is None or other.component != source.component:
                continue
            if other.relative == source.relative:
                continue
            module.edges.add((source.relative, other.relative))
    for module in modules.values():
        module.files.sort()
    return sorted(modules.values(), key=lambda module: module.name)


# ------------------------------------------------------------------- output


def sort_classes(units: list[ClassUnit]) -> list[ClassUnit]:
    scored = [unit for unit in units if unit.lcom4 is not None]
    return sorted(
        scored,
        key=lambda unit: (-(unit.lcom4 or 0), -len(unit.methods), unit.file, unit.name),
    )


def sort_modules(units: list[ModuleUnit]) -> list[ModuleUnit]:
    scored = [unit for unit in units if unit.components is not None]
    return sorted(
        scored,
        key=lambda unit: (-(unit.components or 0), unit.linkage, unit.name),
    )


def render_classes(units: list[ClassUnit], limit: int | None) -> str:
    shown = units if limit is None else units[:limit]
    if not shown:
        return "No classes with two or more eligible methods."
    width = max(len(f"{unit.file}:{unit.name}") for unit in shown)
    header = f"{'class'.ljust(width)}  meth  fields  LCOM4  notes"
    lines = [header, "-" * len(header)]
    for unit in shown:
        label = f"{unit.file}:{unit.name}"
        lines.append(
            f"{label.ljust(width)}  {len(unit.methods):4d}  {len(unit.fields):6d}  "
            f"{unit.lcom4:5d}  {unit.notes}".rstrip()
        )
    return "\n".join(lines)


def render_modules(units: list[ModuleUnit], limit: int | None) -> str:
    shown = units if limit is None else units[:limit]
    if not shown:
        return "No modules with two or more files."
    width = max(max(len(unit.name) for unit in shown), 6)
    header = f"{'module'.ljust(width)}  files  groups  linkage"
    lines = [header, "-" * len(header)]
    for unit in shown:
        lines.append(
            f"{unit.name.ljust(width)}  {len(unit.files):5d}  {unit.components:6d}  "
            f"{unit.linkage:7.2f}"
        )
    return "\n".join(lines)


def render_summary(
    classes: list[ClassUnit], modules: list[ModuleUnit], unreadable: list[str]
) -> str:
    split_classes = [unit for unit in classes if (unit.lcom4 or 0) >= 2]
    split_modules = [unit for unit in modules if (unit.components or 0) >= 2]
    lines = [
        f"{len(classes)} scored class(es), {len(split_classes)} with LCOM4 >= 2; "
        f"{len(modules)} scored module(s), {len(split_modules)} in more than one group"
    ]
    if unreadable:
        lines.append(
            f"{len(unreadable)} file(s) could not be parsed or read and contributed "
            "no classes; module group counts including them are upper bounds."
        )
    for unit in split_classes[:3]:
        groups = unit.groups
        shape = " | ".join(", ".join(group) for group in groups[:3])
        lines.append(
            f"  {unit.file}:{unit.name} splits into {len(groups)}: {shape}"
            + ("  …" if len(groups) > 3 else "")
        )
    for unit in split_modules[:3]:
        lines.append(
            f"  {unit.name}: {len(unit.files)} files in {unit.components} groups "
            f"with no import between them"
        )
    if split_classes or split_modules:
        lines.append(
            "  A split is a candidate boundary, not a defect. Delegation-heavy and "
            "protocol classes score high and are often correct as written."
        )
    return "\n".join(lines)


def to_json(
    classes: list[ClassUnit],
    modules: list[ModuleUnit],
    config: dict,
    totals: dict,
    unreadable: list[str],
) -> str:
    return json.dumps(
        {
            "convention": {
                "constructor_excluded": not config["include_constructor"],
                "static_methods_excluded": True,
                "shadowed_receiver_excluded": True,
                "min_methods_scored": 2,
                "min_files_scored": 2,
            },
            "config": config,
            # Lets a consumer tell a complete run from a `--top` slice.
            "run": totals,
            "unreadable_files": sorted(unreadable),
            "classes": [
                {
                    "file": unit.file,
                    "name": unit.name,
                    "line": unit.line,
                    "methods": len(unit.methods),
                    "fields": len(unit.fields),
                    "lcom4": unit.lcom4,
                    "groups": unit.groups,
                    "notes": unit.notes,
                }
                for unit in classes
            ],
            "modules": [
                {
                    "name": unit.name,
                    "files": len(unit.files),
                    "components": unit.components,
                    "linkage": round(unit.linkage, 4),
                    "groups": unit.groups,
                }
                for unit in modules
            ],
        },
        indent=2,
    )


def non_negative(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise argparse.ArgumentTypeError("must be 0 or greater")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cohesion.py",
        description=(
            "Count the independent pieces inside each class (LCOM4) and each "
            "module. Diagnostic only -- always exits 0."
        ),
    )
    parser.add_argument("root", nargs="?", default=".", help="source root (default: .)")
    parser.add_argument(
        "--scope",
        choices=("both", "classes", "modules"),
        default="both",
        help="which granularity to report (default: both)",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=0,
        help="collapse modules to the first N path segments (0 = containing directory)",
    )
    parser.add_argument(
        "--include-constructor",
        action="store_true",
        help=(
            "count __init__ as a method; off by default because a constructor "
            "touches every field and links every method through it"
        ),
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="score test files (off by default)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of tables")
    parser.add_argument(
        "--top",
        type=non_negative,
        default=None,
        help="show only the first N rows per table (0 shows none)",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIR",
        help="additional directory name to skip (repeatable)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")
    root = root.resolve()
    extra_excludes = frozenset(args.exclude)

    classes: list[ClassUnit] = []
    modules: list[ModuleUnit] = []
    unreadable: list[str] = []
    if args.scope in {"both", "classes"}:
        classes = sort_classes(
            analyse_classes(
                root,
                args.include_tests,
                extra_excludes,
                args.include_constructor,
                unreadable,
            )
        )
    if args.scope in {"both", "modules"}:
        modules = sort_modules(
            analyse_modules(root, args.depth, args.include_tests, extra_excludes)
        )

    shown_classes = classes if args.top is None else classes[: args.top]
    shown_modules = modules if args.top is None else modules[: args.top]

    if args.json:
        print(
            to_json(
                shown_classes,
                shown_modules,
                {
                    "root": str(root),
                    "scope": args.scope,
                    "depth": args.depth,
                    "include_constructor": args.include_constructor,
                    "include_tests": args.include_tests,
                    "exclude": sorted(args.exclude),
                },
                {
                    "classes": len(classes),
                    "classes_shown": len(shown_classes),
                    "modules": len(modules),
                    "modules_shown": len(shown_modules),
                    "truncated": len(shown_classes) < len(classes)
                    or len(shown_modules) < len(modules),
                    "unreadable_files": len(unreadable),
                },
                unreadable,
            )
        )
        return 0

    if args.scope in {"both", "classes"}:
        print(render_classes(shown_classes, None))
        print()
    if args.scope in {"both", "modules"}:
        print(render_modules(shown_modules, None))
        print()
    # The summary describes the whole run, not the truncated tables -- a total
    # computed over `--top` rows would silently describe something else.
    print(render_summary(classes, modules, unreadable))
    return 0


if __name__ == "__main__":
    sys.exit(main())
