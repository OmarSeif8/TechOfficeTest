/**
 * Payments — Variation schemas.
 *
 * Pure zod schemas for Variation entities (Phase 4B contract variations).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only zod + stdlib.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Per BR-1 — all money/percent values are strings (decimal.js on the domain side).
 */

import { z } from "zod";

/**
 * Variation status (mirrors Prisma `Variation.status`).
 *
 *   - DRAFT:     variation is being prepared.
 *   - SUBMITTED: variation has been submitted for approval.
 *   - APPROVED:  variation has been approved; `approvedValue` is set.
 *   - REJECTED:  variation has been rejected.
 */
export const VariationStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);
export type VariationStatus = z.infer<typeof VariationStatusSchema>;
