/**
 * Document Control — Transmittal (BR-DC10, GT-DC6).
 *
 * Pure functions for transmittal line aggregation + validation.
 *
 * Per BR-DC10: a Transmittal = a Correspondence row with type=TRANSMITTAL +
 * N child TransmittalLine rows (doc ref, description, copies). The PDF form
 * footer shows total copies across all lines.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dc6-transmittal-copies.test.ts):
 *   - GT-DC6: 3 lines with copies 2/3/1 → total = 6 on the form.
 */

import type { TransmittalLineInput } from "@shared/schemas/doccontrol/entities";

/**
 * Sum the copies field across all transmittal lines.
 *
 * Per BR-DC10: this total appears on the transmittal PDF form footer.
 *
 * Empty list → 0. Lines with `copies < 0` (which the zod schema forbids) are
 * treated as 0 defensively.
 */
export function calculateTotalCopies(lines: TransmittalLineInput[]): number {
  return lines.reduce((sum, line) => {
    const c = line.copies ?? 0;
    return sum + (c > 0 ? c : 0);
  }, 0);
}

/**
 * Validate a transmittal's lines. Returns an array of error strings — empty
 * array means the lines are valid for PDF generation.
 *
 * Checks:
 *   1. At least one line must exist (BR-DC10 implies N ≥ 1).
 *   2. Each line must have a non-empty `docRef`.
 *   3. Each line must have a non-empty `descriptionEn`.
 *   4. Each line must have `copies ≥ 0` (negative is invalid).
 *   5. `sortOrder` values must be unique within the transmittal (no two
 *      lines can occupy the same slot — the form is rendered in sort order).
 *
 * These are logical validations (the zod schema enforces shape). The
 * function is pure — does not throw; the caller decides what to do with
 * the returned error list.
 */
export function validateTransmittal(lines: TransmittalLineInput[]): string[] {
  const errors: string[] = [];

  if (lines.length === 0) {
    errors.push("Transmittal must have at least one line");
    return errors;
  }

  const seenSortOrders = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `Line ${i + 1}`;

    if (!line.docRef || line.docRef.trim() === "") {
      errors.push(`${label}: docRef is required`);
    }

    if (!line.descriptionEn || line.descriptionEn.trim() === "") {
      errors.push(`${label}: descriptionEn is required`);
    }

    if (typeof line.copies !== "number" || !Number.isInteger(line.copies)) {
      errors.push(`${label}: copies must be an integer`);
    } else if (line.copies < 0) {
      errors.push(`${label}: copies must be non-negative (got ${line.copies})`);
    }

    if (typeof line.sortOrder !== "number" || !Number.isInteger(line.sortOrder)) {
      errors.push(`${label}: sortOrder must be an integer`);
    } else if (seenSortOrders.has(line.sortOrder)) {
      errors.push(
        `${label}: duplicate sortOrder ${line.sortOrder} (already used by an earlier line)`,
      );
    } else {
      seenSortOrders.add(line.sortOrder);
    }
  }

  return errors;
}
