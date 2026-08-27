/**
 * Document Control — Overdue calculation (BR-DC1, BR-DC6).
 *
 * Pure functions for due-date + overdue logic. Per BR-DC6:
 *   - Due date = submitted date + review period (CALENDAR days, not working
 *     days — this is the deliberate Phase 3 simplification; Phase 2's working-
 *     day calendar logic lives in @domain/scheduling/calendar and is NOT
 *     reused here).
 *   - Submittal default review period = 14 days. RFI default = 7 days.
 *   - Overdue ⇔ asOf > dueDate AND status is non-final AND status != DRAFT.
 *   - daysOverdue = asOf − dueDate in calendar days (0 if not overdue).
 *
 * Per BR-DC1: ALL date-dependent functions take `asOf` as a parameter. There
 * is NO `Date.now()` or `new Date()` for "current time" anywhere in this
 * module. The UI supplies "today".
 *
 * Note on Date objects: this module uses `Date.UTC(...)` purely as a calendar-
 * arithmetic helper (converting yyyy-MM-dd strings to day numbers). This is
 * NOT the same as using `new Date()` for "the current time" — there is no
 * wall-clock dependency. The arithmetic is deterministic and timezone-safe
 * (always UTC midnight, no DST drift).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dc2-submittal-overdue.test.ts
 * and tests/golden/gt-dc5-rfi-overdue.test.ts):
 *   - GT-DC2: SUB-001 submitted 2026-01-05, 14d, under-review.
 *       Due 2026-01-19. asOf 2026-01-19 → not overdue. asOf 2026-01-20 →
 *       overdue, 1 day. Approve on 2026-01-21 → final, never overdue.
 *   - GT-DC5: RFI sent 2026-03-01, 7d, open.
 *       Due 2026-03-08. asOf 2026-03-10 → overdue, 2 days.
 *       Answered 2026-03-09 → not overdue (status final).
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse ISO yyyy-MM-dd into {y, m, d}. Returns null on malformed input. */
function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) return null;
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  // Defensive sanity check — month 1..12, day 1..31. (We don't enforce
  // per-month day limits; the Date.UTC fallback will normalize Feb 30 → Mar 2.)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Convert ISO yyyy-MM-dd to days since the Unix epoch (1970-01-01) in UTC.
 *
 * Returns null on malformed input. Day arithmetic on this value is exact —
 * 1 unit = exactly 1 calendar day. There is NO time-of-day component.
 *
 * @internal
 */
function toUnixDays(iso: string): number | null {
  const parsed = parseIso(iso);
  if (!parsed) return null;
  // Date.UTC handles month=1..12 via m-1. Days-out-of-range normalize
  // (e.g. Jan 32 → Feb 1) — but parseIso already rejects day>31.
  const ms = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

/**
 * Convert days-since-Unix-epoch (UTC) back to ISO yyyy-MM-dd.
 *
 * @internal
 */
function fromUnixDays(days: number): string {
  const ms = days * 86400000;
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the due date = submittedDate + reviewPeriodDays (calendar days).
 *
 * Per BR-DC6: arithmetic is in CALENDAR days, NOT working days. (Phase 3
 * simplification — see module header.)
 *
 * @throws if `submittedDate` is not a valid ISO yyyy-MM-dd string, or if
 *         `reviewPeriodDays` is not a finite integer.
 */
export function calculateDueDate(
  submittedDate: string,
  reviewPeriodDays: number,
): string {
  if (!Number.isInteger(reviewPeriodDays)) {
    throw new Error(
      `reviewPeriodDays must be an integer (got ${reviewPeriodDays})`,
    );
  }
  const startDays = toUnixDays(submittedDate);
  if (startDays === null) {
    throw new Error(
      `submittedDate must be ISO yyyy-MM-dd (got "${submittedDate}")`,
    );
  }
  return fromUnixDays(startDays + reviewPeriodDays);
}

/**
 * Whether an item is overdue as of `asOf`.
 *
 * Per BR-DC6:
 *   overdue ⇔ asOf > dueDate AND status is non-final AND status != "DRAFT".
 *
 * Returns false if `dueDate` is null (no submission yet, no due), or if the
 * status is final, or if the status is "DRAFT" (excluded per BR-DC6's "and
 * not draft" clause).
 *
 * The caller supplies `isFinal` (computed by the workflow module — see
 * `isFinalSubmittalStatus` / `isFinalRfiStatus`) — this keeps `overdue.ts`
 * decoupled from the workflow definitions.
 *
 * Per BR-DC1: `asOf` is the injected "today" — never Date.now().
 */
export function isOverdue(
  asOf: string,
  dueDate: string | null,
  status: string,
  isFinal: boolean,
): boolean {
  if (dueDate === null) return false;
  if (isFinal) return false;
  if (status === "DRAFT") return false;

  const asOfDays = toUnixDays(asOf);
  const dueDays = toUnixDays(dueDate);
  if (asOfDays === null || dueDays === null) return false;

  return asOfDays > dueDays;
}

/**
 * Calendar days overdue as of `asOf`.
 *
 * Per BR-DC6: daysOverdue = asOf − dueDate in calendar days.
 *
 * Returns 0 if not overdue (per `isOverdue`). Otherwise returns the positive
 * integer day count between dueDate and asOf (inclusive of asOf, exclusive
 * of dueDate — i.e. if due=Jan 19 and asOf=Jan 20, daysOverdue=1).
 *
 * Per BR-DC1: `asOf` is the injected "today".
 */
export function daysOverdue(
  asOf: string,
  dueDate: string | null,
  status: string,
  isFinal: boolean,
): number {
  // isOverdue already returns false for null dueDate, final, or DRAFT — so
  // by the time we reach the math, dueDate is non-null. But TS doesn't know
  // that, so we re-check defensively.
  if (dueDate === null) return 0;
  if (!isOverdue(asOf, dueDate, status, isFinal)) return 0;

  const asOfDays = toUnixDays(asOf);
  const dueDays = toUnixDays(dueDate);
  if (asOfDays === null || dueDays === null) return 0;

  return asOfDays - dueDays;
}
