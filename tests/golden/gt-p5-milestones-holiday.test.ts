/**
 * GT-P5 — Milestones + Holiday Exception (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE2_WEB.md §4:
 *   Calendar: Mon–Fri except Wed Jan 7 = holiday.
 *   M1 start milestone (d0) at project start; A: FS from M1, d3;
 *   M2 finish milestone: FS from A (d0).
 *
 *   Expected:
 *     M1: ES = EF = Jan 5
 *     A:  ES Jan 6, EF Jan 9 (working days Jan 6, 8, 9 — the 7th is skipped)
 *     M2: ES = EF = Jan 12
 *     all critical · project finish Jan 12
 *
 * Hand-derived index map (Mon-Fri, Wed Jan 7 = holiday):
 *   Index 1: Jan 5 (Mon)    Index 4: Jan 9 (Fri)
 *   Index 2: Jan 6 (Tue)    Index 5: Jan 12 (Mon)
 *   Index 3: Jan 8 (Thu)    ← Jan 7 (Wed) is a holiday → skipped
 *
 * Authoritative — NEVER edit expected values.
 */

import { describe, it, expect } from "vitest";
import { computeSchedule } from "@domain/scheduling/cpm";
import type { NetworkInput } from "@shared/schemas/scheduling/network";

const monFriJan7Holiday = {
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  },
  exceptions: [
    { date: "2026-01-07", isWorking: false, nameEn: "Holiday on Wed Jan 7" },
  ],
};

const network: NetworkInput = {
  projectStart: "2026-01-05",
  calendar: monFriJan7Holiday,
  activities: [
    { id: "M1", code: "M1", duration: 0, type: "MILESTONE" },
    { id: "A",  code: "A",  duration: 3, type: "TASK" },
    { id: "M2", code: "M2", duration: 0, type: "MILESTONE" },
  ],
  relationships: [
    { predecessorId: "M1", successorId: "A",  type: "FS", lag: 0 },
    { predecessorId: "A",  successorId: "M2", type: "FS", lag: 0 },
  ],
};

describe("GT-P5 — Milestones + Holiday Exception (authoritative)", () => {
  const result = computeSchedule(network);

  it("returns success", () => {
    expect(result.kind).toBe("success");
  });

  if (result.kind !== "success") return;

  const m1 = result.activities.find((x) => x.id === "M1")!;
  const a  = result.activities.find((x) => x.id === "A")!;
  const m2 = result.activities.find((x) => x.id === "M2")!;

  it("M1: start milestone — ES = EF = Jan 5 (BR-P3: dur=0 → ES=EF)", () => {
    expect(m1.es).toBe("2026-01-05");
    expect(m1.ef).toBe("2026-01-05");
    // Index space: ES = EF = 1 (open-start activity snaps to first working day).
    expect(m1.esIndex).toBe(1);
    expect(m1.efIndex).toBe(1);
  });

  it("A: ES Jan 6, EF Jan 9 (spans 3 working days: Jan 6, Jan 8, Jan 9 — Jan 7 holiday skipped)", () => {
    expect(a.es).toBe("2026-01-06");
    expect(a.ef).toBe("2026-01-09");
    // Index space: ES=2 (Jan 6), EF=4 (Jan 9).
    expect(a.esIndex).toBe(2);
    expect(a.efIndex).toBe(4);
  });

  it("M2: finish milestone — ES = EF = Jan 12 (FS from A pushes to next working day after A's EF)", () => {
    expect(m2.es).toBe("2026-01-12");
    expect(m2.ef).toBe("2026-01-12");
    // Index space: ES = EF = 5.
    expect(m2.esIndex).toBe(5);
    expect(m2.efIndex).toBe(5);
  });

  it("all critical (TF = 0)", () => {
    expect(m1.totalFloat).toBe(0);
    expect(a.totalFloat).toBe(0);
    expect(m2.totalFloat).toBe(0);
    expect(m1.isCritical).toBe(true);
    expect(a.isCritical).toBe(true);
    expect(m2.isCritical).toBe(true);
  });

  it("project finish = Jan 12", () => {
    expect(result.projectFinishDate).toBe("2026-01-12");
    expect(result.projectFinishIndex).toBe(5);
  });

  it("critical path = M1 → A → M2", () => {
    expect(result.criticalPath).toEqual(["M1", "A", "M2"]);
  });

  it("BR-P5: holiday exception is honored (Jan 7 skipped) — no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});
