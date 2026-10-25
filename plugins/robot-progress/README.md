# robot-progress

Live progress for Robot Framework runs started by Claude Code, shown in a pane beside the chat.

When Claude runs `robot` for you (directly, through a shell script, or through a wrapper like robotframework-repeatrun), a pane opens and updates every second. It shows:

- a progress bar with done/total and pass, fail and skip counts
- elapsed time and an estimate of the time left
- the test running now, how long it has run, and its current keyword
- recent failures, each with the first line of its message

You also get:

- a status-line summary
- a toast when the run finishes
- a "stalled" warning when the run stops reporting for 6 seconds or more (the process was killed or hung)

## Install

At the prompt of a Claude Code session:

```
/plugin install robot-progress --marketplace PnxLasantha/claude-qa-mods
```

Answer `y` to add the marketplace, then pick a scope. Restart the session. Reopen the pane any time with `/robot-progress`.

To try a local checkout without installing:

```
claude --plugin-dir /path/to/robot-progress
```

## How it works

At session start the plugin appends a passive listener to `ROBOT_OPTIONS` for every process Claude Code starts:

```
--listener <plugin>/listener/ProgressListener.py;<plugin>/run/progress.json
```

The listener writes `run/progress.json` and a one-line `run/progress.txt` atomically, refreshing them every second. The plugin polls the JSON file and redraws the pane. Nothing about the tests or their results changes.

You can also use the listener on its own, outside Claude:

```
robot --listener path/to/ProgressListener.py:results/progress.json tests/
```

## Limitations

- **pabot:** every worker writes the same file, so the counts will be wrong.
- **Robot Framework older than 7:** test-level progress only; the keyword line stays empty.
- **Spaces in the plugin path:** `ROBOT_OPTIONS` splits on spaces, so the plugin skips auto-injection and warns you instead.
- **Remote runs:** a run over SSH or on CI is not seen. Only runs on the machine where Claude Code runs are tracked.
- **Early-access API:** this uses Claude Code's early-access function-hooks plugin API (built against 2.1.310). Older versions won't load it, and the API may change.

