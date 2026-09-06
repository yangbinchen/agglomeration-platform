# Components path-lint (warn-only) + the [on-box] convention — design

**Date:** 2026-08-14 · **Origin:** the path-reality-gap cluster, 6+ lifetime occurrences across
both boxes (latest: two of four question rounds in one implement run were cited-but-absent paths;
a design named the same box-local config at two different paths). The standing feedback memory
already mandates "state which repo each component lives in"; this PR gives the mandate a
mechanical check. · **Scope:** one small PR (0.5.17).

## Problem

Design docs cite paths that do not exist in the target checkout — box-local configs, sibling-repo
files, drafting typos. Workers are deliberately fail-closed on missing paths (they halt with a
question rather than invent), so every phantom path costs a question round. Nothing checks a
doc's Components paths at authoring time; the first existence check happens inside a worker's
turn.

## Goal

At `design assemble` time and at `implement audit` time, every Components path that does not
exist in the target checkout and is not explicitly marked box-local produces a WARNING naming the
path — never a failure. Authors mark deliberately-non-checkout paths with a literal `[on-box]`
tag on the same Components line. The deploy-audit gate's verdict is untouched.

## Architecture

**Shared helper.** `lintComponentsPaths(docText: string, root: string): string[]` in
`src/core/implementScope.ts` (beside `extractComponentsPaths`, its only dependency): extract the
Components paths; drop every path whose source LINE contains the literal `[on-box]` (the
extraction walks lines — thread the line text through, or re-scan lines for the tag before
token-extraction); resolve the rest against `root` (absolute paths as-is, relative via
`join(root, p)`); return the missing ones. Trailing-`/` dir paths check as directories. No
git calls, no I/O beyond `existsSync`.

**Hook 1 — `design assemble`** (`src/commands/design.ts`, between `assembleDoc` and `auditDoc`):
`lintComponentsPaths(doc, repoRoot())`; each missing path → one `log.warn`
(`design assemble: Components path not found in this checkout: <p> — mark it [on-box] if it is
deliberately box-local, or fix the path`). The audit verdict and rc are byte-identical — the
rc-1 FAIL path stays audit-owned.

**Hook 2 — `implement audit`** (`src/commands/implement.ts`, in the audit verb beside the
existing 0-paths warn): same helper against the doc under audit, resolved against the audit's
target root; same warn shape with the `implement audit:` label. Catches docs authored outside
`/ap:design`.

**The convention.** `commands/design.md` (the Components drafting guidance in BOTH the fast-path
Stage 2 bullet list and the walk's components step): every path must exist in the target checkout
at drafting time — stat it before citing it; paths that intentionally live on another box are
marked `[on-box]` on the same line and never resolved locally. `commands/implement.md`: one
sentence noting audit warns on unmarked missing paths and what the warning means. The scope-check
consumer (`matchDiffAgainstComponents`) ignores `[on-box]` lines' paths naturally (they never
match diff paths); no change there.

## Components

- `src/core/implementScope.ts` — `lintComponentsPaths` (+ the line-level `[on-box]` exemption).
- `src/commands/design.ts` — the assemble hook (warn-only; audit rc untouched).
- `src/commands/implement.ts` — the audit hook (warn-only; audit rc untouched).
- `commands/design.md` + `commands/implement.md` — the convention + warning documentation.
- `README.md` — the [on-box] tag mentioned where the command guide describes design's output.
- `tests/` — see Testing. Version 0.5.16 → 0.5.17 (three manifests) + rebuilt committed dist.

## Testing

- Helper: missing relative + absolute paths reported; existing paths not; `[on-box]` lines fully
  exempt (all their paths); table rows and bullet lines both covered; no-Components-section →
  empty; trailing-slash dirs.
- Assemble hook: a doc with one phantom path warns once and STILL passes the audit (rc 0);
  audit-FAIL docs still rc 1 with the warn present; zero-warning docs byte-identical output.
- Audit hook: same pair through `implement audit`; the existing `SCOPE_DECLARED=0` warn
  unaffected.
- Full suite green; no rc value or audit ISSUE list changes anywhere.

## Success Criteria

- A design doc citing a nonexistent path warns at assemble AND at audit, before any worker burns
  a question round; `[on-box]` silences it precisely per line.
- The deploy-audit gate's pass/fail behavior is provably unchanged (pins).
- Gate green; dist rebuilt+committed.

### Success Criteria reachability (0.5.92, issue #222)

The `[on-box]` convention above says where a *path* lives. This amendment says where a
*criterion* is measured, for the same reason: a claim the target checkout cannot resolve costs
the implementing worker a question round.

A detached `/ap:implement` run on iris-cortex (2026-09-04) took a design whose Success Criteria
required an A/B record only an a100 box accepting merged main at a pinned SHA could produce, over
a measurement population of which 444 of 1244 ids were staged on the dev seat. Both criteria were
unreachable by construction; the worker raised them as a first-turn objection and the hub amended
the doc mid-run. `commands/design.md` gave Success Criteria one rule — "measurable bullets" — and
Stage 10's walk had no success-criteria step at all; `auditDoc` checks section presence and
placeholder markers only, so nothing looked at reachability.

**The annotation.** `commands/design.md` (the fast-path Stage 2 bullet and the Stage 10 walk
step — the same two sites the `[on-box]` convention touches): a criterion whose measurement needs
anything beyond this run's own seat and the checkout it stands in carries
`(measured: <seat>, <data>)` on the same line, with both confirmed reachable from this run's
checkout, a population counted the way `components` stats its paths. The trigger is deliberately
narrow: a criterion this seat's own test suite measures on the checkout carries nothing, so a
single-seat design — nearly all of them — reads exactly as it does today.

**The tag.** A criterion only another box, a merged-main SHA, or an unstaged population can
produce is tagged `[deferred: <named later run>]` on the same line. `commands/implement.md`
Stage 2 Step B gives it its consumer-side meaning in one sentence, placed where the hub meets it
before writing the cross-verify verdict: such a bullet is outside this run's acceptance — never a
`[spec-gap]`, never a FAIL. That is what makes the tag worth writing; without it the hub's only
options were to chase an unmeasurable claim or to drop it silently.

**No mechanical check.** Unlike the path lint, this stays directive-only. `auditDoc` issues are
hard FAILs, and 0 of the 100 design docs under `docs/superpowers/specs/` and `docs/ap/specs/`
carry the tag, so a gate over the annotation would reject the whole corpus; the warn-only hook
shape the path lint uses cannot help either, since `assemble` has no way to tell a genuinely
single-seat criterion from an unannotated cross-seat one. An opt-in consistency warn (flag a
`(measured: …)` line whose named seat is not this box) is recorded here as a possible follow-up,
not built. What IS pinned is that the vocabulary is inert to the existing gate: the tests assert
`(measured: <seat>, <data>)` and `[deferred: <run>]` trip none of the four placeholder markers
`auditDoc` flags (a doc that spelled them here would fail its own audit).

Tests: `tests/design-reachability-directive.test.ts` (the Stage 2 slice's seat sentence, the
single Stage 10 sub-bullet, and the two `auditDoc` docs — annotated PASS, a seat left as a placeholder word FAIL with
`tbd_marker`); `tests/implement-hub-side-directive.test.ts` (the Step B sentence). MUTATION: the
Stage 2 seat sentence deleted → 1 red with the Stage 10 assertion still green; the Stage 10
sub-bullet deleted → 1 red; the Step B sentence deleted → 1 red; all restored → green.
