# Agentic QA demo: From Prompt to Pipeline

Demo for the talk **"From Prompt to Pipeline: Building an Agentic QA Team"**.

Five AI agents (Requirements, Test Data, UI, Execution, Reviewer) test one user story of a small
checkout app. The same team runs in two configurations:

| | Loose team (`loose`) | Team with rules (`rules`) |
|---|---|---|
| Context | everyone gets everything, full logs | handover contracts only |
| Documents | user story and acceptance criteria | the same (the comparison measures the rules, not access to information) |
| Execution Agent | may rewrite tests | no write access, can only propose a patch |
| Reviewer gets | the previous agent's summary | contract, test diff, trace, gate results |
| Gates | none | assumptions, contract-trace, assertion-diff, evidence |
| Ends with | whatever the agents decide | a human decision when a product bug is found |

The product has a planted bug: the coupon `SAVE10` is accepted, but the total stays €105.00
instead of €95.00 (`DISCOUNT_BUG=1`). The user story says "10% off my order"; only acceptance
criterion AC-3 says shipping is never discounted.

### Separate experiment: no acceptance criteria

`rules-trace` is `rules` plus one permission: the Reviewer may read the page snapshot Playwright writes
when a test fails (`error-context.md` in the run's output), so it can check what the page really showed
instead of trusting the Execution agent's summary. Run it with `npm run measure -- --runs 3 --config rules-trace`.

`loose-no-ac` and `rules-no-ac` remove the acceptance criteria. Only the user story exists, so whether
shipping is discounted (€94.50 or €95.00) is a guess. The loose team tends to turn the guess into a
"fact" that travels through the team; the team with rules should mark it unconfirmed and stop for a
human (`asked_to_clarify`). Keep it separate from the main comparison.

```bash
npm run measure -- --runs 5 --config loose-no-ac,rules-no-ac
npm run replay -- scripted-loose-no-ac     # rehearsal scripts, no API key needed
npm run replay -- scripted-rules-no-ac
```

## Setup

```bash
npm install
npx playwright install chromium
```

Live runs call the Claude API (default model `claude-opus-5-5`, see `orchestrator/configs/*.yaml`).
Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (an API key from console.anthropic.com), export it in the shell, or log in once with `ant auth login`. Node 22 or newer.

## Run it

```bash
npm run run:loose            # live run, loose team (records the model responses)
npm run run:rules            # live run, team with rules
npm run viewer               # http://localhost:4000 : timeline, token bill, gates, human decision
```

Every run is saved in `runs/<id>/`:

- `events.jsonl`: every model call, tool call, permission denial, gate and decision
- `model-calls.jsonl`: the recorded model responses (for replay)
- `report.json`: tokens, cost, spec reads, suite runs, test "repairs", gates, human time
- `pw-<n>/`: Playwright output and traces of each suite run (`npx playwright show-trace <path>`)
- `tests-generated/`: the tests the agents wrote

## Replay (for the stage)

```bash
npm run replay -- runs/<id>            # replays a recorded live run without network; tests run for real
npm run replay -- runs/<id> --pace 1   # same, at the recorded speed
npm run replay -- scripted-loose       # hand-written rehearsal script, no API key needed
npm run replay -- scripted-rules
```

`scripted-*` runs are written by hand (`scripts/make-scripted.ts`) and their token counts are
estimates. The viewer labels them **SCRIPTED REHEARSAL · NOT A MODEL RUN**. Use them to rehearse
and as a backup, never as evidence.

## Human decision

A run of the team with rules that finds the bug stops with `awaiting_human`. Decide in the viewer
(the two buttons) or on the command line:

```bash
npm run decide -- <runId> product_bug          # or requirement_changed
```

## Quality gates

```bash
npm run gate:contract-trace    # every test names a requirement in contracts/ and asserts its expected total
npm run gate:assertion-diff    # a changed expected value needs a file in approvals/ (compares with BASE_REF)
npm run gate:sensitivity       # the suite passes on the correct build and fails on the broken one
npm run gate:evidence          # every failure has a trace (RUN_DIR=runs/<id> also checks the classification)
```

`.github/workflows/qa-gates.yml` runs the four gates as separate checks on every pull request that
touches `tests/generated/`. To show them on a PR: run the team, commit `tests/generated/` on a branch,
open a pull request.

## Measure

```bash
npm run measure -- --runs 1                    # one live run per configuration
npm run measure -- --runs 10                   # numbers for the slides: medians of 10 runs each
npm run measure -- --runs 10 --config loose
```

Each live run costs money. The output table has bug caught, ended green, asked to clarify, median tokens,
cost, suite runs, spec reads and test "repairs". Scripted runs never show a cost: their tokens are estimates. Put only measured numbers on slides and say how many runs they come from.

A real model will not always make the mistake the talk shows. If the loose team sometimes catches the
bug, report that: it supports the point that its result is not reliable.

## The app

```bash
npm run app        # correct build on :3000
npm run app:bug    # broken build on :3001
```

Open `/cart/demo`. The orchestrator and the gates start their own instances on ports 3100 (correct) and 3101 (broken).

## Layout

```
app/            checkout app (correct and broken build)
specs/          user story and acceptance criteria
orchestrator/   orchestrator, agents, tools with permission checks, configs, record/replay, reports
gates/          the four quality gates
viewer/         run viewer
contracts/      handover contract used by the CI gates
approvals/      human approvals for changed expected values
fixtures/       scripted rehearsal runs
tests/support/  helper the generated tests use
tests/generated/ tests written by the agents (cleared at the start of each run)
```
