/**
 * GT-P2 — Parallel Paths with Float (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE2_WEB.md §4:
 *   Calendar: Mon-Fri, no exceptions, project start Mon 2026-01-05.
 *   A(d2); B: FS after A, d10; C: FS after A, d3; D: FS after C, d4;
 *   E: FS after B and FS after D, d1.
 *
 *   Expected:
 *     A: ES Jan 5,  EF Jan 6,  TF 0, critical
 *     B: ES Jan 7,  EF Jan 20, TF 0, critical
 *     C: ES Jan 7,  EF Jan 9,  TF 3
 *     D: ES Jan 12, EF Jan 15, TF 3 (LS Jan 15)
 *     E: ES Jan 21, EF Jan 21, TF 0, critical
 *     project finish Jan 21 · critical path A → B → E
 *
 * Hand-derived index map (Mon-Fri, start = Jan 5 2026):
 *   1:Jan5 2:Jan6 3:Jan7 4:Jan8 5:Jan9 6:Jan12 7:Jan13 8:Jan14 9:Jan15
 *   10:Jan16 11:Jan19 12:Jan20 13:Jan21
 *
 * Authoritative — NEVER edit expected values.
 */

import { describe, it, expect } from "vitest";
import { computeSchedule } from "@domain/scheduling/cpm";
import type { NetworkInput } from "@shared/schemas/scheduling/network";

const monFri = {
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  },
  exceptions: [],
};

const network: NetworkInput = {
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

describe("GT-P2 — Parallel Paths with Float (authoritative)", () => {
  const result = computeSchedule(network);

  it("returns success", () => {
    expect(result.kind).toBe("success");
  });

  if (result.kind !== "success") return;

  const a = result.activities.find((x) => x.id === "A")!;
  const b = result.activities.find((x) => x.id === "B")!;
  const c = result.activities.find((x) => x.id === "C")!;
  const d = result.activities.find((x) => x.id === "D")!;
  const e = result.activities.find((x) => x.id === "E")!;

  it("A: ES Jan 5, EF Jan 6, TF 0, critical", () => {
    expect(a.es).toBe("2026-01-05");
    expect(a.ef).toBe("2026-01-06");
    expect(a.totalFloat).toBe(0);
    expect(a.isCritical).toBe(true);
  });

  it("B: ES Jan 7, EF Jan 20, TF 0, critical (the long path)", () => {
    expect(b.es).toBe("2026-01-07");
    expect(b.ef).toBe("2026-01-20");
    expect(b.totalFloat).toBe(0);
    expect(b.isCritical).toBe(true);
  });

  it("C: ES Jan 7, EF Jan 9, TF 3 (off the critical path)", () => {
    expect(c.es).toBe("2026-01-07");
    expect(c.ef).toBe("2026-01-09");
    expect(c.totalFloat).toBe(3);
    expect(c.isCritical).toBe(false);
  });

  it("D: ES Jan 12, EF Jan 15, TF 3 (LS Jan 15 — late start equals early start + float)", () => {
    expect(d.es).toBe("2026-01-12");
    expect(d.ef).toBe("2026-01-15");
    expect(d.totalFloat).toBe(3);
    // LS = ES + TF → index 6 + 3 = index 9 → Jan 15.
    expect(d.ls).toBe("2026-01-15");
    expect(d.isCritical).toBe(false);
  });

  it("E: ES Jan 21, EF Jan 21, TF 0, critical (driven by B's long path)", () => {
    expect(e.es).toBe("2026-01-21");
    expect(e.ef).toBe("2026-01-21");
    expect(e.totalFloat).toBe(0);
    expect(e.isCritical).toBe(true);
  });

  it("project finish = Jan 21", () => {
    expect(result.projectFinishDate).toBe("2026-01-21");
  });

  it("critical path = A → B → E", () => {
    expect(result.criticalPath).toEqual(["A", "B", "E"]);
  });

  it("no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});
