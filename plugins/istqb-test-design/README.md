# istqb-test-design

A skill that makes Claude design test cases the way the ISTQB syllabi describe: coverage items first, then the smallest set of tests that covers them, with no two tests covering the same thing.

It works in gates, and stops for your review before writing any tests:

1. **Gate 0**: restates the requirement, lists open questions, and sets a risk level. The risk level decides how deep each technique goes.
2. **Gate 1**: lists the coverage items (partitions, boundaries, domain points, decision rules, transitions, CRUD operations, scenarios, pairs), each tagged with its technique and syllabus section. **Then it stops for your review.**
3. **Gate 2**: writes the tests. Each one names the coverage items it covers and the defect that only it would catch.
4. **Gate 3**: reports coverage per technique, duplicates to merge, and any test that masks one invalid input with another.

It can also review an existing test set against a requirement and say what to merge, split or add.

## Techniques

Each technique is cited to its syllabus section, for example `[CTAL-TA 3.1.1]`.

- **CTFL v4.0.1** (Foundation): equivalence partitioning, boundary value analysis, decision tables, state transition, statement and branch coverage, experience-based testing, acceptance criteria and ATDD.
- **CTAL-TA v4.0** (Advanced Test Analyst): domain testing, combinatorial testing (base choice, pairwise, n-wise), random testing, CRUD testing, N-switch and round-trip state coverage, scenario-based testing, full decision tables with checksums, metamorphic testing, session-based testing.
- **CTAL-TTA v4.0** (Advanced Technical Test Analyst): decision coverage, MC/DC, multiple condition coverage, API testing.

## Install

At the prompt of a Claude Code session:

```
/plugin install istqb-test-design --marketplace PnxLasantha/claude-qa-mods
```

To use it in Claude on the web, desktop or mobile instead, upload [`skills/istqb-test-design/SKILL.md`](skills/istqb-test-design/SKILL.md) as a skill in your Claude settings.

## Use

Ask Claude to design tests, or name the skill to be sure it loads:

```
Use istqb-test-design on this requirement: <paste requirement>
Use istqb-test-design to review these tests against this requirement: <paste both>
... then generate Robot Framework tests
```

At Gate 1, reply `approved` or correct the list, for example "EP-03 range is 0–255" or "this is SIL 4".

## Test case titles

Titles follow the form **"Verify &lt;observable outcome&gt; when &lt;situation&gt;"**, in plain words, written from the Expected result, unique and under about 150 characters. Internal codes, signal names and scenario numbers go in the steps and data, not the title. The same title is used in the design table, the test-management tool and the automated test.

To add your own domain glossary or forbidden terms, put a naming section in your project's `CLAUDE.md` or a `docs/test-naming.md`. The skill follows project conventions over its defaults.

## Limits

- The mapping from risk level to coverage depth is a working default. Only the items cited to a syllabus section come from ISTQB. Your project's test strategy overrides it.
- For EN 50128 projects, the skill doesn't assume code-coverage levels. It asks you to take them from the project's verification plan.
- Pairwise tables should be generated with a tool such as PICT or `allpairspy`. The skill asks for the model file rather than building tables by hand.
