# Scope paths as designs actually write them (closes #208, #215)

Date: 2026-09-06. Two field defects from the 2026-09-02..03 iris-runtime / ap runs, both in
`src/core/implementScope.ts`: one in the scope verdict, one in the warn-only authoring lint.

## Problem

**#208 — an absolute-citation design reads as a whole-diff out-of-scope.** A run's `implement
scope-check` printed `OOS_COUNT=16` on a diff whose every path was declared. The design had spelled
its Components and Testing paths ABSOLUTE under the main checkout
(`/home/liupan/Aerius/agglomeration-platform/src/core/provision.ts`), which is what the directives
tell an author to do — `commands/implement.md` says "stat every path before you cite it, and write it
ABSOLUTE". But `git diff --name-only` emits repo-relative paths, and `matchDiffAgainstComponents`
compares literal strings: an absolute declaration matches no relative diff path under any of its five
rules. A design that followed the authoring rule declared, for matching purposes, nothing.

**#215 — the Components lint warns on three shapes it should not.** `lintComponentsPaths` (surfaced
by `implement audit` and `design assemble`) reported "Components path not found in this checkout"
for: (a) a file the design deliberately CREATES, which by definition does not exist yet; (b) a bare
filename `config.json`, root-joined and checked as `<root>/config.json` even though match rule 4 keys
a bare filename on the BASENAME of any diff path, so the root-join is the wrong question; (c)
`serve/irisserve/model.py:197`, the `:line` evidence suffix the same directives mandate for
citations. Case (c) is not only a lint noise: the suffixed token is not `fileShaped`, so it also
inflated `SCOPE_UNRESOLVED`, and it silently missed the matcher — the file it names was declared and
still read out-of-scope.

## Goal

A design authored the way the directives prescribe — absolute paths, `:line` evidence suffixes, a
`(new — does not exist yet)` label on what the run creates — produces an honest scope verdict and a
quiet lint, with no change to the declared counts, the artifacts, or any rc.

## Architecture

Four rules, all of them widening or warn-only.

**1. Strip a trailing `:line` suffix at BOTH token producers.** `const LINE_REF =
/(?::\d+(?:-\d+)?)+$/` beside `ENDS_WITH_EXT`, applied in `pathTokensFrom` before the path heuristic
and in the table first-cell branch of `sectionPathsByLine` after its `.trim()`. Both sites are
needed: the table branch does not call `pathTokensFrom`. The pattern is anchored at the end and
digits-only, so `https://example.com/a` and `src/a:b.ts` are untouched. The suffix names a location
inside a file; the file is the declaration.

**2. New-file exemption in the lint, reusing the label the directives already mandate.** `const
NEW_MARK = /\(new\b|\bNEW\b|\bnew:/` beside `ON_BOX_TAG`, skipped in `lintComponentsPaths` exactly as
`[on-box]` is. `commands/implement.md` and `commands/quick.md` already require `(new — does not exist
yet)` on a path a run creates, so nothing new has to be taught. The pattern is deliberately NOT
`/\bnew\b/i`: corpus lines say "new `helper()`" about a file that already exists, and those must keep
warning.

**3. Bare-basename skip in the lint.** A token with no `/` is a rule-4 declaration, matched by
basename anywhere in the diff, so joining it to the root and asking whether `<root>/config.json`
exists asks about a location the matcher never uses. `if (!p.includes("/")) continue;`.

**4. `relativeForms(declared, mainRoot, targetCwd)`, appended at the call site.** For each declared
token that is absolute, try the anchors `[targetCwd, mainRoot]` in that order and, on the first
`p.startsWith(anchor + "/")`, take `p.slice(anchor.length + 1)`. Target first because a worktree
run's target is `<main>/.ap/worktrees/<topic>`, so a path cited inside the worktree sits under both
roots and the main anchor would yield `.ap/worktrees/<topic>/src/a.ts`, which is not what the diff
says. `scopeCheckWith` calls it after `declaredPaths` is built and passes
`[...declaredPaths, ...rel]` to the matcher — APPENDED, never substituted. The matcher is an
existential OR over declarations, so an added token can only move a diff path from out-of-scope to
in-scope; `SCOPE_DECLARED`, `TESTING_DECLARED`, `SCOPE_UNRESOLVED`, `TESTING_UNRESOLVED`,
`components-paths.txt`, `testing-paths.txt` and `scope-unresolved.txt` all keep the ABSOLUTE token
verbatim ("report, never filter", `2026-08-23-declared-path-precision-design.md`). One new stdout key
counts the additions: `SCOPE_RELATIVIZED=`.

**Deliberately NOT done.**

- **No basename or ancestor-name fallback for an absolute path under neither root.** A path on
  another box is not this repo's file. Inventing a relative form for it would put a same-named diff
  path in scope on a coincidence, which is the one direction a scope gate must not drift.
- **No new `[new]` tag.** The `(new — does not exist yet)` label is already mandated by two
  directives and is already what field docs write; a second spelling would split the corpus.

**Known side effects, accepted.**

- A brief or design citing `src/a.ts:12` now RESOLVES to `src/a.ts`, so that path can newly appear in
  `INVISIBLE_IN_TARGET` (`pathsInvisibleInTarget`) or in `quick branch`'s `STATE_RELATIVE` lint
  output. Those are true positives that the suffix was hiding.
- `SCOPE_DECLARED` can drop by one on a doc that cites both `src/a.ts` and `src/a.ts:42`: the two
  tokens now dedupe to one. The declared set is smaller by a duplicate only.

## Components

- `src/core/implementScope.ts` — new `LINE_REF` and `NEW_MARK` constants; `pathTokensFrom` and the
  table branch of `sectionPathsByLine` strip `LINE_REF`; `lintComponentsPaths` gains the `NEW_MARK`
  line skip and the bare-basename skip; new exported `relativeForms(declared, mainRoot, targetCwd)`.
- `src/commands/implement.ts` — `scopeCheckWith` calls `relativeForms(declaredPaths, repoRoot(),
  targetCwd)` and matches against `[...declaredPaths, ...rel]`, printing `SCOPE_RELATIVIZED=`;
  `auditRun`'s lint warn names the `(new — does not exist yet)` escape.
- `commands/implement.md` — Stage 4 step 1 lists `SCOPE_RELATIVIZED=` and states the two new matching
  rules; the `(new — does not exist yet)` authoring bullet says the audit's existence check skips a
  line carrying that label.
- `commands/design.md` — the `.draft/components.md` authoring rule and the Stage 10 `components` walk
  bullet name the same label and its exemption.
- `tests/implement-scope.test.ts`, `tests/implement-scope-check.test.ts`,
  `tests/design-assemble.test.ts` — the new cases below.
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md` —
  0.5.89.
- `dist/ap.cjs` — rebuilt and committed by the hub.

## Testing

Every case names the mutation that turns it red.

- `tests/implement-scope.test.ts` — `:line` extraction: `` - `src/core/job.ts:417` — the extracted
  helper `` under `## Components` yields `["src/core/job.ts"]` (mutation: remove the strip in
  `pathTokensFrom`); the TABLE form `` | `src/core/job.ts:98-120` | edit | `` yields the same
  (mutation: strip only in `pathTokensFrom`); a bullet naming `https://example.com/a` and
  `src/a:b.ts` keeps both tokens intact (mutation: widen `LINE_REF` to `/:[^:]*$/`).
- `tests/implement-scope.test.ts` — `unresolvedDeclaredPaths` over a doc declaring
  `src/core/job.ts:417` reports `[]`, pinning that the suffix no longer inflates `SCOPE_UNRESOLVED`.
- `tests/implement-scope.test.ts` — lint, against a fixture root holding `src/core/real.ts`:
  `` `src/core/real.ts:12` `` warns nothing; `` `src/core/phantom.ts` (new — does not exist yet) ``,
  the `— NEW.` spelling and a `| new: |` table cell warn nothing; **the false-exemption guard** —
  `` `src/core/phantom.ts` — new `helper()` beside the old one `` STILL warns (mutation: widen
  `NEW_MARK` to `/\bnew\b/i`); a bare `config.json` against a root without it warns nothing
  (mutation: drop the `includes("/")` skip); and the exempted doc still EXTRACTS every path
  (mutation: filter in the extractor instead of the lint).
- `tests/implement-scope.test.ts` — `describe("relativeForms")` with main `/m/repo` and target
  `/m/repo/.ap/worktrees/t`: `/m/repo/src/a.ts` -> `src/a.ts`;
  `/m/repo/.ap/worktrees/t/src/a.ts` -> `src/a.ts` (mutation: swap the anchor order ->
  `.ap/worktrees/t/src/a.ts`); `/elsewhere/repo/src/a.ts` -> `[]` (mutation: add a basename
  fallback); a relative `src/a.ts` -> `[]`; duplicates collapse.
- `tests/implement-scope-check.test.ts` — the verb-level #208 case: `target_cwd` = the fixture's main
  root, Components declares BOTH `<main root>/src/core/provision.ts` and relative `src/core/tmux.ts`,
  diff = both files. Assert `OOS_COUNT=0`, `SCOPE_DECLARED=2`, `SCOPE_RELATIVIZED=1`, and
  `components-paths.txt` holding the ABSOLUTE token verbatim (mutations: revert to
  `matchDiffAgainstComponents(diffPaths, declaredPaths)` -> `OOS_COUNT=1`; substitute `rel` for
  `declaredPaths` instead of appending -> `OOS_COUNT=1`; count `rel` in `SCOPE_DECLARED` -> 3).
- `tests/implement-scope-check.test.ts` — the verb-level `:line` case: Components declares
  `` `src/a.ts:42` ``, diff `src/a.ts` -> `OOS_COUNT=0` and `SCOPE_UNRESOLVED=0`.
- `tests/design-assemble.test.ts` — the directive pins: `commands/implement.md` Stage 4 carries
  `SCOPE_RELATIVIZED=` and the relativized/`:line` sentence; `commands/design.md`'s fast path and
  Stage 10 walk both carry the `(new — does not exist yet)` exemption.
- NON-REGRESSION: every existing expectation in both scope test files stays byte-unchanged. An
  existing expectation that needs editing means the change touched the verdict and is wrong.

## Success Criteria

- The #208 case, run at the verb level, prints `OOS_COUNT=0` with `SCOPE_RELATIVIZED=1` where it
  printed `OOS_COUNT=16` with every path declared.
- The three #215 lint cases — a created file, a bare filename, a `:line` citation — produce no
  warning, while a line saying "new helper()" about an existing file still does.
- `SCOPE_DECLARED`, `TESTING_DECLARED`, `OOS_PATH`, `components-paths.txt`, `testing-paths.txt`,
  `scope-unresolved.txt` and the rc are unchanged for every existing fixture; every existing scope
  test passes unedited.
- `npm run typecheck && npm test && npm run lint && npm run build` green; `dist/ap.cjs` committed.
