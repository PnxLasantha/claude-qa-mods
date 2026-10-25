#!/usr/bin/env python3
"""
Group test failures by root-cause signature.

Reads a Robot Framework output.xml or a Playwright JSON report (reporter
"json") and prints JSON:
  {"source", "kind", "total", "failed", "clusters": [
     {"signature", "keyword", "message", "count", "tests": [...]}, ...]}

Stdlib only, streams the XML, so a large output.xml is fine.
Usage: triage.py <report-path>
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

MAX_TESTS_PER_CLUSTER = 50

_SUBS = [
    (re.compile(r"\x1b\[[0-9;]*m"), ""),                                  # ANSI colours
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "<uuid>"),
    (re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b"), "<ts>"),
    (re.compile(r"\b0x[0-9a-f]+\b", re.I), "<hex>"),
    (re.compile(r"\b[0-9a-f]{12,}\b", re.I), "<hex>"),
    (re.compile(r"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b"), "<ip>"),
    (re.compile(r"(?:[A-Za-z]:)?(?:[\\/][\w.\-]+){2,}"), "<path>"),
    (re.compile(r"'[^']{0,200}'"), "'<s>'"),
    (re.compile(r'"[^"]{0,200}"'), '"<s>"'),
    (re.compile(r"\d+(\.\d+)?"), "<n>"),
    (re.compile(r"\s+"), " "),
]


def signature(message: str) -> str:
    lines = [l for l in (message or "").strip().splitlines() if l.strip()]
    if not lines:
        return "<no message>"
    s = lines[0]
    # Playwright/Jest expect(): first line is generic ("expect(received).toBe(expected)");
    # the Expected line tells causes apart.
    if s.lstrip().startswith(("expect(", "Error: expect(")):
        exp = next((l for l in lines[1:] if l.strip().startswith(("Expected", "Locator"))), "")
        s = f"{s.strip()} | {exp.strip()}"
    for rx, rep in _SUBS:
        s = rx.sub(rep, s)
    return s.strip()[:200]


def _first_line(message: str) -> str:
    lines = (message or "").strip().splitlines()
    return lines[0][:300] if lines else ""


# ---------------------------------------------------------------- Robot
def _status(el):
    st = el.find("status")
    return st.get("status") if st is not None else None


def _failure_path(test_el):
    """Follow the FAILED branch from the test down to the deepest failing keyword.

    Takes the LAST failed child at each level: earlier failures inside
    'Run Keyword And Ignore Error' / TRY-EXCEPT / retries were swallowed,
    the last one is what failed the test. Works for RF 4-7 (kw, for, iter,
    if, branch, try, while, group nest the same way).
    """
    names = []
    node = test_el
    while True:
        failed = [c for c in node if c.tag != "status" and _status(c) == "FAIL"]
        if not failed:
            break
        node = failed[-1]
        if node.tag in ("kw", "keyword"):
            lib = node.get("library") or node.get("owner")
            n = node.get("name", "")
            names.append(f"{lib}.{n}" if lib else n)
    # keep the most informative tail: your keyword plus the one that raised
    return " › ".join(names[-2:])


def robot_failures(path):
    suite_stack = []
    total = 0
    failures = []
    for event, el in ET.iterparse(path, events=("start", "end")):
        tag = el.tag
        if event == "start":
            if tag == "suite":
                suite_stack.append(el.get("name", ""))
            continue
        if tag == "test":
            status = _status(el)
            if status in ("PASS", "FAIL", "SKIP", "NOT RUN"):
                total += 1
            if status == "FAIL":
                st = el.find("status")
                full = ".".join(suite_stack + [el.get("name", "")])
                failures.append((full, st.text or st.get("message") or "", _failure_path(el)))
            el.clear()   # bounded memory: one test's subtree at a time
        elif tag == "suite":
            suite_stack.pop()
        elif tag == "statistics":
            break
    return total, failures


# ---------------------------------------------------------------- Playwright
def playwright_failures(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    total = 0
    failures = []

    def walk(suite, titles):
        nonlocal total
        t = titles + ([suite.get("title")] if suite.get("title") else [])
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                total += 1
                status = test.get("status")  # expected | unexpected | flaky | skipped
                if status != "unexpected":
                    continue
                results = test.get("results", [])
                last = results[-1] if results else {}
                err = last.get("error") or (last.get("errors") or [{}])[0] or {}
                msg = err.get("message") or err.get("value") or ""
                proj = test.get("projectName") or ""
                name = " › ".join([x for x in t + [spec.get("title", "")] if x])
                if proj:
                    name = f"[{proj}] {name}"
                loc = err.get("location") or {}
                where = f"{loc.get('file', '')}:{loc.get('line', '')}" if loc else ""
                failures.append((name, msg, where))
        for child in suite.get("suites", []):
            walk(child, t)

    for s in data.get("suites", []):
        walk(s, [])
    return total, failures


def cluster(failures, by_keyword=True):
    """by_keyword: Robot's failing keyword is part of the cause. Playwright's
    'keyword' is a file:line location, which differs per test, so it is shown
    (first seen) but not used to split clusters."""
    groups = {}
    for test, message, keyword in failures:
        key = (signature(message), keyword if (keyword and by_keyword) else "")
        g = groups.setdefault(key, {"signature": key[0], "keyword": keyword or "",
                                    "message": _first_line(message), "count": 0, "tests": []})
        g["count"] += 1
        if len(g["tests"]) < MAX_TESTS_PER_CLUSTER:
            g["tests"].append(test)
    return sorted(groups.values(), key=lambda g: (-g["count"], g["signature"]))


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: triage.py <output.xml | playwright.json>"}))
        return 2
    path = sys.argv[1]
    try:
        with open(path, "rb") as f:
            head = f.read(512).lstrip()
        if head.startswith(b"<"):
            kind = "robot"
            total, failures = robot_failures(path)
        else:
            kind = "playwright"
            total, failures = playwright_failures(path)
    except FileNotFoundError:
        print(json.dumps({"error": f"not found: {path}"}))
        return 1
    except (ET.ParseError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"could not parse {path}: {e} (still being written?)"}))
        return 1
    clusters = cluster(failures, by_keyword=(kind == "robot"))
    print(json.dumps({"source": path, "kind": kind, "total": total,
                      "failed": len(failures), "clusters": clusters}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
