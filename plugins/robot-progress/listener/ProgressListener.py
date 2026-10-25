"""
Robot Framework live-progress listener.

Writes two files that update while the run is in progress:
  <name>.json : machine-readable status (for Claude / scripts)
  <name>.txt  : one human-readable status line

Usage:
  robot --listener ProgressListener.py:results/progress.json tests/
  (Windows paths: use ';' as the separator)
  robot --listener "ProgressListener.py;C:\\results\\progress.json" tests\\

Keyword-level tracking ("now running keyword X") requires RF 7+.
On older versions you still get test-level progress.
"""
import json
import os
import threading
import time


def _full_name(obj):
    return getattr(obj, "full_name", None) or getattr(obj, "longname", obj.name)


def _fmt(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"


class ProgressListener:
    ROBOT_LISTENER_API_VERSION = 3

    def __init__(self, path="robot_progress.json", max_failures=20):
        self.json_path = os.path.abspath(path)
        self.txt_path = os.path.splitext(self.json_path)[0] + ".txt"
        os.makedirs(os.path.dirname(self.json_path), exist_ok=True)
        self.max_failures = int(max_failures)
        self.total = 0
        self.done = self.passed = self.failed = self.skipped = 0
        self.run_start = None
        self.suite_name = None
        self.depth = 0
        self.current_test = None
        self.current_test_start = None
        self.current_keyword = None
        self.failures = []
        self.state = "starting"
        self._last_write = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        threading.Thread(target=self._heartbeat, daemon=True).start()

    def _heartbeat(self):
        # refreshes elapsed / current-test timer even when a single keyword runs for minutes
        while not self._stop.wait(1.0):
            if self.state == "running":
                self._write(force=True)

    # ---------- suite ----------
    def start_suite(self, data, result):
        if self.depth == 0:
            self.total = data.test_count
            self.run_start = time.time()
            self.suite_name = data.name
            self.state = "running"
            self._write(force=True)
        self.depth += 1

    def end_suite(self, data, result):
        self.depth -= 1

    # ---------- test ----------
    def start_test(self, data, result):
        self.current_test = _full_name(result)
        self.current_test_start = time.time()
        self.current_keyword = None
        self._write(force=True)

    def end_test(self, data, result):
        self.done += 1
        if result.status == "PASS":
            self.passed += 1
        elif result.status == "SKIP":
            self.skipped += 1
        else:
            self.failed += 1
            self.failures.append({
                "test": _full_name(result),
                "message": (result.message or "")[:500],
                "duration_s": round(time.time() - self.current_test_start, 1),
            })
            self.failures = self.failures[-self.max_failures:]
        self.current_test = None
        self.current_keyword = None
        self._write(force=True)

    # ---------- keyword (RF 7+ only; ignored on older versions) ----------
    def start_keyword(self, data, result):
        if self.current_test:
            self.current_keyword = getattr(result, "full_name", None) or result.name
            # no write here: the heartbeat picks it up within 1s (keeps overhead near zero)

    # ---------- run end ----------
    def close(self):
        self._stop.set()
        self.state = "finished"
        self.current_test = None
        self.current_keyword = None
        self._write(force=True)

    # ---------- output ----------
    def _snapshot(self):
        now = time.time()
        elapsed = now - self.run_start if self.run_start else 0
        eta = None
        if self.done and self.total > self.done and self.state == "running":
            eta = (elapsed / self.done) * (self.total - self.done)
        return {
            "state": self.state,
            "suite": self.suite_name,
            "total": self.total,
            "done": self.done,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "percent": round(100 * self.done / self.total, 1) if self.total else 0,
            "elapsed_s": round(elapsed, 1),
            "eta_s": round(eta, 1) if eta is not None else None,
            "current_test": self.current_test,
            "current_test_elapsed_s": round(now - self.current_test_start, 1)
            if self.current_test else None,
            "current_keyword": self.current_keyword,
            "recent_failures": self.failures,
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "pid": os.getpid(),
        }

    def _line(self, s):
        line = (f"{s['state'].upper()} {s['done']}/{s['total']} ({s['percent']}%) | "
                f"PASS {s['passed']} FAIL {s['failed']} SKIP {s['skipped']} | "
                f"elapsed {_fmt(s['elapsed_s'])}")
        if s["eta_s"] is not None:
            line += f" | ETA ~{_fmt(s['eta_s'])}"
        if s["current_test"]:
            line += f" | now: {s['current_test']} [{_fmt(s['current_test_elapsed_s'])}]"
            if s["current_keyword"]:
                line += f" > {s['current_keyword']}"
        return line

    def _write(self, force=False):
        with self._lock:
            now = time.time()
            if not force and now - self._last_write < 0.5:
                return
            self._last_write = now
            self._write_files(self._snapshot())

    def _write_files(self, s):
        for path, content in ((self.json_path, json.dumps(s, indent=2)),
                              (self.txt_path, self._line(s) + "\n")):
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(content)
            os.replace(tmp, path)  # atomic: readers never see a half-written file
