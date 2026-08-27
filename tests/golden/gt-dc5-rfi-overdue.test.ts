/**
 * GT-DC5 — RFI Overdue (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   RFI sent 2026-03-01, period 7d, still open, asOf 2026-03-10
 *   Expected: Overdue, 2 days.
 *   Same RFI answered 2026-03-09 → not overdue, status answered
 *
 * This test exercises:
 *   - `calculateDueDate("2026-03-01", 7) === "2026-03-08"`
 *   - `isFinalRfiStatus("OPEN") === false`
 *   - `isOverdue("2026-03-10", "2026-03-08", "OPEN", false) === true`
 *   - `daysOverdue("2026-03-10", "2026-03-08", "OPEN", false) === 2`
 *   - `isFinalRfiStatus("ANSWERED") === true`
 *   - Once ANSWERED on 2026-03-09: not overdue on 2026-03-10 (even though past due)
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import {
  calculateDueDate,
  daysOverdue,
  isOverdue,
} from "@domain/doccontrol/overdue";
import { isFinalRfiStatus } from "@domain/doccontrol/status-workflow";
import type { RfiInput } from "@shared/schemas/doccontrol/entities";

describe("GT-DC5 — RFI overdue (authoritative)", () => {
  const sentDate = "2026-03-01";
  const reviewPeriodDays = 7;

  // BR-DC6: due = sent + review period (calendar days).
  // Mar 1 + 7 = Mar 8.
  const dueDate = calculateDueDate(sentDate, reviewPeriodDays);

  it("due = 2026-03-08 (sent 2026-03-01 + 7 calendar days)", () => {
    expect(dueDate).toBe("2026-03-08");
  });

  // Scenario 1: RFI still open, asOf 2026-03-10.
  it("asOf 2026-03-10, OPEN → overdue, 2 days", () => {
    const status = "OPEN";
    const isFinal = isFinalRfiStatus(status);
    expect(isFinal).toBe(false);
    expect(isOverdue("2026-03-10", dueDate, status, isFinal)).toBe(true);
    // Mar 10 − Mar 8 = 2 days.
    expect(daysOverdue("2026-03-10", dueDate, status, isFinal)).toBe(2);
  });

  // Scenario 2: same RFI answered on 2026-03-09 → status ANSWERED → not overdue.
  const answered: RfiInput = {
    projectId: "project-1",
    ref: "RFI-001",
    questionEn: "What is the required cover for slab reinforcement?",
    linkedDrawingId: null,
    sentDate,
    reviewPeriodDays,
    answerEn: "30mm cover as per spec section 3.2",
    answerAr: null,
    answerDate: "2026-03-09",
    status: "ANSWERED",
  };

  it("ANSWERED is final (BR-DC7)", () => {
    expect(isFinalRfiStatus(answered.status)).toBe(true);
  });

  it("answered 2026-03-09 → not overdue even on 2026-03-10 (asOf > due but status is final)", () => {
    const isFinal = isFinalRfiStatus(answered.status);
    expect(isFinal).toBe(true);
    // asOf 2026-03-10 > due 2026-03-08, but status is ANSWERED → final → not overdue.
    expect(isOverdue("2026-03-10", dueDate, answered.status, isFinal)).toBe(
      false,
    );
    expect(daysOverdue("2026-03-10", dueDate, answered.status, isFinal)).toBe(0);
  });

  it("asOf 2026-03-09 (answer date, == day after due) — still not overdue because ANSWERED is final", () => {
    // Mar 9 > Mar 8, so without the final-status exclusion it would be 1 day overdue.
    // But ANSWERED is final → never overdue.
    const isFinal = isFinalRfiStatus(answered.status);
    expect(isOverdue("2026-03-09", dueDate, answered.status, isFinal)).toBe(
      false,
    );
    expect(daysOverdue("2026-03-09", dueDate, answered.status, isFinal)).toBe(
      0,
    );
  });

  // Sanity: CANCELLED is also terminal — never overdue.
  it("CANCELLED is terminal — never overdue", () => {
    const isFinal = isFinalRfiStatus("CANCELLED");
    expect(isFinal).toBe(true);
    expect(isOverdue("2026-03-10", dueDate, "CANCELLED", isFinal)).toBe(false);
  });

  // Sanity: CLOSED is terminal — never overdue.
  it("CLOSED is terminal — never overdue", () => {
    const isFinal = isFinalRfiStatus("CLOSED");
    expect(isFinal).toBe(true);
    expect(isOverdue("2026-03-10", dueDate, "CLOSED", isFinal)).toBe(false);
  });
});
