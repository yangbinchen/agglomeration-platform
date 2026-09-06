import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { captureSpawnFailure, NO_EVENT_SENTINEL } from "../src/core/forensics.js";
import { parseMechanicalFindings } from "../src/core/review.js";
import { globalRoot, forensicsQueueDir, workerDir } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function queuedRecords(): string[] {
  const dir = forensicsQueueDir();
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f)) : [];
}

describe("captureSpawnFailure", () => {
  it("queues a command:spawn record review can parse, with its run under the WORKER dir", () => {
    const line = captureSpawnFailure({
      agent: "lima", model: "codex", topic: "plan-x",
      reason: "config_error", detail: "identity template not found",
      failureReportPath: "/p/failure-reason.txt",
    });
    const files = queuedRecords();
    expect(files).toHaveLength(1);
    expect(line).toBe(`QUEUED=${files[0]}`);
    const md = readFileSync(files[0], "utf8");
    expect(md).toContain("command: spawn");
    expect(md).toContain("topic: plan-x");
    expect(md).toContain("n_findings_mechanical: 2");
    expect(md).toContain("title: [ap:spawn] config_error");
    expect(md).toContain(`art_dir: ${workerDir("lima", "codex", "plan-x")}`);
    const findings = parseMechanicalFindings(md);
    expect(findings.some((f) => f.source === "spawn_failure" && /reason=config_error/.test(f.key))).toBe(true);
    expect(findings.some((f) => /failure_report=\/p\/failure-reason\.txt/.test(f.key))).toBe(true);
    expect(md).toContain("worker=lima-codex");
    // the spawn failure IS its own run: the trace lands beside the worker's state
    expect(existsSync(join(workerDir("lima", "codex", "plan-x"), "findings.log"))).toBe(true);
  });

  it("emits a single finding when no failure report is given", () => {
    captureSpawnFailure({ agent: "zulu", model: "claude", topic: "t", reason: "timeout", detail: NO_EVENT_SENTINEL });
    expect(readFileSync(queuedRecords()[0], "utf8")).toContain("n_findings_mechanical: 1");
  });

  // Issue #195: the tracker showed `reason=pane_dead` and a report path, and nothing about WHY the
  // provider TUI died. The pane's last lines are that lead, so they ride the same record.
  describe("pane_tail", () => {
    // 20 lines: blanks and a whitespace-only line the filter drops, one line shaped exactly like a
    // rendered finding bullet, and one credential.
    const RAW = [
      "line01", "line02", "line03", "", "line04", "line05", "  ", "line06", "line07", "line08",
      "- **x** y _(source: z)_", "line09", "", "token=abcd1234efgh",
      "line10", "line11", "line12", "line13", "line14", "line15",
    ].join("\n");
    const EXPECTED = [
      "line03", "line04", "line05", "line06", "line07", "line08",
      "- **x** y _(source: z)_", "line09", "token=<redacted>",
      "line10", "line11", "line12", "line13", "line14", "line15",
    ].join("\n");

    it("files the last 15 NON-EMPTY lines, scrubbed then percent-encoded, as a third finding", () => {
      captureSpawnFailure({
        agent: "lima", model: "codex", topic: "t", reason: "pane_dead", detail: "d",
        failureReportPath: "/p/failure-reason.txt", paneTail: RAW,
      });
      const md = readFileSync(queuedRecords()[0], "utf8");
      expect(md).toContain("n_findings_mechanical: 3");
      const findings = parseMechanicalFindings(md);
      // THREE, not four: the tail is one encoded line, so its bullet-shaped row cannot parse back
      // out as a finding of its own.
      expect(findings).toHaveLength(3);
      const tail = findings.find((f) => f.key.startsWith("pane_tail="))!;
      const decoded = decodeURIComponent(tail.key.slice("pane_tail=".length));
      // Scrubbed BEFORE encoding, or no denylist pattern could ever match the percent-encoded text.
      expect(decoded).toBe(EXPECTED);
      expect(md).not.toContain("abcd1234efgh");
      // Filtered THEN sliced: slicing the raw 20 lines first would start the tail at line05.
      expect(decoded.split("\n")).toHaveLength(15);
      expect(decoded.split("\n")[0]).toBe("line03");
    });

    it("an absent or whitespace-only tail pushes no bullet at all", () => {
      captureSpawnFailure({ agent: "a", model: "codex", topic: "t", reason: "timeout", detail: "d", failureReportPath: "/p/f.txt" });
      expect(readFileSync(queuedRecords()[0], "utf8")).toContain("n_findings_mechanical: 2");
      env.cleanup(); env = freshHome();
      captureSpawnFailure({ agent: "a", model: "codex", topic: "t", reason: "timeout", detail: "d", failureReportPath: "/p/f.txt", paneTail: "\n  \n\n" });
      expect(readFileSync(queuedRecords()[0], "utf8")).toContain("n_findings_mechanical: 2");
    });
  });

  it("is best-effort: returns '' and queues nothing when the queue dir can't be created", () => {
    mkdirSync(globalRoot(), { recursive: true });
    writeFileSync(join(globalRoot(), "forensics"), "x"); // a FILE where the dir would go -> mkdirSync throws
    expect(captureSpawnFailure({ agent: "a", model: "b", topic: "t", reason: "spawn_error", detail: "x" })).toBe("");
  });
});
