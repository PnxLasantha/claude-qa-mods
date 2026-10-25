# failure-triage

Groups test failures by root cause, so "37 failures" becomes "3 causes".

After Claude runs Robot Framework or Playwright, the plugin parses the report. It normalises each error message, replacing numbers, IPs, paths, UUIDs, timestamps and quoted values with placeholders. Failures that share a message are grouped together. For Robot Framework, the failing keyword must match too, which helps tell causes apart.

- **A pane** lists each cause with its count, an example message, the keyword where it failed, and the affected tests. Each cause has a "Copy rerun command" button.
- **Claude is told the groups.** After a failing foreground run, the grouping is added to what Claude reads. Claude can then investigate one test per cause instead of going through every failure.
- **A tool, `triage_failures`,** lets Claude triage any report on request.
- **`/triage path/to/output.xml`** does the same for you.

Background runs are watched: the report is triaged as soon as it has been written.

## Robot Framework

It works with no setup. It finds `output.xml` from the command's `-d/--outputdir` and `-o/--output` options, including `cd dir && robot …`. It follows the actual failure path, so failures swallowed by `Run Keyword And Ignore Error` or `TRY/EXCEPT` don't mislead it. The XML is streamed, so large output files are fine.

## Playwright

Playwright's default reporters don't write a file that can be parsed. Add the JSON reporter, for example:

```ts
reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]]
```

The plugin looks in `playwright-report/results.json`, `test-results/results.json`, `results.json` and `report.json`. You can also set your own path in `/plugin` → failure-triage → configure.

## Requirements

Python 3 on PATH as `python3`, `python` or `py`. It uses the standard library only.
