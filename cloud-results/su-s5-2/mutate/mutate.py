#!/usr/bin/env python3
"""T0 mutation loop (T-SQLREPO section 5): apply one one-line mutation to SRC, run TEST, expect RED on the named test,
restore SRC from HEAD with git show. Usage: mutate.py SRC TEST rows.json   (rows: [{name, test, old, new, all?}])"""
import json, subprocess, sys
src, test, rows = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
HEAD = subprocess.run(["git", "show", f"HEAD:{src}"], capture_output=True, text=True, check=True).stdout
CMD = ("export PATH=$HOME/.local/node24/bin:$PATH; TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx "
       "--import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks " + test)
bad = 0
for r in rows:
    n = HEAD.count(r["old"])
    if n < 1 or (n > 1 and not r.get("all")):
        print(f"SKIP {r['name']}: old text occurs {n} times"); bad += 1; continue
    open(src, "w").write(HEAD.replace(r["old"], r["new"]))
    try:
        p = subprocess.run(["bash", "-c", CMD], capture_output=True, text=True)
    finally:
        open(src, "w").write(HEAD)
    out = p.stdout + p.stderr
    if p.returncode == 0: print(f"NOT CHARACTERIZED: {r['name']}"); bad += 1
    elif r["test"] not in out or ("✖ " + r["test"]) not in out: print(f"RED FOR ANOTHER REASON: {r['name']}"); bad += 1
    else: print(f"RED ok: {r['name']} -> {r['test']}")
print("rows", len(rows), "bad", bad)
sys.exit(1 if bad else 0)
