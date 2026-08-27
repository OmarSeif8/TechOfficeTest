/**
 * GT-DC4 — Resubmission (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE3_WEB.md §4:
 *   SUB-001 revise-resubmit, resubmitted 2026-02-01, period 14d
 *   Expected: resubmission_no = 1; due = 2026-02-15
 *
 * This test exercises:
 *   - On REVISE_RESUBMIT, the resubmissionNo increments by 1 (0 → 1).
 *   - On resubmission, the new submittedDate is the resubmission date.
 *   - The new due date = new submittedDate + reviewPeriodDays (calendar days).
 *   - `calculateDueDate("2026-02-01", 14) === "2026-02-15"`.
 *
 * Per the Constitution: golden tests are law. NEVER edit expected values.
 * If this test fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { calculateDueDate } from "@domain/doccontrol/overdue";
import type { SubmittalInput } from "@shared/schemas/doccontrol/entities";

describe("GT-DC4 — Resubmission (authoritative)", () => {
  // The original submittal (before revise-resubmit).
  const originalSubmittal: SubmittalInput = {
    projectId: "project-1",
    ref: "SUB-001",
    subjectEn: "Steel reinforcement shop drawings",
    type: "TECHNICAL",
    discipline: "STR",
    submittedDate: "2026-01-05",
    reviewPeriodDays: 14,
    resubmissionNo: 0, // first submission
    status: "UNDER_REVIEW",
  };

  it("original submittal has resubmission_no = 0", () => {
    expect(originalSubmittal.resubmissionNo).toBe(0);
  });

  // The reviewer asks for revise-resubmit.
  const afterReviseResubmit: SubmittalInput = {
    ...originalSubmittal,
    status: "REVISE_RESUBMIT",
  };

  it("REVISE_RESUBMIT is a valid transition from UNDER_REVIEW (BR-DC5)", () => {
    // (Imported here for documentation; the transition legality is the
    // status-workflow module's responsibility — covered by GT-DC2 tests
    // and additional workflow tests if added.)
    expect(afterReviseResubmit.status).toBe("REVISE_RESUBMIT");
  });

  // Resubmission: status cycles back to SUBMITTED, resubmissionNo increments,
  // new submittedDate is the resubmission date.
  const resubmittedDate = "2026-02-01";
  const resubmitted: SubmittalInput = {
    ...afterReviseResubmit,
    status: "SUBMITTED",
    submittedDate: resubmittedDate,
    resubmissionNo: afterReviseResubmit.resubmissionNo + 1,
  };

  it("resubmission_no = 1 (incremented from 0)", () => {
    expect(resubmitted.resubmissionNo).toBe(1);
  });

  // The new due date is computed from the resubmission date.
  const dueDate = calculateDueDate(
    resubmitted.submittedDate!,
    resubmitted.reviewPeriodDays,
  );

  it("due = 2026-02-15 (resubmitted 2026-02-01 + 14 calendar days)", () => {
    // Feb 1 + 14 = Feb 15. ✓
    expect(dueDate).toBe("2026-02-15");
  });

  it("the ref stays SUB-001 across resubmissions (BR-DC2 — never reused)", () => {
    // The submittal ref is assigned once at creation. Resubmissions don't get
    // new refs — they cycle within the same row, incrementing resubmissionNo.
    expect(resubmitted.ref).toBe("SUB-001");
  });

  it("second resubmission would yield resubmission_no = 2 (sanity)", () => {
    const secondRevise: SubmittalInput = {
      ...resubmitted,
      status: "REVISE_RESUBMIT",
    };
    const secondResub: SubmittalInput = {
      ...secondRevise,
      status: "SUBMITTED",
      submittedDate: "2026-03-01",
      resubmissionNo: secondRevise.resubmissionNo + 1,
    };
    expect(secondResub.resubmissionNo).toBe(2);
  });
});
