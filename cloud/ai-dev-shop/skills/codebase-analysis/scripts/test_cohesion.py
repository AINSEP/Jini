#!/usr/bin/env python3
"""Executable proof for every counting rule in cohesion.py.

A metric script that has never been run against a known answer is a number
generator, not a measurement. Each test below fixes one rule from the cohesion
section of ../references/cohesion-and-api-surface.md.

The negative controls are load-bearing. LCOM4's known failure modes are all
over-counting: a constructor that links everything, a static helper that links
nothing, a nested class whose `self` is a different object.

Run:  python3 -m pytest skills/codebase-analysis/scripts/ -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from cohesion import (  # noqa: E402
    analyse_classes,
    analyse_modules,
    connected_groups,
    main,
    parse_classes,
)

SCRIPT = Path(__file__).parent / "cohesion.py"


def build_tree(root: Path, files: dict[str, str]) -> None:
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def one_class(source: str, include_constructor: bool = False):
    units = parse_classes(source, "m.py", include_constructor)
    assert len(units) == 1
    return units[0]


# -------------------------------------------------------------------- graph


def test_connected_groups_returns_singletons_when_there_are_no_edges() -> None:
    assert connected_groups(["a", "b"], set()) == [["a"], ["b"]]


def test_connected_groups_merges_transitively() -> None:
    groups = connected_groups(["a", "b", "c"], {("a", "b"), ("b", "c")})
    assert groups == [["a", "b", "c"]]


def test_connected_groups_orders_largest_first() -> None:
    groups = connected_groups(["a", "b", "c"], {("b", "c")})
    assert groups == [["b", "c"], ["a"]]


def test_connected_groups_ignores_edges_to_unknown_nodes() -> None:
    assert connected_groups(["a"], {("a", "ghost")}) == [["a"]]


# ---------------------------------------------------------------- class LCOM4


def test_two_methods_sharing_a_field_are_one_group() -> None:
    unit = one_class(
        "class C:\n"
        "    def read(self): return self.value\n"
        "    def write(self, v): self.value = v\n"
    )
    assert unit.lcom4 == 1
    assert unit.fields == {"value"}


def test_two_methods_sharing_nothing_are_two_groups() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): return self.left\n"
        "    def b(self): return self.right\n"
    )
    assert unit.lcom4 == 2
    assert unit.groups == [["a"], ["b"]]


def test_a_call_links_two_methods() -> None:
    # The callee never references its own name, so a shared-reference rule alone
    # cannot see this edge.
    unit = one_class(
        "class C:\n"
        "    def outer(self): return self.inner()\n"
        "    def inner(self): return 1\n"
    )
    assert unit.lcom4 == 1


def test_two_methods_calling_the_same_helper_are_linked() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): return self.helper()\n"
        "    def b(self): return self.helper()\n"
        "    def helper(self): return 1\n"
    )
    assert unit.lcom4 == 1


def test_three_independent_pairs_are_three_groups() -> None:
    unit = one_class(
        "class C:\n"
        "    def a1(self): return self.a\n"
        "    def a2(self): self.a = 1\n"
        "    def b1(self): return self.b\n"
        "    def b2(self): self.b = 1\n"
        "    def c1(self): return self.c\n"
        "    def c2(self): self.c = 1\n"
    )
    assert unit.lcom4 == 3
    assert unit.groups == [["a1", "a2"], ["b1", "b2"], ["c1", "c2"]]


def test_receiver_is_the_first_parameter_not_the_word_self() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(this): return this.value\n"
        "    def b(this): this.value = 1\n"
    )
    assert unit.lcom4 == 1


def test_a_local_variable_named_like_the_receiver_elsewhere_is_not_counted() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): other = Thing(); return other.value\n"
        "    def b(self): other = Thing(); return other.value\n"
    )
    # Both touch `other.value`, neither touches `self`. They share nothing.
    assert unit.lcom4 == 2
    assert unit.fields == set()


# --------------------------------------------------------- negative controls


def test_constructor_is_excluded_by_default() -> None:
    source = (
        "class C:\n"
        "    def __init__(self):\n"
        "        self.left = 1\n"
        "        self.right = 2\n"
        "    def a(self): return self.left\n"
        "    def b(self): return self.right\n"
    )
    assert one_class(source).lcom4 == 2
    assert one_class(source).skipped_constructor == 1


def test_including_the_constructor_collapses_the_score() -> None:
    # This is the documented naive reading: __init__ touches every field, so it
    # links every method through itself and almost nothing scores above 1.
    source = (
        "class C:\n"
        "    def __init__(self):\n"
        "        self.left = 1\n"
        "        self.right = 2\n"
        "    def a(self): return self.left\n"
        "    def b(self): return self.right\n"
    )
    assert one_class(source, include_constructor=True).lcom4 == 1


def test_static_methods_are_excluded() -> None:
    unit = one_class(
        "class C:\n"
        "    @staticmethod\n"
        "    def helper(): return 1\n"
        "    def a(self): return self.value\n"
        "    def b(self): self.value = 1\n"
    )
    assert unit.lcom4 == 1
    assert unit.skipped_static == 1


def test_a_method_with_no_parameters_is_excluded() -> None:
    unit = one_class(
        "class C:\n"
        "    def broken(): return 1\n"
        "    def a(self): return self.value\n"
        "    def b(self): self.value = 1\n"
    )
    assert unit.lcom4 == 1
    assert unit.skipped_static == 1


def test_a_nested_class_has_its_own_self() -> None:
    # `Inner.run` touching `self.value` is a different object's field. Counting
    # it would link two methods that never touch the same state.
    unit = parse_classes(
        "class C:\n"
        "    def a(self):\n"
        "        class Inner:\n"
        "            def run(self): return self.value\n"
        "        return Inner\n"
        "    def b(self): return self.value\n",
        "m.py",
        False,
    )[0]
    assert unit.name == "C"
    assert unit.lcom4 == 2


def test_a_closure_inside_a_method_still_counts_as_that_method() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner(): return self.value\n"
        "        return inner\n"
        "    def b(self): self.value = 1\n"
    )
    assert unit.lcom4 == 1


def test_a_closure_that_shadows_the_receiver_does_not_link_methods() -> None:
    # REGRESSION. Closures were walked without any binding analysis, so a nested
    # function whose own parameter is also named `self` had its attribute reads
    # attributed to the enclosing method. That invented an edge and merged two
    # genuinely independent groups into a falsely cohesive class.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner(self): return self.shared\n"
        "        return inner\n"
        "    def b(self): return self.shared\n"
    )
    assert unit.lcom4 == 2
    assert unit.groups == [["a"], ["b"]]


def test_a_lambda_that_shadows_the_receiver_does_not_link_methods() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): return lambda self: self.shared\n"
        "    def b(self): return self.shared\n"
    )
    assert unit.lcom4 == 2


def test_a_closure_that_rebinds_the_receiver_by_assignment_is_shadowed() -> None:
    # REGRESSION. Shadow detection examined PARAMETERS only, so a closure that
    # rebound the receiver in its own body (`self = c`) still had its reads
    # attributed to the enclosing method.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner(c):\n"
        "            self = c\n"
        "            return self.shared\n"
        "        return inner\n"
        "    def b(self): return self.shared\n"
    )
    assert unit.lcom4 == 2


def test_a_closure_that_rebinds_the_receiver_by_import_alias_is_shadowed() -> None:
    # REGRESSION. Body-level shadow detection walked ASSIGNMENT TARGETS only.
    # `import … as self` binds an ordinary local but carries its name on the
    # alias, so the closure's reads were still credited to `a` — inventing an
    # edge to `b` and reporting 1 for a class that is really two things.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner():\n"
        "            import collections as self\n"
        "            return self.import_alias_probe\n"
        "        return inner\n"
        "    def b(self): return self.import_alias_probe\n"
    )
    assert unit.lcom4 == 2
    assert unit.groups == [["a"], ["b"]]


def test_a_closure_that_rebinds_the_receiver_by_except_target_is_shadowed() -> None:
    # REGRESSION. Same blind spot: `except … as self` binds the name on the
    # handler node, not on a target.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner(payload):\n"
        "            try:\n"
        "                payload()\n"
        "            except ValueError as self:\n"
        "                return self.except_target_probe\n"
        "        return inner\n"
        "    def b(self): return self.except_target_probe\n"
    )
    assert unit.lcom4 == 2
    assert unit.groups == [["a"], ["b"]]


def test_a_closure_that_rebinds_the_receiver_by_match_capture_is_shadowed() -> None:
    # REGRESSION. Same blind spot: a capture pattern binds the name on the
    # pattern node. `as`, a bare capture and a mapping rest all bind.
    for pattern, probe in (
        ("case list() as self:", "match_capture_probe"),
        ("case self:", "match_bare_probe"),
        ("case {'k': 1, **self}:", "match_rest_probe"),
    ):
        unit = one_class(
            "class C:\n"
            "    def a(self):\n"
            "        def inner(payload):\n"
            "            match payload:\n"
            f"                {pattern}\n"
            f"                    return self.{probe}\n"
            "        return inner\n"
            f"    def b(self): return self.{probe}\n"
        )
        assert unit.lcom4 == 2, pattern
        assert unit.groups == [["a"], ["b"]], pattern


def test_a_nested_parameter_default_reads_the_enclosing_receiver() -> None:
    # REGRESSION. A nested callable's defaults are evaluated where it is
    # WRITTEN, before its own parameters exist. Marking the whole definition
    # shadowed lost `self.shared` here and split one cohesive class in two.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        def inner(value=self.shared, self=None): return value\n"
        "        return inner\n"
        "    def b(self): return self.shared\n"
    )
    assert unit.lcom4 == 1


def test_a_lambda_default_reads_the_enclosing_receiver() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): return lambda v=self.shared: v\n"
        "    def b(self): return self.shared\n"
    )
    assert unit.lcom4 == 1


def test_shadowing_only_applies_inside_the_shadowing_scope() -> None:
    # `a` touches self.outer directly AND contains a shadowing closure. The
    # direct reference must still count; only the closure's is excluded.
    unit = one_class(
        "class C:\n"
        "    def a(self):\n"
        "        value = self.outer\n"
        "        def inner(self): return self.hidden\n"
        "        return value, inner\n"
        "    def b(self): return self.outer\n"
        "    def c(self): return self.hidden\n"
    )
    assert unit.groups == [["a", "b"], ["c"]]


def test_a_class_with_one_method_is_not_scored() -> None:
    assert one_class("class C:\n    def a(self): return 1\n").lcom4 is None


def test_a_dataclass_with_no_methods_is_not_scored() -> None:
    unit = one_class("class C:\n    x: int = 1\n")
    assert unit.lcom4 is None


def test_syntax_error_yields_no_classes() -> None:
    assert parse_classes("class C(:\n", "m.py", False) == []


def test_method_names_are_not_counted_as_fields() -> None:
    unit = one_class(
        "class C:\n"
        "    def a(self): return self.helper()\n"
        "    def b(self): return self.helper()\n"
        "    def helper(self): return 1\n"
    )
    assert unit.fields == set()
    assert "no shared fields" in unit.notes


# ------------------------------------------------------------ module cohesion


def test_module_with_no_internal_imports_splits(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/__init__.py": "",
            "pkg/a.py": "VALUE = 1\n",
            "pkg/b.py": "OTHER = 2\n",
        },
    )
    modules = {module.name: module for module in analyse_modules(tmp_path, 0, False, frozenset())}
    assert modules["pkg"].components == 3
    assert modules["pkg"].linkage == pytest.approx(1 / 3)


def test_module_whose_files_import_each_other_is_one_group(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/__init__.py": "from pkg.a import VALUE\nfrom pkg.b import OTHER\n",
            "pkg/a.py": "VALUE = 1\n",
            "pkg/b.py": "from pkg.a import VALUE\nOTHER = VALUE\n",
        },
    )
    modules = {module.name: module for module in analyse_modules(tmp_path, 0, False, frozenset())}
    assert modules["pkg"].components == 1
    assert modules["pkg"].linkage == pytest.approx(1.0)


def test_cross_module_imports_do_not_link_a_module_internally(tmp_path: Path) -> None:
    # `pkg` importing `other` says nothing about whether pkg's own files belong
    # together. Counting it would make every well-connected consumer look cohesive.
    build_tree(
        tmp_path,
        {
            "pkg/a.py": "from other.c import THING\n",
            "pkg/b.py": "from other.c import THING\n",
            "other/c.py": "THING = 1\n",
        },
    )
    modules = {module.name: module for module in analyse_modules(tmp_path, 0, False, frozenset())}
    assert modules["pkg"].components == 2


def test_single_file_module_is_not_scored(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "VALUE = 1\n"})
    modules = {module.name: module for module in analyse_modules(tmp_path, 0, False, frozenset())}
    assert modules["pkg"].components is None


def test_tests_are_excluded_by_default(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": "VALUE = 1\n",
            "pkg/test_a.py": "from pkg.a import VALUE\n",
        },
    )
    modules = {module.name: module for module in analyse_modules(tmp_path, 0, False, frozenset())}
    assert modules["pkg"].components is None
    with_tests = {
        module.name: module for module in analyse_modules(tmp_path, 0, True, frozenset())
    }
    assert with_tests["pkg"].components == 1


def test_unreadable_files_are_disclosed_not_silently_skipped(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # REGRESSION. A parse failure was skipped in silence, so "no classes here"
    # and "this file could not be read" produced identical output.
    build_tree(
        tmp_path,
        {
            "pkg/good.py": "class C:\n    def a(self): return self.x\n    def b(self): self.x=1\n",
            "pkg/bad.py": "class Broken(:\n",
        },
    )
    unreadable: list[str] = []
    units = analyse_classes(tmp_path, False, frozenset(), False, unreadable)
    assert [unit.name for unit in units] == ["C"]
    assert unreadable == ["pkg/bad.py"]

    assert main([str(tmp_path), "--scope", "classes"]) == 0
    assert "could not be parsed" in capsys.readouterr().out


def test_json_records_totals_so_truncation_is_detectable(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": (
                "class One:\n    def a(self): return self.l\n    def b(self): return self.r\n"
                "class Two:\n    def a(self): return self.l\n    def b(self): return self.r\n"
            )
        },
    )
    assert main([str(tmp_path), "--json", "--scope", "classes", "--top", "1"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["run"]["classes"] == 2
    assert payload["run"]["classes_shown"] == 1
    assert payload["run"]["truncated"] is True


def test_class_scan_skips_excluded_directories(tmp_path: Path) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": "class Real:\n    def a(self): return self.x\n    def b(self): self.x=1\n",
            "node_modules/z/b.py": "class Vendor:\n    def a(self): return 1\n",
        },
    )
    units = analyse_classes(tmp_path, False, frozenset(), False)
    assert [unit.name for unit in units] == ["Real"]


# ------------------------------------------------------------------------ cli


def test_cli_json_shape(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": (
                "class Split:\n"
                "    def a(self): return self.left\n"
                "    def b(self): return self.right\n"
            ),
            "pkg/b.py": "VALUE = 1\n",
        },
    )
    assert main([str(tmp_path), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["convention"]["constructor_excluded"] is True
    assert payload["classes"][0]["name"] == "Split"
    assert payload["classes"][0]["lcom4"] == 2
    assert payload["classes"][0]["groups"] == [["a"], ["b"]]
    assert payload["modules"][0]["name"] == "pkg"
    assert payload["modules"][0]["components"] == 2


def test_cli_scope_limits_what_is_computed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # TWO files, so the module is scoreable. With one file it was filtered from
    # scored output anyway, and the test passed whether or not --scope did
    # anything at all.
    build_tree(
        tmp_path,
        {
            "pkg/a.py": "class C:\n    def a(self): return self.x\n    def b(self): self.x=1\n",
            "pkg/b.py": "VALUE = 1\n",
        },
    )
    assert main([str(tmp_path), "--json", "--scope", "classes"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["modules"] == []
    assert payload["run"]["modules"] == 0

    assert main([str(tmp_path), "--json", "--scope", "modules"]) == 0
    both = json.loads(capsys.readouterr().out)
    assert both["modules"] and both["classes"] == []


def test_cli_top_truncates_rows_but_the_summary_covers_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    build_tree(
        tmp_path,
        {
            "pkg/a.py": (
                "class One:\n"
                "    def a(self): return self.l\n"
                "    def b(self): return self.r\n"
                "class Two:\n"
                "    def a(self): return self.l\n"
                "    def b(self): return self.r\n"
            ),
        },
    )
    assert main([str(tmp_path), "--scope", "classes", "--top", "1"]) == 0
    out = capsys.readouterr().out
    assert "2 scored class(es), 2 with LCOM4 >= 2" in out


def test_cli_rejects_a_non_directory(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        main([str(tmp_path / "nope")])


def test_cli_always_exits_zero(tmp_path: Path) -> None:
    build_tree(tmp_path, {"pkg/a.py": "class C:\n    def a(self): return 1\n"})
    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
