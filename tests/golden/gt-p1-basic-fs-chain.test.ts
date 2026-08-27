/**
 * GT-P1 — Basic FS Chain, Weekend Crossing (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE2_WEB.md §4:
 *   Calendar: Mon-Fri, no exceptions, project start Mon 2026-01-05.
 *   A(d3) → B(d2) → C(d4), all FS lag 0.
 *
 *   Expected:
 *     A: ES Jan 5,  EF Jan 7   (Mon..Wed — span 3 working days)
 *     B: ES Jan 8,  EF Jan 9   (Thu..Fri — span 2 working days; crosses weekend)
 *     C: ES Jan 12, EF Jan 15  (Mon..Thu — span 4 working days)
 *     All critical · project finish Jan 15
 *
 * Working-day index map (Mon-Fri, start = Jan 5 2026):
 *   Index 1: Jan 5 (Mon)    Index 4: Jan 8 (Thu)    Index 7: Jan 13 (Tue)
 *   Index 2: Jan 6 (Tue)    Index 5: Jan 9 (Fri)    Index 8: Jan 14 (Wed)
 *   Index 3: Jan 7 (Wed)    Index 6: Jan 12 (Mon)   Index 9: Jan 15 (Thu)
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 */

import { describe, it, expect } from "vitest";
import { computeSchedule } from "@domain/scheduling/cpm";
import type { NetworkInput } from "@shared/schemas/scheduling/network";

const monFri = {
  mask: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
  exceptions: [],
};

const network: NetworkInput = {
  projectStart: "2026-01-05",
  calendar: monFri,
  activities: [
    { id: "A", code: "A", duration: 3, type: "TASK" },
    { id: "B", code: "B", duration: 2, type: "TASK" },
    { id: "C", code: "C", duration: 4, type: "TASK" },
  ],
  relationships: [
    { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
    { predecessorId: "B", successorId: "C", type: "FS", lag: 0 },
  ],
};

describe("GT-P1 — Basic FS Chain (authoritative)", () => {
  const result = computeSchedule(network);

  it("returns success", () => {
    expect(result.kind).toBe("success");
  });

  if (result.kind !== "success") return;

  const a = result.activities.find((x) => x.id === "A")!;
  const b = result.activities.find((x) => x.id === "B")!;
  const c = result.activities.find((x) => x.id === "C")!;

  it("A: ES Jan 5, EF Jan 7", () => {
    expect(a.es).toBe("2026-01-05");
    expect(a.ef).toBe("2026-01-07");
  });

  it("B: ES Jan 8, EF Jan 9 (crosses weekend)", () => {
    expect(b.es).toBe("2026-01-08");
    expect(b.ef).toBe("2026-01-09");
  });

  it("C: ES Jan 12, EF Jan 15", () => {
    expect(c.es).toBe("2026-01-12");
    expect(c.ef).toBe("2026-01-15");
  });

  it("all critical (TF = 0)", () => {
    expect(a.totalFloat).toBe(0);
    expect(b.totalFloat).toBe(0);
    expect(c.totalFloat).toBe(0);
    expect(a.isCritical).toBe(true);
    expect(b.isCritical).toBe(true);
    expect(c.isCritical).toBe(true);
  });

  it("project finish = Jan 15", () => {
    expect(result.projectFinishDate).toBe("2026-01-15");
  });

  it("critical path = A → B → C", () => {
    expect(result.criticalPath).toEqual(["A", "B", "C"]);
  });

  it("no warnings", () => {
    expect(result.warnings).toEqual([]);
  });

  it("index-space values are correct (BR-P7 — engine does arithmetic in indices)", () => {
    // A: ES=1, EF=3 · B: ES=4, EF=5 · C: ES=6, EF=9
    expect(a.esIndex).toBe(1);
    expect(a.efIndex).toBe(3);
    expect(b.esIndex).toBe(4);
    expect(b.efIndex).toBe(5);
    expect(c.esIndex).toBe(6);
    expect(c.efIndex).toBe(9);
    expect(result.projectFinishIndex).toBe(9);
  });
});
