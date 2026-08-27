/**
 * GT-P3 — SS and FF Relationships (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE2_WEB.md §4:
 *   Calendar: Mon-Fri, no exceptions, project start Mon 2026-01-05.
 *   A(d10); B: SS from A lag 2, d5; C: FF from A lag 0, d3;
 *   D: FS from B and FS from C, d2.
 *
 *   Expected:
 *     A: ES Jan 5,  EF Jan 16, TF 0, critical
 *     B: ES Jan 7,  EF Jan 13, TF 3 (LS Jan 12)
 *     C: ES Jan 14, EF Jan 16, TF 0, critical
 *     D: ES Jan 19, EF Jan 20, TF 0, critical
 *     project finish Jan 20 · critical path A → (FF) → C → D
 *
 * Hand-derived index map (Mon-Fri, start = Jan 5 2026):
 *   1:Jan5 2:Jan6 3:Jan7 4:Jan8 5:Jan9 6:Jan12 7:Jan13 8:Jan14 9:Jan15
 *   10:Jan16 11:Jan19 12:Jan20
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
    { id: "A", code: "A", duration: 10, type: "TASK" },
    { id: "B", code: "B", duration: 5,  type: "TASK" },
    { id: "C", code: "C", duration: 3,  type: "TASK" },
    { id: "D", code: "D", duration: 2,  type: "TASK" },
  ],
  relationships: [
    { predecessorId: "A", successorId: "B", type: "SS", lag: 2 },
    { predecessorId: "A", successorId: "C", type: "FF", lag: 0 },
    { predecessorId: "B", successorId: "D", type: "FS", lag: 0 },
    { predecessorId: "C", successorId: "D", type: "FS", lag: 0 },
  ],
};

describe("GT-P3 — SS and FF Relationships (authoritative)", () => {
  const result = computeSchedule(network);

  it("returns success", () => {
    expect(result.kind).toBe("success");
  });

  if (result.kind !== "success") return;

  const a = result.activities.find((x) => x.id === "A")!;
  const b = result.activities.find((x) => x.id === "B")!;
  const c = result.activities.find((x) => x.id === "C")!;
  const d = result.activities.find((x) => x.id === "D")!;

  it("A: ES Jan 5, EF Jan 16, TF 0, critical", () => {
    expect(a.es).toBe("2026-01-05");
    expect(a.ef).toBe("2026-01-16");
    expect(a.totalFloat).toBe(0);
    expect(a.isCritical).toBe(true);
  });

  it("B: ES Jan 7, EF Jan 13, TF 3 (LS Jan 12 — driven by SS lag 2)", () => {
    expect(b.es).toBe("2026-01-07");
    expect(b.ef).toBe("2026-01-13");
    expect(b.totalFloat).toBe(3);
    expect(b.ls).toBe("2026-01-12");
    expect(b.isCritical).toBe(false);
  });

  it("C: ES Jan 14, EF Jan 16, TF 0, critical (driven by FF from A)", () => {
    expect(c.es).toBe("2026-01-14");
    expect(c.ef).toBe("2026-01-16");
    expect(c.totalFloat).toBe(0);
    expect(c.isCritical).toBe(true);
  });

  it("D: ES Jan 19, EF Jan 20, TF 0, critical", () => {
    expect(d.es).toBe("2026-01-19");
    expect(d.ef).toBe("2026-01-20");
    expect(d.totalFloat).toBe(0);
    expect(d.isCritical).toBe(true);
  });

  it("project finish = Jan 20", () => {
    expect(result.projectFinishDate).toBe("2026-01-20");
  });

  it("critical path = A → C → D (via the FF edge A→C)", () => {
    expect(result.criticalPath).toEqual(["A", "C", "D"]);
  });

  it("no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});
