// The detached implement run's two hubs — the origin watching `job wait`, the job hub driving the
// lead and N slice workers — follow implement.md and nothing else. These sentences are their
// counterpart of the worker delegation block (2026-09-05-worker-delegation-reminder-design.md,
// amendment "implement's detached job hub"): the waits, relays, park, sends and rc-bearing verbs are
// the hubs' own turn; a slice's claim check runs in that slice's tree and its Verdict is the hub's;
// one park at a time; roster-mutating verbs one at a time.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raw = readFileSync(join(process.cwd(), "commands", "implement.md"), "utf8");
const doc = raw.replace(/\s+/g, " ");
const slice = (from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to));
const detached = slice("## DETACHED MODE", "## Progress tracking");
const stage1p = slice("## Stage 1P", "## Stage 1 — run the worker turn");

describe("implement.md detached path: the hubs' own delegation split", () => {
  it("DETACHED MODE keeps the Monitors, the relay, the park, the sends and every rc-bearing verb with the hubs", () => {
    expect(detached).toContain("**Driving the run is your own turn, on either side.**");
    expect(detached).toContain("every `$CS` verb whose rc you branch on");
    expect(detached).toContain("its report of a verb's output is not the verb's rc");
    expect(detached).toContain("until 1P.7 merges it");
  });

  it("1P.5 runs a slice's claim check in that slice's tree and keeps the Verdict with the hub", () => {
    expect(stage1p).toContain("**The check runs in that slice's tree, and its Verdict is yours.**");
    expect(stage1p).toContain("never `TARGET_CWD`, which holds that slice's commits only after 1P.7");
    expect(stage1p).toContain("you opened in that slice's worktree yourself in this turn");
  });

  it("1P.5 parks one question at a time", () => {
    expect(stage1p).toContain("One park at a time: while a question of yours is unanswered, append no second one");
    expect(stage1p).toContain("consumed with it by the relay's cursor and never reaches the operator");
  });

  it("roster-mutating verbs run one at a time, never batched", () => {
    expect(stage1p).toContain("run one at a time, each its own tool call, never batched in one message");
    expect(stage1p).toContain("two `abandon-slice` calls in sequence, never one message");
  });

  it("the sentences sit only at their sites", () => {
    expect(doc.split("**Driving the run is your own turn, on either side.**")).toHaveLength(2);
    expect(doc.split("One park at a time")).toHaveLength(2);
    expect(raw).not.toContain("own window");
  });
});
