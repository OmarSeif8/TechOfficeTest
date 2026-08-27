/**
 * Calendar Domain — pure date / working-day-index arithmetic.
 *
 * Implements BR-P5..P7 from SPEC_PHASE2_WEB.md §3.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (and stdlib).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-p*.test.ts):
 *   - BR-P1: NO JS Date objects in the domain. All date math is integer arithmetic
 *            on proleptic-Gregorian ordinals derived from ISO yyyy-MM-dd strings.
 *   - BR-P2: Pure functions. Same input → byte-identical output.
 *   - BR-P5: isWorking(d): exception beats mask, both directions.
 *   - BR-P6: validateCalendar rejects masks with zero working weekdays.
 *   - BR-P7: Working-day index model — every working date maps to a 1-based index;
 *            all engine arithmetic happens in indices; dates convert at the boundary.
 *   - BR-P8: Open-start activities snap to the first working day ≥ project start.
 *
 * Working-day index model (BR-P7):
 *   Given calendar mask = Mon-Fri working, projectStart = 2026-01-05 (Mon):
 *     DATE:     Jan 5  Jan 6  Jan 7  Jan 8  Jan 9  Jan 12  Jan 13  ...
 *     Weekday:  Mon    Tue    Wed    Thu    Fri    Mon     Tue     ...
 *     Index:    1      2      3      4      5      6       7       ...
 *   Jan 10-11 are Sat-Sun → skipped (not in the index sequence).
 */

import type {
  Calendar,
  WeekdayMask,
} from "@shared/schemas/scheduling/calendar";

// ─── Pure Gregorian date arithmetic (BR-P1: no JS Date) ──────────────────
//
// Howard Hinnant's date algorithm — pure integer math on proleptic Gregorian.
// Reference: https://howardhinnant.github.io/date_algorithms.html
// All formulas verified against known anchors (1970-01-01 = Thursday).

/**
 * Convert a (year, month, day) proleptic Gregorian date to a day count
 * (days since 1970-01-01, which is itself day 0).
 *
 * month is 1..12, day is 1..31. Output is signed integer (negative for pre-1970).
 */
function daysFromCivil(year: number, month: number, day: number): number {
  // month is 1..12; convert to "March-based" form (Mar=1, ..., Feb=12)
  // so January and February belong to the previous "civil year".
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // year of era, [0, 399]
  const m = month > 2 ? month - 3 : month + 9; // March-based, [0, 11]
  const doy =
    Math.floor((153 * m + 2) / 5) + day - 1; // day of year (Mar 1 = 0)
  const doe =
    yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // day of era
  return era * 146097 + doe - 719468; // 719468 = daysFromCivil(1970, 1, 1)
}

/**
 * Inverse: convert day count → { year, month, day } proleptic Gregorian.
 */
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  const year = month <= 2 ? y + 1 : y;
  return { year, month, day: d };
}

/**
 * Weekday for a day count.
 *
 * 1970-01-01 was a Thursday. In our convention:
 *   0 = Sunday, 1 = Monday, 2 = Tuesday, ..., 6 = Saturday.
 * So weekday(z) = (z + 4) mod 7, normalized to [0, 6] (handles negative z).
 */
function weekdayFromDays(z: number): number {
  return ((z % 7) + 7 + 4) % 7;
}

// ─── ISO date parsing / formatting ─────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an ISO yyyy-MM-dd string into a day count (days since 1970-01-01).
 * @throws Error if the string is not a valid ISO date.
 */
export function parseIsoDate(s: string): number {
  const m = ISO_DATE_RE.exec(s);
  if (!m) {
    throw new Error(`Invalid ISO date (expected yyyy-MM-dd): "${s}"`);
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  // Range-check the date by round-tripping through civilFromDays.
  const z = daysFromCivil(year, month, day);
  const back = civilFromDays(z);
  if (back.year !== year || back.month !== month || back.day !== day) {
    throw new Error(`Invalid calendar date: "${s}"`);
  }
  return z;
}

/**
 * Format a day count as ISO yyyy-MM-dd.
 */
export function formatIsoDate(z: number): string {
  const { year, month, day } = civilFromDays(z);
  const y = year < 0 ? `-${String(-year).padStart(4, "0")}` : String(year).padStart(4, "0");
  const mo = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * Add `deltaDays` (signed integer) to an ISO date. Returns a new ISO date.
 */
export function addDays(iso: string, deltaDays: number): string {
  return formatIsoDate(parseIsoDate(iso) + deltaDays);
}

// ─── Calendar predicates ───────────────────────────────────────────────────

/**
 * BR-P5: isWorking(d): exception beats mask, both directions.
 *
 * @param calendar  the project calendar (mask + exceptions)
 * @param dateStr   ISO yyyy-MM-dd
 * @returns true if `dateStr` is a working day per the calendar.
 */
export function isWorking(calendar: Calendar, dateStr: string): boolean {
  // Exceptions take precedence (BR-P5). Linear scan — exception lists are small.
  for (const ex of calendar.exceptions) {
    if (ex.date === dateStr) return ex.isWorking;
  }
  // Otherwise consult the weekday mask.
  return isWorkingByMask(calendar.mask, dateStr);
}

/**
 * Internal: weekday-mask lookup (no exception precedence).
 */
function isWorkingByMask(mask: WeekdayMask, dateStr: string): boolean {
  const z = parseIsoDate(dateStr);
  const wd = weekdayFromDays(z); // 0=Sun .. 6=Sat
  switch (wd) {
    case 0: return mask.sunday;
    case 1: return mask.monday;
    case 2: return mask.tuesday;
    case 3: return mask.wednesday;
    case 4: return mask.thursday;
    case 5: return mask.friday;
    case 6: return mask.saturday;
    default: return false; // unreachable
  }
}

// ─── Working-day index conversion (BR-P7, BR-P8) ──────────────────────────

/**
 * Map a calendar date to its 1-based working-day index in the schedule.
 *
 * The first working day on or after `startDateStr` is index 1 (BR-P8: project
 * start may itself be a non-working day; the engine snaps to the next working day).
 *
 * @returns 1-based index if `dateStr` is a working day ≥ the first working day
 *          of the schedule; null otherwise (dateStr is a non-working day or
 *          precedes the schedule's first working day).
 */
export function getWorkingDayIndex(
  calendar: Calendar,
  startDateStr: string,
  dateStr: string,
): number | null {
  const startZ = parseIsoDate(startDateStr);
  const targetZ = parseIsoDate(dateStr);
  if (targetZ < startZ) return null;

  // Walk forward from startZ; the first working day becomes index 1.
  let z = startZ;
  let index = 0;
  // Cap iterations at a 50-year horizon — defensive, but the algorithm is O(n).
  const maxIter = 366 * 50;
  for (let i = 0; i < maxIter; i++) {
    const iso = formatIsoDate(z);
    if (isWorking(calendar, iso)) {
      index += 1;
      if (z === targetZ) return index;
      if (z > targetZ) return null; // target was a non-working day between indices
    }
    if (z > targetZ) return null;
    z += 1;
  }
  return null;
}

/**
 * Reverse of getWorkingDayIndex: given a 1-based working-day index, return the
 * ISO date of the index-th working day on or after `startDateStr`.
 *
 * Per BR-P15, the engine MAY compute a negative ES index (negative lag pushed
 * it before project start). To support that case without crashing, this
 * function accepts any signed integer:
 *   - index ≥ 1: forward walk from `startDateStr` (index 1 = first working day ≥ start).
 *   - index ≤ 0: backward walk from the day BEFORE `startDateStr`
 *     (index 0 = the working day immediately before index 1;
 *      index -1 = the working day before that; etc.).
 *
 * @param index any integer (positive, zero, or negative)
 * @throws Error if no working day exists within 50 years (calendar mask is all-off,
 *         which should have been rejected by validateCalendar upstream).
 */
export function indexToDate(
  calendar: Calendar,
  startDateStr: string,
  index: number,
): string {
  if (!Number.isInteger(index)) {
    throw new Error(`indexToDate: index must be an integer (got ${index})`);
  }
  const maxIter = 366 * 50;

  if (index >= 1) {
    let z = parseIsoDate(startDateStr);
    let remaining = index;
    for (let i = 0; i < maxIter; i++) {
      const iso = formatIsoDate(z);
      if (isWorking(calendar, iso)) {
        remaining -= 1;
        if (remaining === 0) return iso;
      }
      z += 1;
    }
    throw new Error(
      `indexToDate: no working day at index ${index} within 50 years of ${startDateStr}`,
    );
  }

  // index ≤ 0: walk backward from the day before startDateStr.
  // index = 0 → 1 working day back; index = -1 → 2; etc.
  let z = parseIsoDate(startDateStr) - 1;
  let remaining = 1 - index;
  for (let i = 0; i < maxIter; i++) {
    const iso = formatIsoDate(z);
    if (isWorking(calendar, iso)) {
      remaining -= 1;
      if (remaining === 0) return iso;
    }
    z -= 1;
  }
  throw new Error(
    `indexToDate: no working day at index ${index} within 50 years before ${startDateStr}`,
  );
}

// ─── Calendar validation (BR-P6) ───────────────────────────────────────────

/**
 * Validate a calendar per BR-P6.
 *
 * @returns array of error message strings. Empty array means the calendar is valid.
 */
export function validateCalendar(calendar: Calendar): string[] {
  const errors: string[] = [];
  const m = calendar.mask;
  const hasAnyWorking =
    m.monday || m.tuesday || m.wednesday || m.thursday || m.friday || m.saturday || m.sunday;
  if (!hasAnyWorking) {
    errors.push("mask must have ≥ 1 working weekday");
  }

  // Exception dates must be valid ISO yyyy-MM-dd and unique.
  const seen = new Set<string>();
  for (const ex of calendar.exceptions) {
    if (!ISO_DATE_RE.test(ex.date)) {
      errors.push(`exception date "${ex.date}" is not a valid ISO yyyy-MM-dd date`);
      continue;
    }
    try {
      parseIsoDate(ex.date);
    } catch (e) {
      errors.push(`exception date "${ex.date}" is not a valid calendar date`);
      continue;
    }
    if (seen.has(ex.date)) {
      errors.push(`duplicate exception date "${ex.date}"`);
    }
    seen.add(ex.date);
  }

  return errors;
}
