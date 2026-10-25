# traceability-check

Makes sure every test Claude commits is linked to a requirement.

When Claude runs `git commit`, the plugin finds the Robot Framework and Playwright tests that the commit adds or changes. If any of them has no tag matching your requirement-ID pattern, the commit is refused, and Claude is told which tests need tagging. **Claude is told not to invent requirement IDs, but to ask you which requirement each test verifies.**

Tests that the commit doesn't touch are never flagged, so an old repo with gaps doesn't block every commit. To see those gaps, run `/trace-audit`, or ask Claude, which has a `trace_audit` tool. You'll get a repo-wide list and the percentage of tests tagged.

## What counts as tagged

**Robot Framework**, from any of:
- the test's `[Tags]`, including `...` continuation lines
- the file's `Test Tags`, `Force Tags` or `Default Tags`
- `Test Tags` or `Force Tags` in any parent `__init__.robot`

**Playwright** (`*.spec.*` / `*.test.*`), from any of:
- `@tags` in the test title
- the `tag:` option
- an annotation `description`
- an enclosing `test.describe` with a tag

## Configure

`/plugin` → traceability-check → configure:

- **`tagPattern`**: a regular expression, matched case-insensitively. The default is `^(REQ|SRS|SSRS|SRD|HAZ|SAF)[-_:.]?\S*\d`. **Set it to your real ID scheme.**
- **`mode`**: `block` (the default) refuses the commit; `warn` lets it through and tells you and Claude.

`git commit -a`/`-am` is checked against the working tree, and a plain `git commit` against the index. `cd x && git commit` and `git -C x commit` are both handled. In block mode, if the check itself can't run, the commit is refused.

## Limits

- It checks commits Claude makes, not your own. For your own commits, use a git pre-commit hook. `scripts/trace.py --staged --pattern '<regex>'` works as one.
- `git commit --amend` only checks what is newly staged.
- Parsing is line-based, not a full Robot or TypeScript parser. Unusual formatting, such as Robot's pipe-separated format or tests generated in loops, may be missed.

## Requirements

Python 3 and git on PATH.
