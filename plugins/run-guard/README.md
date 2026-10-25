# run-guard

Stops Claude Code from doing three things that waste test runs or destroy evidence:

| Rule | What is refused | Default |
|---|---|---|
| Overlapping runs | starting `robot`, `pabot`, `python -m robot` or `playwright test` while another one is running on this machine | on |
| Test evidence | deleting `output*.xml`, `log*.html`, `report*.html`, `xunit*.xml`, `results/`, `test-results/`, `playwright-report/`, `allure-*`, plus `git clean -x` | on |
| Protected hosts | any command that mentions a host you list (matched as a whole name, so `10.20.0.5` does not match `10.20.0.50`) | off until you list hosts |

When a command is refused, Claude is told why and what to do instead. For a protected host, that means telling you what it wanted to run, so you can run it yourself. Run `/run-guard` to see the rules in force.

## Configure

`/plugin` → run-guard → configure:

- `protectedHosts`: a comma-separated list, e.g. `prod-broker.example.com, 10.20.0.5`
- `blockConcurrent`: on or off
- `protectReports`: on or off

## Limits

- **It only guards Claude's own shell commands.** It does not cover what you type yourself, or what another tool or plugin runs.
- **The overlap check is best effort.** It lists processes with `ps` (macOS and Linux) or PowerShell (Windows). If neither works, the check is skipped and the status line says so.
- **It reads commands, not intent.** A delete hidden inside a script file (`./cleanup.sh`) is not seen.
- **If the guard itself crashes, the command is refused** rather than allowed.
