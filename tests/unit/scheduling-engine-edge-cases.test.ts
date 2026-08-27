/**
 * CPM Engine — edge case unit tests.
 *
 * Supplements the golden tests (GT-P1..P6) with:
 *   1. Single-milestone network (project finish = milestone date)
 *   2. Activity with 5 predecessors of mixed types
 *   3. Duplicate relationship pair (FS+SS same pair) — BR-P13
 *   4. All four relationship types converging on one successor
 *   5. Determinism: run GT-P2 100× → byte-identical output every time
 *
 * Also covers: BR-P15 (warning emission), BR-P16 (validation), BR-P12 (TF computation).
 */

import { describe, it, expect } from "vitest";
import { computeSchedule, validateNetwork } from "@domain/scheduling/cpm";
import type { NetworkInput } from "@shared/schemas/scheduling/network";

// ─── Test calendar ────────────────────────────────────────────────────────

const monFri = {
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  },
  exceptions: [],
};

// ─── 1. Single-milestone network ─────────────────────────────────────────────

describe("Edge: single milestone network (project finish = milestone date)", () => {
  const network: NetworkInput = {
    projectStart: "2026-01-05",
    calendar: monFri,
    activities: [
      { id: "M1", code: "M1", duration: 0, type: "MILESTONE" },
    ],
    relationships: [],
  };

  it("returns success", () => {
    const r = computeSchedule(network);
    expect(r.kind).toBe("success");
  });

  if (computeSchedule(network).kind !== "success") return;
  const r = computeSchedule(network);
  if (r.kind !== "success") return;

  const m1 = r.activities.find((x) => x.id === "M1")!;
  it("M1: ES = EF = projectStart (snapped to first working day)", () => {
    expect(m1.es).toBe("2026-01-05");
    expect(m1.ef).toBe("2026-01-05");
    expect(m1.esIndex).toBe(1);
    expect(m1.efIndex).toBe(1);
  });

  it("M1: LS = LF = ES = EF, TF = 0, critical", () => {
    expect(m1.ls).toBe("2026-01-05");
    expect(m1.lf).toBe("2026-01-05");
    expect(m1.totalFloat).toBe(0);
    expect(m1.isCritical).toBe(true);
  });

  it("project finish = milestone date = Jan 5", () => {
    expect(r.projectFinishDate).toBe("2026-01-05");
    expect(r.projectFinishIndex).toBe(1);
  });

  it("critical path = [M1] (single-element path)", () => {
    expect(r.criticalPath).toEqual(["M1"]);
  });

  it("no warnings", () => {
    expect(r.warnings).toEqual([]);
  });
});

// ─── 2. Activity with 5 predecessors of mixed types ───────────────────────

describe("Edge: activity with 5 predecessors of mixed relationship types", () => {
  // All 5 predecessors are open-start (no preds of their own), so each
  // starts at index 1 (Jan 5). Each is dur=3 (so EF=3=Jan 7) for FS-style bounds,
  // except the FF predecessor which is dur=5 (EF=5=Jan 9) to differentiate the bound.
  //
  // Bounds for S (dur 2, span 1):
  //   - FS from P1 (dur 3): ES(S) ≥ EF(P1) + 1 + 0 = 3 + 1 = 4 (Jan 8)
  //   - SS from P2 (dur 3) lag 2: ES(S) ≥ ES(P2) + 2 = 1 + 2 = 3 (Jan 7)
  //   - FF from P3 (dur 5): ES(S) ≥ EF(P3) + 0 - span(S) = 5 - 1 = 4 (Jan 8)
  //   - SF from P4 (dur 3) lag 1: ES(S) ≥ ES(P4) + 1 - span(S) = 1 + 1 - 1 = 1 (Jan 5)
  //   - FS from P5 (dur 3) lag -1: ES(S) ≥ EF(P5) + 1 - 1 = 3 (Jan 7)
  // Max = 4 (Jan 8). So S: ES=Jan 8 (index 4), EF=Jan 9 (index 5).
  const network: NetworkInput = {
    projectStart: "2026-01-05",
    calendar: monFri,
    activities: [
      { id: "P1", code: "P1", duration: 3, type: "TASK" },
      { id: "P2", code: "P2", duration: 3, type: "TASK" },
      { id: "P3", code: "P3", duration: 5, type: "TASK" },
      { id: "P4", code: "P4", duration: 3, type: "TASK" },
      { id: "P5", code: "P5", duration: 3, type: "TASK" },
      { id: "S",  code: "S",  duration: 2, type: "TASK" },
    ],
    relationships: [
      { predecessorId: "P1", successorId: "S", type: "FS", lag: 0 },
      { predecessorId: "P2", successorId: "S", type: "SS", lag: 2 },
      { predecessorId: "P3", successorId: "S", type: "FF", lag: 0 },
      { predecessorId: "P4", successorId: "S", type: "SF", lag: 1 },
      { predecessorId: "P5", successorId: "S", type: "FS", lag: -1 },
    ],
  };

  const r = computeSchedule(network);
  it("returns success", () => {
    expect(r.kind).toBe("success");
  });

  if (r.kind !== "success") return;
  const s = r.activities.find((x) => x.id === "S")!;

  it("S: ES = max of all 5 bounds = Jan 8 (driven by FS-from-P1 and FF-from-P3, both = 4)", () => {
    expect(s.esIndex).toBe(4);
    expect(s.es).toBe("2026-01-08");
  });

  it("S: EF = ES + span = 4 + 1 = 5 (Jan 9)", () => {
    expect(s.efIndex).toBe(5);
    expect(s.ef).toBe("2026-01-09");
  });

  it("all 5 predecessors start at index 1 (open-start, BR-P8)", () => {
    for (const id of ["P1", "P2", "P3", "P4", "P5"]) {
      const p = r.activities.find((x) => x.id === id)!;
      expect(p.esIndex).toBe(1);
      expect(p.es).toBe("2026-01-05");
    }
  });

  it("P3 (dur 5) is the latest-finishing predecessor: EF = index 5 = Jan 9", () => {
    const p3 = r.activities.find((x) => x.id === "P3")!;
    expect(p3.efIndex).toBe(5);
    expect(p3.ef).toBe("2026-01-09");
  });
});

// ─── 3. Duplicate relationship pair (FS+SS same pair) — BR-P13 ─────────────

describe("Edge: duplicate relationship pair (FS+SS same pair) — BR-P13", () => {
  // A → B with BOTH an FS and an SS relationship (both lag 0).
  // Per BR-P13: BOTH bounds apply. The max is taken.
  //
  // Bounds:
  //   FS from A: ES(B) ≥ EF(A) + 1 + 0 = 4 + 1 = 5 (Jan 9)
  //   SS from A: ES(B) ≥ ES(A) + 0 = 1 (Jan 5)
  // Max = 5 (Jan 9). Without FS (only SS), ES(B) would be 1 (Jan 5).
  // So the FS bound is what drives B's ES — both bounds are correctly applied.
  const network: NetworkInput = {
    projectStart: "2026-01-05",
    calendar: monFri,
    activities: [
      { id: "A", code: "A", duration: 4, type: "TASK" },
      { id: "B", code: "B", duration: 2, type: "TASK" },
    ],
    relationships: [
      { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
      { predecessorId: "A", successorId: "B", type: "SS", lag: 0 },
    ],
  };

  const r = computeSchedule(network);
  it("returns success", () => {
    expect(r.kind).toBe("success");
  });

  if (r.kind !== "success") return;
  const a = r.activities.find((x) => x.id === "A")!;
  const b = r.activities.find((x) => x.id === "B")!;

  it("A: ES=Jan 5, EF=Jan 8 (dur 4, span 3)", () => {
    expect(a.esIndex).toBe(1);
    expect(a.efIndex).toBe(4);
    expect(a.es).toBe("2026-01-05");
    expect(a.ef).toBe("2026-01-08");
  });

  it("B: ES = max(FS bound=5, SS bound=1) = 5 (Jan 9) — both bounds applied (BR-P13)", () => {
    expect(b.esIndex).toBe(5);
    expect(b.es).toBe("2026-01-09");
  });

  it("B: EF = ES + span = 5 + 1 = 6 (Jan 12, after weekend)", () => {
    expect(b.efIndex).toBe(6);
    expect(b.ef).toBe("2026-01-12");
  });
});

// ─── 4. All four relationship types converging on one successor ──────────

describe("Edge: all four relationship types converging on one successor", () => {
  // 4 predecessors (P1, P2, P3, P4), all open-start at index 1 (Jan 5).
  // Each has dur=4 (so ES=1, EF=4).
  // Successor S has dur=2 (span=1) with:
  //   FS from P1, lag 0:  ES(S) ≥ EF(P1) + 1 + 0 = 5 (Jan 9)   ← the largest
  //   SS from P2, lag 1:  ES(S) ≥ ES(P2) + 1     = 2 (Jan 6)
  //   FF from P3, lag 0:  ES(S) ≥ EF(P3) + 0 - 1 = 3 (Jan 7)
  //   SF from P4, lag -1: ES(S) ≥ ES(P4) - 1 - 1 = -1 (warning if computed)
  //
  // Max = 5 (Jan 9). So S: ES=Jan 9, EF=Jan 12 (Mon, weekend crossed).
  //
  // The SF with lag -1 produces a bound of -1, which is < 1 (project start index).
  // BUT: S's actual ES is 5 (the max), which is ≥ 1, so no BR-P15 warning fires
  // for S. (A warning would fire only if the FINAL ES < 1.)
  const network: NetworkInput = {
    projectStart: "2026-01-05",
    calendar: monFri,
    activities: [
      { id: "P1", code: "P1", duration: 4, type: "TASK" },
      { id: "P2", code: "P2", duration: 4, type: "TASK" },
      { id: "P3", code: "P3", duration: 4, type: "TASK" },
      { id: "P4", code: "P4", duration: 4, type: "TASK" },
      { id: "S",  code: "S",  duration: 2, type: "TASK" },
    ],
    relationships: [
      { predecessorId: "P1", successorId: "S", type: "FS", lag: 0 },
      { predecessorId: "P2", successorId: "S", type: "SS", lag: 1 },
      { predecessorId: "P3", successorId: "S", type: "FF", lag: 0 },
      { predecessorId: "P4", successorId: "S", type: "SF", lag: -1 },
    ],
  };

  const r = computeSchedule(network);
  it("returns success", () => {
    expect(r.kind).toBe("success");
  });

  if (r.kind !== "success") return;
  const s = r.activities.find((x) => x.id === "S")!;

  it("S: ES = max(FS=5, SS=2, FF=3, SF=-1) = 5 (Jan 9) — all four bounds applied", () => {
    expect(s.esIndex).toBe(5);
    expect(s.es).toBe("2026-01-09");
  });

  it("S: EF = 6 (Jan 12, after weekend)", () => {
    expect(s.efIndex).toBe(6);
    expect(s.ef).toBe("2026-01-12");
  });

  it("no BR-P15 warning (final ES = 5 ≥ 1, even though one bound was -1)", () => {
    expect(r.warnings).toEqual([]);
  });
});

// ─── 5. Determinism: GT-P2 100× → identical output ────────────────────────

describe("Determinism: run GT-P2 network 100× → identical output every time", () => {
  const gtP2Network: NetworkInput = {
    projectStart: "2026-01-05",
    calendar: monFri,
    activities: [
      { id: "A", code: "A", duration: 2,  type: "TASK" },
      { id: "B", code: "B", duration: 10, type: "TASK" },
      { id: "C", code: "C", duration: 3,  type: "TASK" },
      { id: "D", code: "D", duration: 4,  type: "TASK" },
      { id: "E", code: "E", duration: 1,  type: "TASK" },
    ],
    relationships: [
      { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
      { predecessorId: "A", successorId: "C", type: "FS", lag: 0 },
      { predecessorId: "C", successorId: "D", type: "FS", lag: 0 },
      { predecessorId: "B", successorId: "E", type: "FS", lag: 0 },
      { predecessorId: "D", successorId: "E", type: "FS", lag: 0 },
    ],
  };

  it("100 runs produce byte-identical JSON output (BR-P2 — pure function)", () => {
    const first = JSON.stringify(computeSchedule(gtP2Network));
    expect(first.length).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) {
      const runJson = JSON.stringify(computeSchedule(gtP2Network));
      if (runJson !== first) {
        throw new Error(
          `Non-deterministic output detected at run ${i + 1}.\n` +
          `First: ${first.slice(0, 200)}...\n` +
          `Run ${i + 1}: ${runJson.slice(0, 200)}...`,
        );
      }
    }
    // Sanity check the canonical GT-P2 result while we're here.
    const r = computeSchedule(gtP2Network);
    if (r.kind === "success") {
      expect(r.projectFinishDate).toBe("2026-01-21");
      expect(r.criticalPath).toEqual(["A", "B", "E"]);
    }
  });

  it("1000 runs also stable (extended determinism check, matches imported spec's ritual)", () => {
    // The imported spec mentions "run the GT-P2 network 1,000× — identical output"
    // as a determinism ritual. We use 100× in the assertion above and 1000× here.
    const first = JSON.stringify(computeSchedule(gtP2Network));
    for (let i = 0; i < 1000; i++) {
      if (JSON.stringify(computeSchedule(gtP2Network)) !== first) {
        throw new Error(`Determinism violated at iteration ${i + 1}`);
      }
    }
  });
});

// ─── 6. Validation edge cases (BR-P16) ────────────────────────────────────

describe("BR-P16 — validation errors", () => {
  it("unknown predecessor → validation error, no schedule produced", () => {
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "NONEXISTENT", successorId: "A", type: "FS", lag: 0 },
      ],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "UNKNOWN_PREDECESSOR")).toBe(true);
    }
  });

  it("self-relationship → validation error", () => {
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "A", successorId: "A", type: "FS", lag: 0 },
      ],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "SELF_RELATIONSHIP")).toBe(true);
    }
  });

  it("invalid projectStart → validation error", () => {
    const network: NetworkInput = {
      projectStart: "not-a-date",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
      ],
      relationships: [],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "INVALID_PROJECT_START")).toBe(true);
    }
  });

  it("all-off calendar mask → validation error (BR-P6)", () => {
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: {
        mask: {
          monday: false, tuesday: false, wednesday: false, thursday: false,
          friday: false, saturday: false, sunday: false,
        },
        exceptions: [],
      },
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
      ],
      relationships: [],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "INVALID_CALENDAR")).toBe(true);
    }
  });

  it("duplicate activity IDs → validation error", () => {
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
        { id: "A", code: "A2", duration: 1, type: "TASK" },
      ],
      relationships: [],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "DUPLICATE_ACTIVITY_ID")).toBe(true);
    }
  });

  it("validateNetwork function is exported and reusable", () => {
    const errors = validateNetwork({
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [],
      relationships: [],
    });
    expect(errors).toEqual([]);
  });
});

// ─── 7. BR-P15 warning emission (ES < project start) ───────────────────────

describe("BR-P15 — negative-lag warning when ES pushed before project start", () => {
  it("emits a warning when ES < 1 (predecessor with large negative lag)", () => {
    // A is open-start, dur=2 (ES=1, EF=2).
    // B: FS from A with lag=-5 → ES(B) ≥ EF(A) + 1 + (-5) = 2 + 1 - 5 = -2.
    // B's ES = -2 < 1 → BR-P15 warning expected. Engine should NOT clamp.
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 2, type: "TASK" },
        { id: "B", code: "B", duration: 1, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "A", successorId: "B", type: "FS", lag: -5 },
      ],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;

    const b = r.activities.find((x) => x.id === "B")!;
    // ES index = -2 (engine did NOT clamp).
    expect(b.esIndex).toBe(-2);

    // The corresponding ISO date: index -2 in Mon-Fri calendar starting Jan 5 2026.
    // Index 1 = Jan 5 (Mon); index 0 = Jan 2 (Fri); index -1 = Jan 1 (Thu); index -2 = Dec 31 (Wed).
    expect(b.es).toBe("2025-12-31");

    // A warning was emitted.
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("ES_BEFORE_PROJECT_START");
    expect(r.warnings[0].activityId).toBe("B");
  });
});

// ─── 8. Empty activity list (degenerate case) ─────────────────────────────

describe("Edge: empty activity list", () => {
  it("returns success with empty activities and projectFinishDate = projectStart", () => {
    const network: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [],
      relationships: [],
    };
    const r = computeSchedule(network);
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.activities).toEqual([]);
    expect(r.criticalPath).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.projectFinishDate).toBe("2026-01-05");
    expect(r.projectFinishIndex).toBe(Number.NEGATIVE_INFINITY);
  });
});
