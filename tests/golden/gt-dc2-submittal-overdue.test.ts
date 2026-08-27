/**
 * GT-DC2 — Submittal Overdue (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   SUB-001 submitted 2026-01-05, period 14d, status under-review
 *   Expected:
 *     - Due 2026-01-19
 *     - asOf 2026-01-19 → not overdue
 *     - asOf 2026-01-20 → overdue, 1 day
 *     - Approve on 2026-01-21 → final, never overdue again
 *
 * This test exercises:
 *   - `calculateDueDate("2026-01-05", 14) === "2026-01-19"` (BR-DC6 calendar days)
 *   - `isFinalSubmittalStatus("UNDER_REVIEW") === false`
 *   - `isOverdue("2026-01-19", "2026-01-19", "UNDER_REVIEW", false) === false`
 *   - `isOverdue("2026-01-20", "2026-01-19", "UNDER_REVIEW", false) === true`
 *   - `daysOverdue("2026-01-20", "2026-01-19", "UNDER_REVIEW", false) === 1`
 *   - `isFinalSubmittalStatus("APPROVED") === true`
 *   - Once APPROVED: `isOverdue(...)` always false (even past due date)
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
import { isFinalSubmittalStatus } from "@domain/doccontrol/status-workflow";

describe("GT-DC2 — Submittal overdue (authoritative)", () => {
  const submittedDate = "2026-01-05";
  const reviewPeriodDays = 14;
  const status = "UNDER_REVIEW";

  // BR-DC6: due = submitted + review period in CALENDAR days.
  const dueDate = calculateDueDate(submittedDate, reviewPeriodDays);

  it("due = 2026-01-19 (submitted 2026-01-05 + 14 calendar days)", () => {
    // Jan 5 + 14 = Jan 19. ✓ (NOT working-day arithmetic — calendar days per BR-DC6.)
    expect(dueDate).toBe("2026-01-19");
  });

  const isFinal = isFinalSubmittalStatus(status);

  it("UNDER_REVIEW is non-final (overdue can apply)", () => {
    expect(isFinal).toBe(false);
  });

  it("asOf 2026-01-19 (== dueDate) → not overdue (boundary is inclusive of due)", () => {
    // BR-DC6: overdue ⇔ asOf > due. Equal is not overdue.
    expect(isOverdue("2026-01-19", dueDate, status, isFinal)).toBe(false);
    expect(daysOverdue("2026-01-19", dueDate, status, isFinal)).toBe(0);
  });

  it("asOf 2026-01-20 (dueDate + 1) → overdue, 1 day", () => {
    expect(isOverdue("2026-01-20", dueDate, status, isFinal)).toBe(true);
    expect(daysOverdue("2026-01-20", dueDate, status, isFinal)).toBe(1);
  });

  it("Approve on 2026-01-21 → final, never overdue again", () => {
    const approvedStatus = "APPROVED";
    const approvedFinal = isFinalSubmittalStatus(approvedStatus);
    expect(approvedFinal).toBe(true);

    // Even though asOf (2026-01-22) > due (2026-01-19), since the status is
    // final, the submittal is NOT overdue — the cycle ended with a decision.
    expect(isOverdue("2026-01-22", dueDate, approvedStatus, approvedFinal)).toBe(
      false,
    );
    expect(
      daysOverdue("2026-01-22", dueDate, approvedStatus, approvedFinal),
    ).toBe(0);

    // Also test much later — still never overdue.
    expect(isOverdue("2027-12-31", dueDate, approvedStatus, approvedFinal)).toBe(
      false,
    );
  });
});
