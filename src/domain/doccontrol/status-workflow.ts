/**
 * Document Control — Status Workflow (BR-DC3..DC5, BR-DC7, BR-DC8).
 *
 * Pure functions for status transitions and the "final" classification that
 * drives overdue logic.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dc1-drawing-revisions.test.ts,
 * tests/golden/gt-dc2-submittal-overdue.test.ts, tests/golden/gt-dc5-rfi-overdue.test.ts):
 *
 *   - BR-DC3: Adding rev N+1 auto-supersedes the current revision. The new
 *             revision starts as ISSUED (because BR-DC3 requires an attached
 *             file on the new revision). GT-DC1 verifies rev A (issued) + rev B
 *             → A=superseded, B=issued.
 *
 *   - BR-DC4: Drawing statuses — preliminary → issued →
 *             approved-for-construction; superseded / obsolete are terminal.
 *
 *   - BR-DC5: Submittal statuses — draft → submitted → under-review →
 *             approved / approved-with-comments / rejected / revise-resubmit.
 *             Final = approved / approved-with-comments / rejected.
 *
 *   - BR-DC7: RFI statuses — open → answered → closed; cancelled terminal.
 *             Answering sets answer text + answer date. For overdue purposes,
 *             ANSWERED is final (the question has been answered — see GT-DC5).
 *
 *   - BR-DC8: Every status change writes an append-only event row. The actual
 *             event-row construction lives in the service/repository layer;
 *             this module only defines the legality of transitions.
 */

import type {
  DrawingStatus,
  RfiStatus,
  SubmittalStatus,
} from "@shared/schemas/doccontrol/entities";

// ─── Drawing status (BR-DC4) ─────────────────────────────────────────────
//
// preliminary → issued → approved-for-construction
// preliminary | issued | approved-for-construction → superseded (by new rev)
// preliminary | issued | approved-for-construction → obsolete (manual withdrawal)
// superseded → obsolete (rare but legal — explicit retirement of a superseded rev)
// OBSOLETE is terminal.

const DRAWING_TRANSITIONS: Record<DrawingStatus, readonly DrawingStatus[]> = {
  PRELIMINARY: ["ISSUED", "APPROVED_FOR_CONSTRUCTION", "SUPERSEDED", "OBSOLETE"],
  ISSUED: ["APPROVED_FOR_CONSTRUCTION", "SUPERSEDED", "OBSOLETE"],
  APPROVED_FOR_CONSTRUCTION: ["SUPERSEDED", "OBSOLETE"],
  SUPERSEDED: ["OBSOLETE"],
  OBSOLETE: [], // terminal
};

/**
 * Whether the drawing-status transition `from` → `to` is legal per BR-DC4.
 *
 * Examples:
 *   - PRELIMINARY → ISSUED                  ✓
 *   - ISSUED → APPROVED_FOR_CONSTRUCTION    ✓
 *   - APPROVED_FOR_CONSTRUCTION → SUPERSEDED ✓ (when a new revision is added)
 *   - OBSOLETE → anything                   ✗ (terminal)
 *   - SUPERSEDED → ISSUED                   ✗ (no resurrection — must add new rev)
 */
export function canTransitionDrawingStatus(
  from: DrawingStatus,
  to: DrawingStatus,
): boolean {
  const allowed = DRAWING_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

// ─── Submittal status (BR-DC5) ───────────────────────────────────────────
//
// draft → submitted → under-review →
//   approved | approved-with-comments | rejected | revise-resubmit
//
// REVISE_RESUBMIT cycles back to SUBMITTED (resubmission — increments
// resubmissionNo, see GT-DC4).
//
// Final = approved | approved-with-comments | rejected
// (REVISE_RESUBMIT is NOT final — it means the reviewer asked for changes;
//  the submittal is still alive, awaiting resubmission. It is, however,
//  exempt from overdue since the original submission cycle ended with a
//  decision — see `isFinalSubmittalStatus` doc below.)

const SUBMITTAL_TRANSITIONS: Record<
  SubmittalStatus,
  readonly SubmittalStatus[]
> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: [
    "UNDER_REVIEW",
    "APPROVED",
    "APPROVED_WITH_COMMENTS",
    "REJECTED",
    "REVISE_RESUBMIT",
  ],
  UNDER_REVIEW: [
    "APPROVED",
    "APPROVED_WITH_COMMENTS",
    "REJECTED",
    "REVISE_RESUBMIT",
  ],
  APPROVED: [], // final
  APPROVED_WITH_COMMENTS: [], // final
  REJECTED: [], // final
  REVISE_RESUBMIT: ["SUBMITTED"], // cycle back, becomes resubmission
};

/**
 * Whether the submittal-status transition `from` → `to` is legal per BR-DC5.
 *
 * Examples:
 *   - DRAFT → SUBMITTED                       ✓
 *   - SUBMITTED → UNDER_REVIEW                ✓
 *   - UNDER_REVIEW → APPROVED                 ✓ (final)
 *   - UNDER_REVIEW → REVISE_RESUBMIT          ✓
 *   - REVISE_RESUBMIT → SUBMITTED             ✓ (resubmission cycle)
 *   - APPROVED → anything                     ✗ (terminal)
 */
export function canTransitionSubmittalStatus(
  from: SubmittalStatus,
  to: SubmittalStatus,
): boolean {
  const allowed = SUBMITTAL_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

// ─── RFI status (BR-DC7) ─────────────────────────────────────────────────
//
// open → answered → closed
// open | answered → cancelled (terminal)
// closed | cancelled are terminal.

const RFI_TRANSITIONS: Record<RfiStatus, readonly RfiStatus[]> = {
  OPEN: ["ANSWERED", "CLOSED", "CANCELLED"],
  ANSWERED: ["CLOSED", "CANCELLED"],
  CLOSED: [], // terminal
  CANCELLED: [], // terminal
};

/**
 * Whether the RFI-status transition `from` → `to` is legal per BR-DC7.
 *
 * Examples:
 *   - OPEN → ANSWERED                          ✓
 *   - OPEN → CLOSED                            ✓ (direct close without answer)
 *   - ANSWERED → CLOSED                        ✓
 *   - OPEN | ANSWERED → CANCELLED              ✓ (terminal)
 *   - CLOSED → anything                        ✗
 */
export function canTransitionRfiStatus(
  from: RfiStatus,
  to: RfiStatus,
): boolean {
  const allowed = RFI_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

// ─── Final-state classification (drives overdue logic per BR-DC6) ────────

/**
 * Whether a submittal status is final per BR-DC5.
 *
 * Final = APPROVED | APPROVED_WITH_COMMENTS | REJECTED.
 *
 * REVISE_RESUBMIT is NOT in this set: the reviewer has asked for changes and
 * the submittal is awaiting resubmission, so its life cycle is not yet over.
 * However, REVISE_RESUBMIT also exempts the submittal from overdue logic —
 * the original submission cycle ended with a decision. The overdue module
 * treats REVISE_RESUBMIT as "non-final" (this function returns false) but the
 * caller passes the appropriate status to `isOverdue` which independently
 * excludes DRAFT and final statuses; REVISE_RESUBMIT falls through to the
 * "is it past due?" check, which is the desired behavior.
 *
 * (GT-DC2 verifies: APPROVED on 2026-01-21 → never overdue again.)
 */
export function isFinalSubmittalStatus(status: SubmittalStatus): boolean {
  return (
    status === "APPROVED" ||
    status === "APPROVED_WITH_COMMENTS" ||
    status === "REJECTED"
  );
}

/**
 * Whether an RFI status is final per BR-DC7.
 *
 * Final = ANSWERED | CLOSED | CANCELLED.
 *
 * For overdue purposes, ANSWERED counts as final because the question has
 * been answered (BR-DC7). GT-DC5 verifies: RFI answered 2026-03-09 → not
 * overdue on 2026-03-10 even though asOf > dueDate.
 */
export function isFinalRfiStatus(status: RfiStatus): boolean {
  return (
    status === "ANSWERED" ||
    status === "CLOSED" ||
    status === "CANCELLED"
  );
}

// ─── Revision supersede (BR-DC3) ─────────────────────────────────────────
//
// When a new revision is added, the current revision auto-supersedes:
//   old (current) revision  →  SUPERSEDED  (terminal)
//   new revision           →  ISSUED      (BR-DC3 requires a file attachment,
//                                           so the new revision is "issued" at
//                                           creation — per GT-DC1)
//
// The function takes the current revision string + new revision string to
// make the call site's intent explicit. The returned statuses are CONSTANT
// (do not depend on the inputs) — they encode the BR-DC3 rule directly.
// The parameters are accepted so the API is self-documenting and so a
// future stricter version can validate ordering.

/**
 * Compute the old + new statuses when a new revision supersedes the current one.
 *
 * Per BR-DC3 + GT-DC1:
 *   - Old (current) revision becomes SUPERSEDED.
 *   - New revision becomes ISSUED (BR-DC3 mandates a file attachment on new
 *     revisions, which implies "issued at creation").
 *
 * @param currentRevision The current revision letter being superseded (e.g. "A").
 * @param newRevision      The new revision letter being added (e.g. "B").
 * @returns `{ oldStatus: "SUPERSEDED", newStatus: "ISSUED" }` — constant
 *          regardless of inputs (BR-DC3 rule is unconditional).
 */
export function applyRevisionSuperseded(
  currentRevision: string,
  newRevision: string,
): { oldStatus: DrawingStatus; newStatus: DrawingStatus } {
  // Parameters accepted for API clarity. The rule is unconditional — see docstring.
  void currentRevision;
  void newRevision;
  return {
    oldStatus: "SUPERSEDED",
    newStatus: "ISSUED",
  };
}
