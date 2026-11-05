#!/usr/bin/env python3
"""Executable proof for every counting rule in main_sequence.py.

A metric script that has never been run against a known answer is a number
generator, not a measurement. Each test below fixes one rule from the counting
rules in ../references/component-coupling-metrics.md.

The negative controls are load-bearing: the cheap way to get this wrong is to
count things that should not count — an external package in Ce, a component's
own files in Ce, a local module that merely shares a name with an installed
distribution.

Run:  python3 -m pytest skills/codebase-analysis/scripts/ -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import main_sequence  # noqa: E402
from main_sequence import analyse, main  # noqa: E402

SCRIPT = Path(__file__).parent / "main_sequence.py"


def build_tree(root: Path, files: dict[str, str]) -> None:
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def run(root: Path, *, depth: int = 0, include_tests: bool = False, source_roots=None):
    return analyse(
        root=root,
        depth=depth,
        include_tests=include_tests,
        extra_excludes=frozenset(),
        source_roots=source_roots or frozenset(),
    )


# ---------------------------------------------------------------- Ca / Ce / I


def test_ca_counts_distinct_dependent_components(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "core/__init__.py": "",
            "core/thing.py": "VALUE = 1\n",
            "web/view.py": "from core.thing import VALUE\n",
            "cli/cmd.py": "from core.thing import VALUE\n",
        },
    )
    components = run(tmp_path).components
    assert components["core"].ca == 2
    assert components["core"].ce == 0
    assert components["core"].instability == 0.0


def test_ce_counts_components_not_import_statements(tmp_path: Path) -> None:
    """Three imports of one component are Ce=1. Ce is a component count."""
    build_tree(
        tmp_path,
        {
            "core/a.py": "A = 1\n",
            "core/b.py": "B = 2\n",
            "core/c.py": "C = 3\n",
            "web/view.py": "from core.a import A\nfrom core.b import B\nfrom core.c import C\n",
        },
    )
    components = run(tmp_path).components
    assert components["web"].ce == 1
    assert components["web"].instability == 1.0


def test_mutual_dependency_gives_both_instability_one_half(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "alpha/mod.py": "import beta.mod\n",
            "beta/mod.py": "import alpha.mod\n",
        },
    )
    components = run(tmp_path).components
    assert (components["alpha"].ca, components["alpha"].ce) == (1, 1)
    assert components["alpha"].instability == 0.5
    assert components["beta"].instability == 0.5


def test_intra_component_imports_are_not_coupling(tmp_path: Path) -> None:
    """Negative control: a component depending on itself is not Ce."""
    build_tree(
        tmp_path,
        {
            "core/a.py": "from core.b import B\n",
            "core/b.py": "B = 1\n",
        },
    )
    components = run(tmp_path).components
    assert components["core"].ce == 0
    assert components["core"].ca == 0
    assert components["core"].isolated is True


def test_external_packages_are_not_counted_in_ce(tmp_path: Path) -> None:
    """Negative control: stdlib and third-party imports must not inflate Ce."""
    build_tree(
        tmp_path,
        {
            "core/a.py": "import os\nimport json\nimport requests\nfrom django.db import models\n",
            "web/v.py": "from core.a import x\n",
        },
    )
    components = run(tmp_path).components
    assert components["core"].ce == 0
    assert components["core"].ca == 1


# ------------------------------------------------------------------ resolution


def test_relative_imports_resolve_across_components(tmp_path: Path) -> None:
    """Two packages each own a `model.py`, so the dotted-suffix fallback cannot
    resolve `..domain.model` on its own — only correct `level` handling picks
    the right one. Without the collision this passes even if every line of
    relative-import handling is deleted."""
    build_tree(
        tmp_path,
        {
            "one/__init__.py": "",
            "one/domain/__init__.py": "",
            "one/domain/model.py": "VALUE = 1\n",
            "one/service/__init__.py": "",
            "one/service/use_case.py": "from ..domain.model import VALUE\n",
            "two/__init__.py": "",
            "two/domain/__init__.py": "",
            "two/domain/model.py": "VALUE = 2\n",
        },
    )
    components = run(tmp_path).components
    assert components["one/service"].ce == 1
    assert components["one/domain"].ca == 1
    assert components["two/domain"].ca == 0


def test_single_dot_relative_import_resolves_within_the_package(tmp_path: Path) -> None:
    """`from .sub.mod import X` is level 1 — the file's own package, not its
    parent. A decoy `sub/mod.py` sits one level up, so an off-by-one resolves to
    the wrong component and deleting relative handling resolves to nothing;
    asserting a positive edge on the correct target rejects both."""
    build_tree(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/sub/__init__.py": "",
            "pkg/sub/mod.py": "VALUE = 'decoy'\n",
            "pkg/inner/__init__.py": "",
            "pkg/inner/sub/__init__.py": "",
            "pkg/inner/sub/mod.py": "VALUE = 'correct'\n",
            "pkg/inner/user.py": "from .sub.mod import VALUE\n",
        },
    )
    components = run(tmp_path).components
    assert components["pkg/inner"].ce == 1
    assert components["pkg/inner/sub"].ca == 1
    assert components["pkg/sub"].ca == 0


def test_import_root_below_repo_root_still_resolves(tmp_path: Path) -> None:
    """`from pkg.mod import x` resolves when `pkg` sits under `src/`."""
    build_tree(
        tmp_path,
        {
            "src/pkg/__init__.py": "",
            "src/pkg/mod.py": "VALUE = 1\n",
            "src/app/__init__.py": "",
            "src/app/main.py": "from pkg.mod import VALUE\n",
        },
    )
    components = run(tmp_path).components
    assert components["src/app"].ce == 1
    assert components["src/pkg"].ca == 1


def test_deep_suffix_registration_resolves_a_mid_tree_import_root(tmp_path: Path) -> None:
    """`src/domain/orders/model.py` is importable as `orders.model` when
    `src/domain` is the root. Only the third suffix covers that, so without this
    the index could stop after two and the suite would stay green."""
    build_tree(
        tmp_path,
        {
            "src/domain/orders/model.py": "VALUE = 1\n",
            "consumer/use.py": "from orders.model import VALUE\n",
        },
    )
    components = run(tmp_path).components
    assert components["consumer"].ce == 1
    assert components["src/domain/orders"].ca == 1


def test_relative_import_beyond_the_top_level_package_resolves_to_nothing(
    tmp_path: Path,
) -> None:
    """`from .... import x` inside a two-deep package is an ImportError in
    Python, not a reference to the root. Truncating the climb let it wrap back
    into the tree and invent an edge."""
    build_tree(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/sub/__init__.py": "",
            "pkg/sub/user.py": "from .... import target\n",
            "target/__init__.py": "",
            "target/mod.py": "VALUE = 1\n",
        },
    )
    components = run(tmp_path).components
    assert components["pkg/sub"].ce == 0
    assert components["pkg"].ca == 0
    assert components["target"].ca == 0


def test_one_ambiguous_statement_is_counted_once(tmp_path: Path) -> None:
    """`from shared.mod import VALUE` registers two specifiers internally, both
    of which land on the same ambiguous module. The run reports one ambiguity,
    not two."""
    build_tree(
        tmp_path,
        {
            "alpha/shared/mod.py": "VALUE = 1\n",
            "beta/shared/mod.py": "VALUE = 2\n",
            "app/main.py": "from shared.mod import VALUE\n",
        },
    )
    assert run(tmp_path).ambiguous_imports == 1


def test_local_module_shadowing_a_third_party_name_is_not_internal_coupling(
    tmp_path: Path,
) -> None:
    """`src/pkg/requests.py` cannot be imported as bare `requests` while
    `src/pkg` is a package, so an unrelated `import requests` stays external.
    Registering every path suffix made it internal and fabricated an edge in
    both directions."""
    build_tree(
        tmp_path,
        {
            "src/pkg/__init__.py": "",
            "src/pkg/requests.py": "SESSION = 1\n",
            "app/main.py": "import requests\n",
        },
    )
    components = run(tmp_path).components
    assert components["app"].ce == 0
    assert components["src/pkg"].ca == 0


def test_namespace_layout_module_does_not_absorb_a_third_party_name(tmp_path: Path) -> None:
    """The package-boundary rule cannot see this one — there is no
    `__init__.py` anywhere. A bare one-segment name is registered only from a
    directory that could plausibly be on sys.path, which `services/pkg` is
    not."""
    build_tree(
        tmp_path,
        {
            "services/pkg/requests.py": "SESSION = 1\n",
            "consumer/main.py": "import requests\n",
        },
    )
    components = run(tmp_path).components
    assert components["consumer"].ce == 0
    assert components["services/pkg"].ca == 0


def test_local_module_named_like_stdlib_does_not_absorb_the_stdlib_import(
    tmp_path: Path,
) -> None:
    build_tree(
        tmp_path,
        {
            "compat/json.py": "def loads(text): return text\n",
            "app/main.py": "import json\n",
        },
    )
    components = run(tmp_path).components
    assert components["app"].ce == 0
    assert components["compat"].ca == 0


def test_ambiguous_suffix_is_dropped_and_counted_not_guessed(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "alpha/shared/mod.py": "VALUE = 1\n",
            "beta/shared/mod.py": "VALUE = 2\n",
            "app/main.py": "import shared.mod\n",
        },
    )
    analysis = run(tmp_path)
    assert analysis.ambiguous_imports >= 1
    assert analysis.components["app"].ce == 0
    assert analysis.components["alpha/shared"].ca == 0
    assert analysis.components["beta/shared"].ca == 0


def test_syntax_error_does_not_abort_the_run(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "broken/bad.py": "def (((\n",
            "core/a.py": "class A:\n    pass\n",
        },
    )
    components = run(tmp_path).components
    assert set(components) == {"broken", "core"}
    assert components["broken"].total_types == 0


# ----------------------------------------------------------------- source roots


def test_bare_module_in_a_conventional_source_root_still_resolves(tmp_path: Path) -> None:
    """The mirror of the shadowing rules: `src/helpers.py` IS importable as
    `helpers`, and tightening the bare-name rule must not lose that edge."""
    build_tree(
        tmp_path,
        {
            "src/helpers.py": "VALUE = 1\n",
            "src/app/main.py": "import helpers\n",
        },
    )
    components = run(tmp_path).components
    assert components["src/app"].ce == 1
    assert components["src"].ca == 1


def test_declared_source_root_resolves_a_layout_the_heuristic_cannot_guess(
    tmp_path: Path,
) -> None:
    """`services/worker` is a real sys.path root in plenty of monorepos and
    matches no naming convention or marker. Declaring it states the layout
    instead of leaving it to a guess."""
    build_tree(
        tmp_path,
        {
            "services/worker/shared.py": "VALUE = 1\n",
            "services/worker/client/main.py": "import shared\n",
        },
    )
    assert run(tmp_path).components["services/worker/client"].ce == 0

    declared = run(
        tmp_path, source_roots=frozenset({(tmp_path / "services/worker").resolve()})
    ).components
    assert declared["services/worker/client"].ce == 1
    assert declared["services/worker"].ca == 1


def test_declared_source_root_beats_the_package_directory_rule(tmp_path: Path) -> None:
    """A package directory is not normally an import root, but `--source-root`
    says this one is. Without that precedence, declaring a root carrying an
    `__init__.py` silently did nothing."""
    build_tree(
        tmp_path,
        {
            "services/worker/__init__.py": "",
            "services/worker/client.py": "VALUE = 1\n",
            "consumer/use.py": "import client\n",
        },
    )
    assert run(tmp_path).components["consumer"].ce == 0

    declared = run(
        tmp_path, source_roots=frozenset({(tmp_path / "services/worker").resolve()})
    ).components
    assert declared["consumer"].ce == 1
    assert declared["services/worker"].ca == 1


# ------------------------------------------------------------------- A


def test_python_abstractness_counts_abc_protocol_and_abstractmethod(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "core/types.py": (
                "import abc\n"
                "from abc import ABC, abstractmethod\n"
                "from typing import Protocol\n"
                "\n"
                "class Repo(ABC):\n"
                "    @abstractmethod\n"
                "    def get(self): ...\n"
                "\n"
                "class Clock(Protocol):\n"
                "    def now(self): ...\n"
                "\n"
                "class Legacy(metaclass=abc.ABCMeta):\n"
                "    pass\n"
                "\n"
                "class Impl:\n"
                "    def get(self): return 1\n"
            )
        },
    )
    component = run(tmp_path).components["core"]
    assert component.total_types == 4
    assert component.abstract_types == 3
    assert component.abstractness == pytest.approx(0.75)


def test_python_generic_alone_is_not_abstract(tmp_path: Path) -> None:
    """Negative control: `Generic[T]` is parameterisation, not abstraction."""
    build_tree(
        tmp_path,
        {
            "core/box.py": (
                "from typing import Generic, TypeVar\n"
                "T = TypeVar('T')\n"
                "class Box(Generic[T]):\n"
                "    def __init__(self, value): self.value = value\n"
            )
        },
    )
    component = run(tmp_path).components["core"]
    assert component.total_types == 1
    assert component.abstract_types == 0


def test_component_with_no_classes_reports_abstractness_zero_and_zero_types(
    tmp_path: Path,
) -> None:
    build_tree(
        tmp_path,
        {
            "util/helpers.py": "def add(a, b):\n    return a + b\n",
            "app/main.py": "from util.helpers import add\n",
        },
    )
    component = run(tmp_path).components["util"]
    assert component.total_types == 0
    assert component.abstractness == 0.0
    assert component.notes == "no types"


# ------------------------------------------------------------------ D / zones


def test_distance_is_zero_on_the_main_sequence(tmp_path: Path) -> None:
    """Fully abstract and fully depended upon: A=1, I=0, D=0."""
    build_tree(
        tmp_path,
        {
            "ports/repo.py": (
                "from abc import ABC, abstractmethod\n"
                "class Repo(ABC):\n"
                "    @abstractmethod\n"
                "    def get(self): ...\n"
            ),
            "app/service.py": "from ports.repo import Repo\n",
        },
    )
    ports = run(tmp_path).components["ports"]
    assert ports.abstractness == 1.0
    assert ports.instability == 0.0
    assert ports.distance == 0.0
    assert ports.zone == "near"


def test_zone_of_pain_is_concrete_and_depended_upon(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            "web/a.py": "from core.model import Order\n",
            "cli/b.py": "from core.model import Order\n",
            "jobs/c.py": "from core.model import Order\n",
        },
    )
    core = run(tmp_path).components["core"]
    assert (core.ca, core.ce) == (3, 0)
    assert core.abstractness == 0.0
    assert core.instability == 0.0
    assert core.distance == 1.0
    assert core.zone == "pain"


def test_zone_of_uselessness_is_abstract_and_unused(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "core/thing.py": "class Thing:\n    pass\n",
            "abstractions/iface.py": (
                "from abc import ABC, abstractmethod\n"
                "from core.thing import Thing\n"
                "class Iface(ABC):\n"
                "    @abstractmethod\n"
                "    def go(self): ...\n"
            ),
        },
    )
    component = run(tmp_path).components["abstractions"]
    assert component.abstractness == 1.0
    assert component.instability == 1.0
    assert component.distance == 1.0
    assert component.zone == "uselessness"


def test_isolated_component_reports_instability_zero_and_is_flagged(tmp_path: Path) -> None:
    build_tree(tmp_path, {"lonely/mod.py": "VALUE = 1\n"})
    component = run(tmp_path).components["lonely"]
    assert component.instability == 0.0
    assert component.isolated is True


def test_isolated_component_is_not_classified_as_pain(tmp_path: Path) -> None:
    """A disconnected directory sits at A=0, I=0 arithmetically, but nothing
    depends on it, so it is not the Zone of Pain. Ranking it as pain buried the
    real finding under fixture directories on the first real run."""
    build_tree(
        tmp_path,
        {
            "fixtures/sample/thing.py": "class Thing:\n    pass\n",
            "core/model.py": "class Order:\n    pass\n",
            "web/a.py": "from core.model import Order\n",
        },
    )
    components = run(tmp_path).components
    assert components["fixtures/sample"].zone == "isolated"
    assert components["fixtures/sample"].distance == 1.0  # arithmetic unchanged
    assert components["core"].zone == "pain"


def test_isolated_components_sort_last_and_leave_mean_distance_alone(tmp_path: Path) -> None:
    from main_sequence import render_summary, sort_components

    build_tree(
        tmp_path,
        {
            "fixtures/one/a.py": "class A:\n    pass\n",
            "fixtures/two/b.py": "class B:\n    pass\n",
            "ports/repo.py": (
                "from abc import ABC, abstractmethod\n"
                "class Repo(ABC):\n"
                "    @abstractmethod\n"
                "    def get(self): ...\n"
            ),
            "app/service.py": "from ports.repo import Repo\n",
        },
    )
    analysis = run(tmp_path)
    ordered = sort_components(analysis, "distance")
    # Both sit at D=0; the tiebreak is Ca, so the depended-upon one comes first.
    assert [component.name for component in ordered[:2]] == ["ports", "app"]
    assert all(component.isolated for component in ordered[2:])
    assert "mean D = 0.00 over 2 connected components" in render_summary(analysis, ordered)


@pytest.mark.parametrize(
    ("abstract", "total", "ca", "ce", "expected"),
    [
        (0, 10, 7, 3, "pain"),  # A=0.0, I=0.3 — both exactly on the edge
        (3, 10, 7, 3, "pain"),  # A=0.3, I=0.3 — inclusive edge, still pain
        (4, 10, 6, 4, "near"),  # A=0.4, I=0.4 — D=0.2 exactly, still near
        (4, 10, 9, 1, "drift"),  # A=0.4, I=0.1 — outside pain on the A axis
        (7, 10, 3, 7, "uselessness"),  # A=0.7, I=0.7 — inclusive far edge
        (5, 10, 5, 5, "near"),  # A=0.5, I=0.5 — D=0, on the sequence
        (0, 10, 2, 8, "near"),  # A=0.0, I=0.8 — D=0.2, inclusive band edge
        (0, 10, 3, 7, "drift"),  # A=0.0, I=0.7 — D=0.3
        (0, 10, 5, 5, "drift"),  # A=0.0, I=0.5 — D=0.5, inclusive band edge
        (0, 10, 6, 4, "far"),  # A=0.0, I=0.4 — D=0.6
    ],
)
def test_zone_cut_lines_are_inclusive_at_the_stated_edges(
    abstract: int, total: int, ca: int, ce: int, expected: str
) -> None:
    """The cut lines are this script's own convention, so they are pinned at
    the exact stated values. The corner cases above cannot see a band edge
    moving by 0.1."""
    from main_sequence import Component

    component = Component(
        name="c",
        total_types=total,
        abstract_types=abstract,
        depends_on={str(index) for index in range(ce)},
        depended_on_by={str(index) for index in range(ca)},
    )
    assert component.zone == expected


# ------------------------------------------------------------------- scoping


def test_tests_are_excluded_by_default_and_included_on_request(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            "tests/test_model.py": "from core.model import Order\n",
        },
    )
    assert run(tmp_path).components["core"].ca == 0
    assert "tests" not in run(tmp_path).components
    assert run(tmp_path, include_tests=True).components["core"].ca == 1


def test_depth_collapses_components(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "src/domain/orders/model.py": "class Order:\n    pass\n",
            "src/domain/billing/model.py": "class Invoice:\n    pass\n",
            "src/web/view.py": "from src.domain.orders.model import Order\n",
        },
    )
    assert "src/domain/orders" in run(tmp_path, depth=0).components
    shallow = run(tmp_path, depth=2).components
    assert set(shallow) == {"src/domain", "src/web"}
    assert shallow["src/domain"].ca == 1


# --------------------------------------------------------------- lookup tables
#
# Each table is a list of things the script recognises, and an entry silently
# disappearing is invisible: the run still succeeds and simply sees less.
# Mutation testing showed every one of them was unpinned.
#
# The membership assertions are deliberately hardcoded rather than derived from
# the constant. A test that loops over the table cannot detect the table losing
# an entry; it just iterates one fewer time and passes. Behavioural tests follow
# so the sets are not merely tautological.


def test_only_python_is_analysed() -> None:
    """Python-only on purpose. Supporting TS/JS meant hand-lexing JavaScript,
    which is where every parsing defect in this file's history came from;
    `ast` makes the Python side exact for free."""
    assert main_sequence.SOURCE_EXTENSIONS == frozenset({".py"})


def test_excluded_directory_table_is_complete() -> None:
    assert main_sequence.DEFAULT_EXCLUDED_DIRS == frozenset(
        {
            ".git", ".hg", ".svn", ".venv", "venv", "env", "node_modules",
            "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache",
            "build", "dist", "vendor", "site-packages",
        }
    )


@pytest.mark.parametrize("excluded", sorted(main_sequence.DEFAULT_EXCLUDED_DIRS))
def test_each_excluded_directory_is_actually_skipped(tmp_path: Path, excluded: str) -> None:
    build_tree(
        tmp_path,
        {
            "core/a.py": "VALUE = 1\n",
            f"{excluded}/generated.py": "from core.a import VALUE\n",
        },
    )
    components = run(tmp_path).components
    assert set(components) == {"core"}, excluded
    assert components["core"].ca == 0, excluded


def test_abstract_marker_tables_are_complete() -> None:
    assert main_sequence.ABSTRACT_BASE_NAMES == frozenset(
        {"ABC", "ABCMeta", "Protocol", "Generic"}
    )
    assert main_sequence.ABSTRACT_DECORATOR_NAMES == frozenset(
        {
            "abstractmethod", "abstractproperty",
            "abstractclassmethod", "abstractstaticmethod",
        }
    )


@pytest.mark.parametrize("decorator", sorted(main_sequence.ABSTRACT_DECORATOR_NAMES))
def test_each_abstract_decorator_marks_a_class_abstract(tmp_path: Path, decorator: str) -> None:
    """No ABC base here on purpose: the decorator alone must carry it. The
    original tests always paired a decorator with `ABC`, so the decorator branch
    could be deleted without any test noticing."""
    build_tree(
        tmp_path,
        {
            "core/thing.py": (
                f"from abc import {decorator}\n"
                "class Thing:\n"
                f"    @{decorator}\n"
                "    def go(self): ...\n"
            )
        },
    )
    component = run(tmp_path).components["core"]
    assert (component.total_types, component.abstract_types) == (1, 1), decorator


def test_source_root_tables_are_complete() -> None:
    assert main_sequence.SOURCE_ROOT_NAMES == frozenset(
        {"src", "lib", "app", "source", "python", "server", "backend"}
    )
    assert main_sequence.SOURCE_ROOT_MARKERS == ("pyproject.toml", "setup.py", "setup.cfg")


@pytest.mark.parametrize("root_name", sorted(main_sequence.SOURCE_ROOT_NAMES))
def test_each_conventional_source_root_resolves_bare_names(
    tmp_path: Path, root_name: str
) -> None:
    build_tree(
        tmp_path,
        {
            f"{root_name}/helpers.py": "VALUE = 1\n",
            "consumer/main.py": "import helpers\n",
        },
    )
    assert run(tmp_path).components["consumer"].ce == 1, root_name


@pytest.mark.parametrize("marker", main_sequence.SOURCE_ROOT_MARKERS)
def test_each_project_marker_makes_a_source_root(tmp_path: Path, marker: str) -> None:
    build_tree(
        tmp_path,
        {
            f"packages/core/{marker}": "\n",
            "packages/core/engine.py": "VALUE = 1\n",
            "consumer/main.py": "import engine\n",
        },
    )
    assert run(tmp_path).components["consumer"].ce == 1, marker


def test_test_detection_tables_are_complete() -> None:
    assert main_sequence.TEST_DIR_NAMES == frozenset(
        {"test", "tests", "__tests__", "spec", "e2e", "testing"}
    )
    assert main_sequence.TEST_FILE_RE.pattern == r"(^test_.*|.*_test)\.py$"


@pytest.mark.parametrize("directory", sorted(main_sequence.TEST_DIR_NAMES))
def test_each_test_directory_name_is_excluded_by_default(tmp_path: Path, directory: str) -> None:
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            f"{directory}/check_it.py": "from core.model import Order\n",
        },
    )
    assert run(tmp_path).components["core"].ca == 0, directory
    assert run(tmp_path, include_tests=True).components["core"].ca == 1, directory


@pytest.mark.parametrize("filename", ["test_thing.py", "thing_test.py"])
def test_each_test_filename_pattern_is_excluded_by_default(tmp_path: Path, filename: str) -> None:
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            f"checks/{filename}": "from core.model import Order\n",
        },
    )
    assert run(tmp_path).components["core"].ca == 0, filename


def test_zone_constants_are_pinned() -> None:
    """Uncalibrated conventions. Pinning them means a change is a decision
    someone made, not a drift nobody saw."""
    assert main_sequence.ZONE_EDGE == 0.3
    assert main_sequence.DISTANCE_BANDS == ((0.2, "near"), (0.5, "drift"))


# --------------------------------------------------------------------- cli


def test_cli_emits_json_and_exits_zero(tmp_path: Path, capsys) -> None:
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            "web/view.py": "from core.model import Order\n",
        },
    )
    assert main([str(tmp_path), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    names = {component["name"]: component for component in payload["components"]}
    assert names["core"]["ca"] == 1
    assert names["core"]["zone"] == "pain"
    assert payload["convention"]["zone_edge"] == 0.3


def test_cli_table_and_plot_render_a_connected_component(tmp_path: Path) -> None:
    """The fixture must be *connected*: the plot deliberately skips isolated
    components, so a lone module proves only that the axes render."""
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            "web/view.py": "from core.model import Order\n",
        },
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--plot"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "main sequence" in result.stdout
    assert "#" in result.stdout, "no component was plotted"
    assert "plotted: 2 connected of 2 components" in result.stdout
    # A data row, not just the header — the header alone passed while row
    # rendering was broken.
    rows = [line for line in result.stdout.splitlines() if line.startswith("core ")]
    assert len(rows) == 1, result.stdout
    assert " 1 " in rows[0], rows[0]  # Ca=1


def test_cli_source_root_flag_reaches_resolution(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "services/worker/shared.py": "VALUE = 1\n",
            "services/worker/client/main.py": "import shared\n",
        },
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--json",
         "--source-root", "services/worker"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    names = {component["name"]: component for component in payload["components"]}
    assert names["services/worker/client"]["ce"] == 1


def test_cli_exits_zero_when_a_component_is_in_pain(tmp_path: Path) -> None:
    """This is a diagnostic, not a gate. A bad score must still exit 0."""
    build_tree(
        tmp_path,
        {
            "core/model.py": "class Order:\n    pass\n",
            "web/a.py": "from core.model import Order\nclass View:\n    pass\n",
            "cli/b.py": "from core.model import Order\nclass Cmd:\n    pass\n",
        },
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    zones = {c["name"]: c["zone"] for c in json.loads(result.stdout)["components"]}
    assert zones["core"] == "pain"
    # The dependents are concrete and unstable, which is ON the main sequence —
    # `near` is the correct reading for them, not a missed problem.
    assert zones["web"] == "near"


@pytest.mark.parametrize(
    ("flag", "check"),
    [
        (["--depth", "1"], lambda payload: {c["name"] for c in payload["components"]} == {"src"}),
        # `zzz_core` sorts last by name but first by distance, so this
        # discriminates; the previous fixture was alphabetical either way.
        (["--sort", "name"], lambda payload: [c["name"] for c in payload["components"]][0]
         == "src/aaa_web"),
        (["--top", "1"], lambda payload: len(payload["components"]) == 1),
        (["--exclude", "src"], lambda payload: payload["components"] == []),
        (["--include-tests"], lambda payload: any(
            c["name"] == "tests" for c in payload["components"])),
    ],
)
def test_each_cli_flag_changes_the_output(tmp_path: Path, flag, check) -> None:
    """Every flag exercised through the CLI, not just through `analyse()`. A
    flag can be parsed, stored, and never threaded to the thing it configures."""
    build_tree(
        tmp_path,
        {
            "src/zzz_core/model.py": "class Order:\n    pass\n",
            "src/aaa_web/view.py": "from src.zzz_core.model import Order\n",
            "tests/test_model.py": "from src.zzz_core.model import Order\n",
        },
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--json", *flag],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert check(json.loads(result.stdout)), f"{flag} did not take effect"
