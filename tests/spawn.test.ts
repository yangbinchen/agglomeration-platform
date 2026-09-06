import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSlug, resolveMode, isWorkerRole, bootstrapFailureRc, stampOrFail, READY_WAIT_DEPS } from "../src/commands/spawn.js";
import { paneLive, paneOwned } from "../src/core/tmux.js";
import { outboxWaitSince } from "../src/core/ipc.js";

// The bootstrap ready-wait probes LIVENESS, never ownership. Pinned by IDENTITY because no
// behavioural test can tell the two apart: they differ on exactly one pane shape — dead but still
// ours, which `remain-on-exit` now keeps listed — and rebinding this to `paneOwned` is the #195 bug
// itself, a wait that sits out the whole ready_timeout_s on a worker that died at bootstrap.
describe("READY_WAIT_DEPS — the live bindings, pinned", () => {
  it("paneAlive IS paneLive (the LIVENESS probe), never paneOwned", () => {
    expect(READY_WAIT_DEPS.paneAlive).toBe(paneLive);
    expect(READY_WAIT_DEPS.paneAlive).not.toBe(paneOwned);
  });
  it("wait IS the real outbox wait", () => {
    expect(READY_WAIT_DEPS.wait).toBe(outboxWaitSince);
  });
});

describe("spawn pure helpers", () => {
  it("validateSlug accepts lowercase/digit/hyphen ≤32, rejects others", () => {
    expect(validateSlug("auth-review")).toBe(true);
    expect(validateSlug("Bad")).toBe(false);
    expect(validateSlug("has space")).toBe(false);
    expect(validateSlug("x".repeat(33))).toBe(false);
    expect(validateSlug("")).toBe(false);
  });
  it("resolveMode: explicit > default > full", () => {
    expect(resolveMode("read-only", "full")).toBe("read-only");
    expect(resolveMode(undefined, "full")).toBe("full");
    expect(resolveMode(undefined, undefined)).toBe("full");
  });
});

// The `--role` gate, without creating a pane: an unknown value must never fall back to the
// permissive template, and the third role (design D) has to be admitted by the same table the
// identity is rendered from — a role spelled in one and missing from the other is the drift the
// predicate exists to make impossible.
describe("isWorkerRole — the --role gate", () => {
  it("admits exactly the three identity roles, slice included", () => {
    expect(isWorkerRole("worker")).toBe(true);
    expect(isWorkerRole("job-hub")).toBe(true);
    expect(isWorkerRole("slice")).toBe(true);
  });
  it("refuses anything else, prototype keys included", () => {
    for (const bad of ["superuser", "hub", "Slice", "slices", "", "constructor", "toString"]) {
      expect(isWorkerRole(bad), bad).toBe(false);
    }
  });
});

// `implement spawn-slices` branches on spawn's RETURN CODE (the `SPAWN_FAILED reason=` line is a
// directive contract a Bash step greps, invisible in-process), retrying only the cold-start pair.
// Every existing caller — `spawnTally`, `job start` — tests zero-vs-non-zero, so the split moves
// nothing for them.
describe("bootstrapFailureRc — 3 for a cold start, 1 for the worker's own error", () => {
  it("pane_dead and timeout are rc 3", () => {
    expect(bootstrapFailureRc("pane_dead")).toBe(3);
    expect(bootstrapFailureRc("timeout")).toBe(3);
  });
  it("error_event stays rc 1 — the worker reported, a retry would meet the same failure", () => {
    expect(bootstrapFailureRc("error_event")).toBe(1);
  });
  it("every code is still non-zero, which is all any shipped caller reads", () => {
    for (const reason of ["pane_dead", "timeout", "error_event"] as const) {
      expect(bootstrapFailureRc(reason)).not.toBe(0);
    }
  });
});

// Issue #195, P2: every ap pane is created with `remain-on-exit on`, so a worker that dies at
// bootstrap keeps its screen for `capture-pane` instead of vanishing with it. The option rides the
// stamping — one place, every placement path — and unlike the two stamps it is NOT load-bearing.
// A PATH shim stands in for tmux (the same device tests/tmux.test.ts uses): no server is touched.
describe("stampOrFail — remain-on-exit rides the ownership stamping", () => {
  const NONCE = "11111111-1111-4111-8111-111111111111";
  /** `body` is a /bin/sh tmux stand-in; `__LOG__` is replaced by the argv log it appends to. */
  async function withFakeTmux<R>(body: string, fn: (argv: () => string[]) => Promise<R>): Promise<R> {
    const dir = mkdtempSync(join(tmpdir(), "ap-stamp-"));
    const logFile = join(dir, "argv.log");
    writeFileSync(join(dir, "tmux"), body.replace("__LOG__", logFile), { mode: 0o755 });
    const orig = process.env.PATH;
    process.env.PATH = dir;   // ONLY the stub is reachable
    try {
      return await fn(() => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : []));
    } finally { process.env.PATH = orig; }
  }
  const LOG_ALL = '#!/bin/sh\nprintf \'%s\\n\' "$*" >> __LOG__\nexit 0\n';
  // set-option -p -t <pane> <opt> <val>  ->  the option name
  const options = (argv: string[]): string[] => argv.map((l) => l.split(" ")[4]);

  it("sets it AFTER both stamps, on the pane it just stamped", async () => {
    await withFakeTmux(LOG_ALL, async (argv) => {
      expect(await stampOrFail("%5", NONCE, "alpha", "codex", "demo")).toBe(true);
      expect(options(argv())).toEqual(["@ap_nonce", "@ap_state", "remain-on-exit"]);
      expect(argv()[2]).toBe(`set-option -p -t %5 remain-on-exit on`);
    });
  });

  it("a tmux that REFUSES it does not fail the spawn — the pane only loses its tail", async () => {
    const REFUSE_REMAIN = '#!/bin/sh\nprintf \'%s\\n\' "$*" >> __LOG__\ncase "$*" in *remain-on-exit*) exit 1;; esac\nexit 0\n';
    await withFakeTmux(REFUSE_REMAIN, async (argv) => {
      expect(await stampOrFail("%5", NONCE, "alpha", "codex", "demo")).toBe(true);
      expect(options(argv())).toContain("remain-on-exit");
    });
  });
});
