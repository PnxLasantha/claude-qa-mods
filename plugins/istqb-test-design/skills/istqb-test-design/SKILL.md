---
name: istqb-test-design
description: Use when designing test cases from a requirement, story or spec, or reviewing/deduplicating a test set. Applies ISTQB CTFL, CTAL-TA and CTAL-TTA techniques: coverage items first, then minimal non-redundant tests.
---

# ISTQB Test Design

Sources (cite the section when you apply a technique, e.g. `[CTAL-TA 3.1.1]`):
- **CTFL** v4.0.1 — Foundation, Chapter 4
- **CTAL-TA** v4.0 — Advanced Test Analyst, Chapter 3
- **CTAL-TTA** v4.0 — Advanced Technical Test Analyst, Chapter 2

Goal: every test catches a defect no other test catches. Test count is not the metric; coverage of explicit coverage items is. Principle [CTFL 4.5.3]: tests cover the characteristics without going beyond them, and **no two tests cover the same characteristic**.

Where an advanced technique is stronger than its Foundation equivalent, prefer the advanced one for High and Safety-critical risk.

Never jump straight to test cases. Work through the gates in order.

## Gate 0 — Understand and set risk

1. Restate the requirement in one or two lines.
2. List ambiguities, missing rules, undefined values as open questions. Mark any assumption as `ASSUMPTION:` (specification-workshop step of ATDD [CTFL 4.5.3]).
3. Assign risk and state why. Risk sets the coverage target:

| Risk | Input domains | Decision rules | State behaviour | Combinations | Code (if available) |
|---|---|---|---|---|---|
| **Safety-critical** (EN 50128 / SIL-rated, mission-critical) — never downgrade | Domain testing, reliable coverage (or 3-value BVA for single parameters) | Full table, no minimization [CTAL-TA 3.3.1] | All transitions [CTFL 4.2.4] + 1-switch or round-trip | Decision table / all combinations for safety logic; pairwise only for non-safety config | Level required by the project's safety standard and verification plan (e.g. MC/DC highly recommended at SIL 4 under IEC 61508 [CTAL-TTA 2.4]) |
| **High** (money, data loss, security) | Domain testing simplified coverage, or 3-value BVA | Full table | All transitions | Pairwise minimum | Decision (branch) coverage |
| **Medium** | EP + 2-value BVA | Minimized table | Valid transitions (0-switch) | Pairwise or base choice | Statement |
| **Low** | EP, Each Choice | Risk-selected rules | All states | Each Choice | — |

Only the items cited to a syllabus section are ISTQB-sourced; the rest of this mapping is a working heuristic — the project's test strategy overrides it. For EN 50128 projects, take code-coverage requirements from the project's verification plan; do not assume them.

If open questions block meaningful design, stop and ask before Gate 1.

## Gate 1 — Coverage items (STOP for review)

Pick techniques by what the requirement contains:

| Requirement contains | Technique |
|---|---|
| Single-parameter ranges / field rules | EP + BVA [CTFL 4.2.1–2] |
| Conditions over several parameters (`x + y ≤ 10`, `a > b`) | Domain testing [CTAL-TA 3.1.1] |
| Conditions jointly deciding outcomes | Decision table [CTFL 4.2.3, CTAL-TA 3.3.1] |
| Modes, lifecycle, protocols | State transition [CTFL 4.2.4, CTAL-TA 3.2.2] |
| Entities created/read/updated/deleted | CRUD testing [CTAL-TA 3.2.1] |
| Workflows, use cases, user journeys | Scenario-based testing [CTAL-TA 3.2.3] |
| Many interacting parameters / configurations | Combinatorial testing [CTAL-TA 3.1.2] |
| No reliable expected result (oracle problem) | Metamorphic testing [CTAL-TA 3.3.2] |
| Huge input space, automated oracle available | Random testing [CTAL-TA 3.1.3] |
| User story with acceptance criteria | Collaboration-based [CTFL 4.5] |
| Code available | White-box [CTFL 4.3, CTAL-TTA 2] |
| Past defects, thin specs | Experience-based [CTFL 4.4, CTAL-TA 3.4] |

### Data-based
- **Equivalence Partitioning** [CTFL 4.2.1] — coverage items: partitions, valid AND invalid; non-empty, non-overlapping. One test per partition suffices. Multiple parameters: at least **Each Choice** (every partition of every parameter exercised at least once; combinations not required).
- **Boundary Value Analysis** [CTFL 4.2.2] — ordered partitions only. Boundary values = min and max of each partition.
  - 2-value: boundary + closest neighbour in the adjacent partition.
  - 3-value: boundary + both neighbours. Catches more, e.g. `x ≤ 10` implemented as `x == 10`: 2-value data (10, 11) misses it; 9 catches it.
- **Domain testing** [CTAL-TA 3.1.1] — extends EP/BVA to conditions over several parameters. Each atomic condition is a border. Coverage points:
  - ON: on a closed border, or just inside an open border.
  - OFF: just outside a closed border, or on an open border.
  - IN / OUT: inside / outside the domain, not ON or OFF.
  - **Simplified coverage**: one ON + one OFF per `<, ≤, >, ≥` border; one ON + two OFFs (both sides) for `=`; one OFF + two ONs for `≠`.
  - **Reliable coverage**: simplified + one IN and one OUT per inequality border. Finds more defects.
  - Points may be shared between borders — share them to minimise tests.

### Combinatorial testing [CTAL-TA 3.1.2]
Targets interaction failures (most failures involve one or two interacting parameters).

Use when ALL are true:
- 3+ parameters, each already partitioned with EP (use partition representatives as values, not raw values).
- Full combinations are too many to run, and Each Choice is too weak because parameters may interact (configurations, compatibility matrices, device/firmware/OS/browser/settings combos).

Do NOT use pairwise for:
- Business or safety logic with known condition combinations → decision table (every feasible rule).
- Safety-critical interactions involving 3+ conditions → pairwise misses them; use decision tables, full combinations, or n-wise if justified.

Criteria:
- **Base choice**: pick a base value per parameter (e.g. most common config); vary one parameter at a time from that base combination.
- **Pairwise**: every pair of parameter values appears in at least one test. Coverage: pairs exercised ÷ feasible pairs.
- **n-wise** (3-wise+): when three-way interactions are a known risk.
- Use a **classification tree** to structure parameters and values when there are many.

Rules:
- Combinatorial tables contain **valid values only**. Invalid partitions stay as separate one-invalid-per-test cases (masking rule). If a tool supports negative values (PICT `~` prefix), it must place only one per test.
- Declare **constraints** for impossible combinations (e.g. `IF [OS] = "iOS" THEN [Browser] <> "Edge";`) so no infeasible tests are generated.
- Generate with a tool (PICT, `allpairspy`), never by hand. Include the model file in the output so it can be regenerated.
- Optionally seed must-have combinations (e.g. the most-used production config).
- Report: `all combinations = X tests → chosen strategy = Y tests`.

Pick the combination strategy explicitly per parameter set:

| Strategy | Covers | Use when |
|---|---|---|
| Each Choice [CTFL 4.2.1] | every value once | parameters truly independent, low risk |
| Base choice [CTAL-TA 3.1.2] | every value once, varied from a realistic base | one dominant real-world config |
| Pairwise [CTAL-TA 3.1.2] | every value pair | parameters may interact, combinations too many |
| n-wise [CTAL-TA 3.1.2] | every value n-tuple | known higher-order interaction risk |
| Decision table [CTFL 4.2.3] | every feasible rule | conditions jointly determine the outcome |
| All combinations | everything | few parameters, or safety-critical interaction |

### Random testing [CTAL-TA 3.1.3]
Random inputs from a distribution: operational profile for validation, usage-agnostic for verification; unguided or guided (adaptive random). Requires an automated oracle. No coverage criterion — define exit by count or time. Complements, never replaces, systematic techniques.

### Behaviour-based
- **State transition** [CTFL 4.2.4, CTAL-TA 3.2.2] — transitions as `event [guard] / action`; tests are event sequences. Build a state table (empty cells = invalid transitions).
  - All states: coverage items = states.
  - Valid transitions (0-switch): single valid transitions (most common; implies all states).
  - All transitions: all valid transitions + every invalid transition attempted (implies the others). **CTFL minimum for safety-critical software.**
  - **N-switch**: sequences of N+1 consecutive transitions. 1-switch is common; 2-switch+ only for high failure risk (exponential growth).
  - **Round-trip coverage**: loops starting and ending in the same state with no other state repeated; empirically effective.
  - Good candidate for model-based testing tools.
- **CRUD testing** [CTAL-TA 3.2.1] — CRUD matrix: rows = functions, columns = entities, cells = C/R/U/D.
  - Completeness (static): each entity has all four operations somewhere; a missing one is an anomaly to raise.
  - Consistency (dynamic): exercise every matrix operation, plus negative cases (read/update/delete before create or after delete).
  - Coverage: operations executed ÷ total. Stricter: sequences such as every R after each U.
- **Scenario-based testing** [CTAL-TA 3.2.3] — from activity diagrams or use cases.
  - Main scenario (happy path), extensions (alternatives that still reach the goal), exceptions (abnormal/invalid flows).
  - Loops: **simple loop coverage** — 0 iterations, 1, typical, maximum.
  - Coverage: scenarios executed ÷ identified. Use EP/BVA inside a scenario for its data.

### Rule-based
- **Decision table** [CTFL 4.2.3, CTAL-TA 3.3.1] — conditions/actions as rows; each column a rule. Limited-entry (T/F) or extended-entry (ranges/partitions). Notation: `–` irrelevant, `N/A` infeasible, `X` action occurs.
  - Coverage items: feasible columns. Coverage: exercised ÷ feasible columns.
  - Minimize by removing infeasible rules, then merging action-equivalent rules with `–`. **For high-risk tables, do not minimize: measure coverage on the full table.**
  - **Checksum**: each rule counts as the product of its `–` expansions; the sum must equal the full-table rule count. Lower = gaps; higher = overlaps or extra rules.
  - Review for consistency, feasibility, completeness, correctness, no overlapping rules.
- **Metamorphic testing** [CTAL-TA 3.3.2] — when the expected result is unknown or expensive to get. Define metamorphic relations (e.g. permuting inputs leaves an average unchanged; scaling inputs scales the output). Evaluate source + follow-up tests together. Use several relations, combined with random inputs; one test per relation is not enough.

### Collaboration-based [CTFL 4.5] — when input is a user story
- Check the story against INVEST; flag non-testable stories.
- Treat acceptance criteria as test conditions, scenario-oriented (Given/When/Then) or rule-oriented (verification list / input-output table).

### White-box [CTFL 4.3, CTAL-TTA 2] — when code is available
Apply black-box first; add white-box tests only for coverage the black-box set missed [CTAL-TTA 2.8]. Specify one criterion, normally at 100%.
- **Statement** — executed ÷ executable statements. Minimum for any code under test.
- **Decision / branch** — decision outcomes exercised ÷ total. Subsumes statement. Misses defects from condition combinations.
- **MC/DC** — each atomic condition shown, via a pair of tests, to independently change the decision outcome. Used in safety-critical sectors (IEC 61508: highly recommended at SIL 4). Watch for coupled conditions and short-circuit evaluation.
- **Multiple condition** — all combinations of atomic conditions per decision. Rarely feasible; MC/DC is the usual alternative.
- **API testing** [CTAL-TTA 2.7] — realistic and unexpected inputs for each callable entity; check exception handling, timing, lost or duplicated transactions.
- White-box cannot find omissions (requirements never implemented) — never use it as the only basis.

### Experience-based [CTFL 4.4, CTAL-TA 3.4] — complements, never replaces
- **Error guessing / fault attacks**: list likely defects (past failures, typical developer errors, similar systems), one test each.
- **Checklist-based**: separately checkable questions, not too general, updated from defect analysis, kept short.
- **Session-based exploratory testing**: time-boxed sessions with charters and a debrief; propose charters instead of inventing scripted tests when specs are thin.
- **Crowd testing** where device/user diversity matters and the context allows it.

### Coverage-item table

Output a coverage-item table with stable IDs:

| ID | Technique [source] | Coverage item | Valid/Invalid | Notes |
|---|---|---|---|---|
| EP-01 | EP [CTFL 4.2.1] | Age 18–65 | Valid | |
| EP-02 | EP [CTFL 4.2.1] | Age < 18 | Invalid | |
| BV-01 | BVA 3-value [CTFL 4.2.2] | 17 / 18 / 19 | — | lower boundary |
| DM-01 | Domain [CTAL-TA 3.1.1] | `speed + margin ≤ 80`: ON point | — | reliable coverage |
| DT-R3 | Decision table [CTAL-TA 3.3.1] | Rule 3: member & expired → reject | — | full table |
| ST-05 | State [CTFL 4.2.4] | Idle → Active on START | Valid | |
| ST-I02 | State [CTFL 4.2.4] | Active + START | Invalid | |
| RT-01 | Round-trip [CTAL-TA 3.2.2] | Idle → Active → Paused → Idle | — | |
| CR-03 | CRUD [CTAL-TA 3.2.1] | Read Track after Delete | Invalid | |
| PW-01 | Pairwise [CTAL-TA 3.1.2] | Firmware × Device × Region pairs | Valid | constraints: … |
| MR-01 | Metamorphic [CTAL-TA 3.3.2] | Reversing route order keeps total distance | — | |
| EG-01 | Error guessing [CTFL 4.4.1] | Double-submit | — | fault attack |

Then **stop** and ask the user to review. Missing or wrong items are cheapest to fix here.

## Gate 2 — Test cases

Order of design [CTFL 4.5.3]: positive tests first, then negative, then non-functional (performance, usability, etc.) if in scope.

Rules:
- Each test lists the coverage item IDs it covers.
- Each test states **the unique defect it would catch** in one line. If none, the test is redundant — drop or merge.
- **Valid values may be combined** in one test to minimise count (Each Choice / base choice / pairwise / shared domain points).
- **One invalid partition per test**, all other inputs valid — avoids defect masking.
- **One invalid state transition per test** [CTFL 4.2.4] — avoids defect masking.
- Variants of the same partition and logic become one **parameterized / data-driven** test. Combinatorial rows are ideal data-driven rows.
- Positive, negative and boundary cases come from the coverage items, never from a quota.

### Test case titles

Many readers (testers, reviewers, safety assessors, managers) read only the title, so it must say what is checked without the steps.

- Form: **"Verify <observable outcome> when <situation>"**.
  - Negative cases: **"Verify <action> is refused when <invalid situation>"**, or "Verify nothing is changed when …".
  - Good: "Verify the account is locked with a warning when a wrong password is entered for the third time"
  - Good: "Verify the status icon turns orange with a warning when one device is offline"
  - Bad: "Verify login scenario 17", "TC-03 invalid", "pwd=wrong, attempts=3, locked=false"
- Lead with the outcome that matters most for risk: what is shown, what is refused, what is not changed, the colour or warning.
- Write the outcome from the test's Expected result and the situation from its coverage item, so title, expectation and coverage always agree. If the Expected result changes, the title changes with it.
- Plain words a reader of the requirement would understand. No internal state codes, signal or variable names, scenario or rule numbers, coverage or requirement IDs, device-type codes or internal flags. Those go in Steps / Data, the Covers column or tags. A short hint in brackets is fine, e.g. "(orange)".
- No vague outcomes: "correctly", "properly", "works", "as expected" or "successfully" on their own. Name what is observed.
- One outcome per title. If two different outcomes need joining with "and", check whether it should be two tests.
- Under ~150 characters and unique across the suite. Sibling cases differ by their situation, never by a number or suffix.
- Data-driven and combinatorial tests: the template names the shared behaviour, and each row gets its own title naming its situation (Robot Framework test names per template row, one Playwright `test()` per row, pytest `ids`).
- Use the identical title everywhere: the design table, the test-management tool (e.g. Xray Test Summary, TestRail title), the automated test name, and any spec or document section.
- **Project conventions override these rules.** If the repo or project has a naming guide (e.g. in `CLAUDE.md` or `docs/test-naming.md`) with a domain glossary or forbidden terms, follow it.

Output format:

| TC ID | Title | Covers | Preconditions | Steps / Data | Expected result | Unique defect caught |
|---|---|---|---|---|---|---|

If code is requested (Robot Framework, Playwright, pytest, etc.), generate from this table and keep TC IDs and coverage IDs in test names or tags for traceability. For combinatorial sets, emit a data-driven test (RF test template, Playwright parameterized test, pytest parametrize) fed by the generated rows.

## Gate 3 — Redundancy and gap review

Report each check explicitly:

1. **Coverage %** per technique (exercised ÷ identified items). Must meet the Gate 0 target; list uncovered items.
2. **Redundancy**: for tests with overlapping coverage ask "Can a defect fail A while B passes?" If no → duplicate; propose merge/removal. Flag any test whose items are a subset of another's.
3. **Masking**: no test combines two invalid partitions or two invalid transitions.
4. **Depth**: coverage level matches the Gate 0 risk level.
5. **Technique choice**: each area states which technique was used and why; the stronger advanced technique was used where risk is High or Safety-critical; pairwise was not used for safety logic.
6. **Decision-table checksum** matches (if tables used).
7. **Titles**: every title follows the title rules, is unique, contains no internal codes or numbers, and agrees with its Expected result.
8. Summary: `N coverage items → M tests (K merged/removed)` + coverage % per technique.

## Reviewing an existing test set

1. Reverse-engineer the coverage items each test exercises.
2. Build the coverage table from those and from the requirement, if available.
3. Run Gate 3; output duplicates to merge, gaps to add, masked negative tests to split, and areas where a stronger technique (domain testing, round-trip, full decision table, combinatorial) would cover more with the same or fewer tests.
4. Where tooling exists, confirm objectively with code coverage at the required level, or mutation testing.

## Tone

Be direct. If the requirement is too vague to test well, say so instead of padding with tests. Fewer, sharper, traceable tests over volume.
