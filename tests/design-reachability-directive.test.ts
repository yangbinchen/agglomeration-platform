// A Success Criteria bullet that needs more than this run's seat and checkout says where and with
// what data it is measured; one this run cannot produce is tagged [deferred: <named later run>] and
// sits outside the run's acceptance (2026-08-14-components-path-lint-design.md, amendment
// "Success Criteria reachability"). The vocabulary must stay inert to the deploy-audit markers.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditDoc } from "../src/core/audit.js";

const design = readFileSync(join(process.cwd(), "commands", "design.md"), "utf8").replace(/\s+/g, " ");
const stage2 = design.slice(design.indexOf("## Stage 2 — fast-path"), design.indexOf("Then assemble + audit"));
const stage10 = design.slice(design.indexOf("## Stage 10"), design.indexOf("## Stage 11"));
const SC_STEP = "success-criteria**, additionally";

const doc = (criterion: string) =>
  `# D\n\n## Goal\ng\n\n## Architecture\na\n\n## Testing\nt\n\n## Success Criteria\n${criterion}\n`;

describe("design.md: Success Criteria say where they are measured", () => {
  it("Stage 2's bullet names the seat trigger, the unreachable class and the deferred tag", () => {
    expect(stage2.length).toBeGreaterThan(0);
    expect(stage2).toContain("beyond this run's own seat");
    expect(stage2).toContain("unreachable by construction");
    expect(stage2).toContain("[deferred: <named later run>]");
  });

  it("Stage 10's walk carries exactly one success-criteria step, with the measured annotation", () => {
    expect(stage10.split(SC_STEP).length - 1).toBe(1);
    const step = stage10.slice(stage10.indexOf(SC_STEP));
    expect(step).toContain("(measured: <seat>, <data>)");
    expect(step).toContain("[deferred: <named later run>]");
  });
});

describe("the annotation vocabulary cannot trip the deploy audit", () => {
  it("an annotated, deferred criterion passes auditDoc with no issues", () => {
    const criterion = "- X holds (measured: dev seat, `runspecs/overfit-v7.json`) [deferred: the a100 run]";
    expect(auditDoc(doc(criterion))).toEqual({ verdict: "PASS", issues: [] });
  });

  it("an unnamed seat still trips the TBD marker", () => {
    const r = auditDoc(doc("- X holds (measured: seat TBD)"));
    expect(r.verdict).toBe("FAIL");
    expect(r.issues).toContain("tbd_marker");
  });
});
