#!/usr/bin/env python3
"""
Find tests that carry no requirement tag.

Modes:
  --staged      tests touched by what `git commit` would commit (the index)
  --commit-all  tests touched by what `git commit -a` would commit (working tree vs HEAD)
  --repo        every test in the repository (an audit)

Robot Framework (.robot): a test counts as tagged when its own [Tags], or the
file's Test Tags / Force Tags / Default Tags, or any parent __init__.robot's
Test Tags / Force Tags, holds a tag matching --pattern.
Playwright (*.spec.ts/js, *.test.ts/js): the test title, its `tag:` option,
an annotation description, or an enclosing test.describe title/tag.

Prints JSON: {"mode", "checked", "untagged": [{"file", "line", "test"}], "errors": [...]}
Stdlib only; runs git through subprocess.
"""
import argparse
import json
import os
import re
import subprocess
import sys

PW_RX = re.compile(r"\.(spec|test)\.(ts|tsx|js|mjs|cjs)$")


def git(*args, cwd=None, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:300]}")
    return r.stdout


# ------------------------------------------------------------------ sources
class Source:
    """Reads file content from the index (--staged) or the working tree."""

    def __init__(self, root, from_index):
        self.root = root
        self.from_index = from_index

    def read(self, rel):
        if self.from_index:
            r = subprocess.run(["git", "show", f":{rel}"], cwd=self.root, capture_output=True)
            if r.returncode != 0:
                return None
            return r.stdout.decode("utf-8", errors="replace")
        try:
            with open(os.path.join(self.root, rel), encoding="utf-8", errors="replace") as f:
                return f.read()
        except OSError:
            return None


def changed_lines(root, diff_args):
    """{path: set(new-side line numbers touched)} for added/modified files."""
    out = git("diff", *diff_args, "-U0", "--no-color", "--diff-filter=AM", "--no-renames", cwd=root)
    result, current = {}, None
    for line in out.splitlines():
        if line.startswith("+++ "):
            path = line[4:]
            current = None if path == "/dev/null" else path[2:] if path.startswith("b/") else path
            if current is not None:
                result.setdefault(current, set())
        elif line.startswith("@@") and current is not None:
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
            if m:
                start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
                # a pure deletion (count 0) still changed the test it sat in
                result[current].update(range(start, start + max(count, 1)))
    return result


# ------------------------------------------------------------------ robot
SECTION_RX = re.compile(r"^\*+\s*([A-Za-z ]+?)\s*\**\s*$")
SPLIT_RX = re.compile(r"\s{2,}|\t|\s+\|\s+")
FILE_TAG_SETTINGS = ("test tags", "force tags", "default tags")
INIT_TAG_SETTINGS = ("test tags", "force tags")


def _cells(line):
    return [c for c in SPLIT_RX.split(line.strip()) if c and not c.startswith("#")]


def robot_setting_tags(text, names):
    tags, in_settings, collecting = [], False, False
    for raw in text.splitlines():
        m = SECTION_RX.match(raw)
        if m:
            in_settings = m.group(1).strip().lower().startswith("setting")
            collecting = False
            continue
        if not in_settings or not raw.strip() or raw.lstrip().startswith("#"):
            continue
        cells = _cells(raw)
        if not cells:
            continue
        if cells[0] == "..." and collecting:
            tags += cells[1:]
            continue
        collecting = cells[0].lower() in names
        if collecting:
            tags += cells[1:]
    return tags


def robot_tests(text):
    """[(name, start_line, end_line, tags)]"""
    tests, in_tests, cur, collecting = [], False, None, False
    lines = text.splitlines()
    for i, raw in enumerate(lines, start=1):
        m = SECTION_RX.match(raw)
        if m:
            if cur:
                cur[2] = i - 1
                tests.append(cur)
                cur = None
            name = m.group(1).strip().lower()
            in_tests = name.startswith("test case") or name.startswith("task")
            continue
        if not in_tests or not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if not raw[0].isspace():
            if cur:
                cur[2] = i - 1
                tests.append(cur)
            cur = [_cells(raw)[0] if _cells(raw) else raw.strip(), i, i, []]
            collecting = False
            # "Name    [Tags]  x" on one line is legal too
            rest = _cells(raw)[1:]
            if rest and rest[0].lower() == "[tags]":
                cur[3] += rest[1:]
                collecting = True
            continue
        if cur is None:
            continue
        cells = _cells(raw)
        if not cells:
            continue
        if cells[0] == "..." and collecting:
            cur[3] += cells[1:]
        else:
            collecting = cells[0].lower() == "[tags]"
            if collecting:
                cur[3] += cells[1:]
    if cur:
        cur[2] = len(lines)
        tests.append(cur)
    return tests


def init_tags(src, rel):
    """Test Tags / Force Tags from every __init__.robot above (and beside) rel."""
    tags, d = [], os.path.dirname(rel)
    while True:
        for name in ("__init__.robot", "__init__.resource"):
            p = f"{d}/{name}" if d else name
            text = src.read(p)
            if text:
                tags += robot_setting_tags(text, INIT_TAG_SETTINGS)
        if not d:
            break
        d = os.path.dirname(d)
    return tags


# ------------------------------------------------------------------ playwright
PW_TEST_RX = re.compile(
    r"""\b(?:test|it)(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1""")
PW_DESCRIBE_RX = re.compile(
    r"""\b(?:test\.)?describe(?:\.(?:only|skip|fixme|serial|parallel|configure))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1""")
PW_TAG_OPT_RX = re.compile(r"""tag\s*:\s*(\[[^\]]*\]|['"`][^'"`]*['"`])""")
PW_ANNOT_RX = re.compile(r"""description\s*:\s*['"`]([^'"`]+)['"`]""")
STR_RX = re.compile(r"""['"`]([^'"`]+)['"`]""")


def _pw_tags(title, head):
    tags = re.findall(r"@[\w.:\-/]+", title)
    for m in PW_TAG_OPT_RX.finditer(head):
        tags += STR_RX.findall(m.group(1))
    tags += PW_ANNOT_RX.findall(head)
    return [t.lstrip("@") for t in tags]


def _block_end(lines, start_idx):
    """Line index where the brace block opened on/after start_idx closes."""
    depth, opened = 0, False
    for j in range(start_idx, len(lines)):
        for ch in lines[j]:
            if ch == "{":
                depth += 1
                opened = True
            elif ch == "}":
                depth -= 1
                if opened and depth == 0:
                    return j
    return len(lines) - 1


def pw_tests(text):
    lines = text.splitlines()
    describes = []  # (start_idx, end_idx, tags)
    for i, l in enumerate(lines):
        m = PW_DESCRIBE_RX.search(l)
        if m:
            head = "\n".join(lines[i:i + 4])
            describes.append((i, _block_end(lines, i), _pw_tags(m.group(2), head)))
    starts = []
    for i, l in enumerate(lines):
        if PW_DESCRIBE_RX.search(l):
            continue
        m = PW_TEST_RX.search(l)
        if m and not re.search(r"\btest\.(step|use|beforeEach|afterEach|beforeAll|afterAll|extend|info)\b", l):
            starts.append((i, m.group(2)))
    tests = []
    for n, (i, title) in enumerate(starts):
        end = (starts[n + 1][0] - 1) if n + 1 < len(starts) else len(lines) - 1
        head = "\n".join(lines[i:min(i + 6, end + 1)])
        tags = _pw_tags(title, head)
        for (ds, de, dtags) in describes:
            if ds < i <= de:
                tags += dtags
        tests.append([title, i + 1, end + 1, tags])
    return tests


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--staged", action="store_true")
    g.add_argument("--commit-all", action="store_true")
    g.add_argument("--repo", action="store_true")
    ap.add_argument("--pattern", required=True)
    a = ap.parse_args()

    try:
        pattern = re.compile(a.pattern, re.I)
    except re.error as e:
        print(json.dumps({"error": f"bad tag pattern {a.pattern!r}: {e}"}))
        return 2
    try:
        root = git("rev-parse", "--show-toplevel").strip()
    except RuntimeError as e:
        print(json.dumps({"error": f"not a git repository ({e})"}))
        return 1

    if a.repo:
        files = {p: None for p in git("ls-files", cwd=root).splitlines()}
        src = Source(root, from_index=False)
    elif a.staged:
        files = changed_lines(root, ["--cached"])
        src = Source(root, from_index=True)
    else:
        has_head = subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=root,
                                  capture_output=True).returncode == 0
        files = changed_lines(root, ["HEAD"] if has_head else ["--cached"])
        src = Source(root, from_index=False)

    checked, untagged, errors = 0, [], []
    for rel, touched in sorted(files.items()):
        is_robot = rel.endswith(".robot") and not rel.endswith("__init__.robot")
        is_pw = bool(PW_RX.search(rel))
        if not (is_robot or is_pw):
            continue
        text = src.read(rel)
        if text is None:
            errors.append(f"could not read {rel}")
            continue
        if is_robot:
            base = robot_setting_tags(text, FILE_TAG_SETTINGS) + init_tags(src, rel)
            tests = robot_tests(text)
        else:
            base = []
            tests = pw_tests(text)
        lines = text.splitlines()
        for name, start, end, tags in tests:
            # a blank line added after a test does not touch the test
            while end > start and end <= len(lines) and not lines[end - 1].strip():
                end -= 1
            if touched is not None and not any(start <= ln <= end for ln in touched):
                continue
            checked += 1
            if not any(pattern.search(t.strip()) for t in tags + base):
                untagged.append({"file": rel, "line": start, "test": name})

    print(json.dumps({"mode": "repo" if a.repo else "staged" if a.staged else "commit-all",
                      "checked": checked, "untagged": untagged, "errors": errors}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
