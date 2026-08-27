/**
 * GT-P6 — Cycle Rejection (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE2_WEB.md §4:
 *   A FS→ B, B SS→ A.
 *   Engine returns {kind: 'cycle'} naming A and B, terminates immediately,
 *   and produces no dates.
 *
 * Per BR-P14: cycles are rejected, never traversed. The engine returns a
 * structured error listing the cycle's activity IDs, then halts.
 *
 * Authoritative — NEVER edit expected values.
 */

import { describe, it, expect } from "vitest";
import { computeSchedule } from "@domain/scheduling/cpm";
import { detectCycle } from "@domain/scheduling/cycle-detection";
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
    { id: "A", code: "A", duration: 3, type: "TASK" },
    { id: "B", code: "B", duration: 2, type: "TASK" },
  ],
  relationships: [
    { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
    { predecessorId: "B", successorId: "A", type: "SS", lag: 0 },
  ],
};

describe("GT-P6 — Cycle Rejection (authoritative)", () => {
  const result = computeSchedule(network);

  it("returns kind 'cycle'", () => {
    expect(result.kind).toBe("cycle");
  });

  if (result.kind !== "cycle") return;

  it("names both A and B in the cycle (order may vary, both must be present)", () => {
    expect(result.cycleActivityIds).toContain("A");
    expect(result.cycleActivityIds).toContain("B");
    expect(result.cycleActivityIds.length).toBe(2);
  });

  it("produces no dates (no activities, no projectFinishDate, no criticalPath)", () => {
    // The cycle result variant has ONLY {kind, cycleActivityIds} — by construction
    // of the ScheduleResult type, dates cannot leak. Verify the shape:
    expect(Object.keys(result)).toEqual(["kind", "cycleActivityIds"]);
  });

  it("direct detectCycle call also returns the cycle", () => {
    const cycle = detectCycle(network.activities, network.relationships);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("A");
    expect(cycle).toContain("B");
  });

  it("terminates immediately (no exception, no hang)", () => {
    // The fact that computeSchedule returned a value at all proves termination.
    // (If it had hung or thrown, this test would not reach the assertion.)
    expect(result).toBeDefined();
  });
});

describe("GT-P6 — additional cycle shapes (defensive coverage)", () => {
  it("self-loop is rejected at validation, not as a cycle (BR-P16: no self-relationship)", () => {
    const selfLoopNetwork: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 3, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "A", successorId: "A", type: "FS", lag: 0 },
      ],
    };
    const r = computeSchedule(selfLoopNetwork);
    // BR-P16: self-relationships are validation errors, not cycles.
    expect(r.kind).toBe("validation");
    if (r.kind === "validation") {
      expect(r.errors.some((e) => e.code === "SELF_RELATIONSHIP")).toBe(true);
    }
  });

  it("3-node cycle A → B → C → A is detected", () => {
    const cycle3: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
        { id: "B", code: "B", duration: 1, type: "TASK" },
        { id: "C", code: "C", duration: 1, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
        { predecessorId: "B", successorId: "C", type: "FS", lag: 0 },
        { predecessorId: "C", successorId: "A", type: "FS", lag: 0 },
      ],
    };
    const r = computeSchedule(cycle3);
    expect(r.kind).toBe("cycle");
    if (r.kind === "cycle") {
      // All three nodes must be named.
      expect(new Set(r.cycleActivityIds)).toEqual(new Set(["A", "B", "C"]));
    }
  });

  it("acyclic network does NOT trigger cycle detection", () => {
    const acyclic: NetworkInput = {
      projectStart: "2026-01-05",
      calendar: monFri,
      activities: [
        { id: "A", code: "A", duration: 1, type: "TASK" },
        { id: "B", code: "B", duration: 1, type: "TASK" },
      ],
      relationships: [
        { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
      ],
    };
    const r = computeSchedule(acyclic);
    expect(r.kind).toBe("success");
  });
});
