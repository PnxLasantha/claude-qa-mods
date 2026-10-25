# claude-qa-mods

Claude Code plugins for test automation with Robot Framework and Playwright. Each one installs and switches off independently.

| Plugin | What it does |
|---|---|
| [robot-progress](plugins/robot-progress) | Live progress of Robot Framework runs in a pane: progress bar, current test and keyword, failures as they happen, and a warning when a run stalls |
| [failure-triage](plugins/failure-triage) | Groups failures by root cause ("37 failures → 3 causes"), shows them in a pane, and tells Claude the groups so it investigates one test per cause |
| [run-guard](plugins/run-guard) | Refuses overlapping test runs, deleting test reports and evidence, and commands against hosts you mark as protected |
| [traceability-check](plugins/traceability-check) | Refuses commits whose new or changed tests lack a requirement tag, and tells Claude to ask rather than invent IDs. `/trace-audit` reports repo-wide coverage |

## Install

At the prompt of a Claude Code session, install the ones you want:

```
/plugin install robot-progress --marketplace PnxLasantha/claude-qa-mods
/plugin install failure-triage --marketplace PnxLasantha/claude-qa-mods
/plugin install run-guard --marketplace PnxLasantha/claude-qa-mods
/plugin install traceability-check --marketplace PnxLasantha/claude-qa-mods
```

The first time, answer `y` to add the marketplace, then pick a scope. Configure options with `/plugin` → the plugin → configure.

## Requirements

- **Claude Code with the function-hooks plugin API.** These were built against 2.1.310. The API is early access and may change.
- **They run where Claude Code runs:** the terminal, or the Code tab of the desktop app. They only see test runs on that machine.
- **Python 3 on PATH** for failure-triage and traceability-check (standard library only), and **git** for traceability-check.

Each plugin's README lists its limits.

## License

MIT
