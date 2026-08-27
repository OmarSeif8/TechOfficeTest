/**
 * Rate Analysis API — request/response zod schemas (server-side).
 *
 * Lives in src/shared/ (lowest layer). Per CONSTITUTION_V1.1_WEB §3.3, this file
 * MUST NOT import next, react, prisma, fs, etc. — only zod and @shared/*
 * (so it stays portable across Next.js, Electron, Tauri, React Native).
 *
 * These schemas wrap the domain-level `RateAnalysisInputSchema` /
 * `RateAnalysisLineInputSchema` from `@shared/schemas/rate-analysis` with the
 * API-specific fields the route layer needs:
 *   - `projectId` on create (optional — the route can derive it from the BoQItem)
 *   - `expectedVersion` on update (optimistic concurrency per BR-WEB-4)
 *   - `boqItemId` + `expectedVersion` on apply
 *
 * Per BR-WEB-11 — server-side input validation is mandatory on every API route.
 */

import { z } from "zod";
import {
  RateAnalysisInputSchema,
  RateAnalysisLineInputSchema,
  RateAnalysisLaborModeSchema,
} from "@shared/schemas/rate-analysis";

/**
 * Create payload for `POST /api/items/[id]/rate-analysis`.
 *
 * Wraps the domain `RateAnalysisInputSchema` (lines, overheadPct, profitPct,
 * laborMode, outputQuantity) and adds an optional `projectId`. The route
 * derives `projectId` from the BoQItem when this is omitted.
 *
 * The `totalRate` is NEVER in the request body — the route computes it via
 * `computeRate()` from `@domain/estimating/rate-analysis` (BR-10). This keeps
 * the client honest: the persisted `totalRate` is always the domain layer's
 * computation, not whatever the client sent.
 */
export const RateAnalysisCreateApiSchema = RateAnalysisInputSchema.extend({
  projectId: z.string().optional(),
});
export type RateAnalysisCreateApiInput = z.infer<
  typeof RateAnalysisCreateApiSchema
>;

/**
 * Update payload for `PATCH /api/rate-analyses/[id]`.
 *
 * All fields are optional except `expectedVersion` (optimistic concurrency —
 * BR-WEB-4). If `lines` is provided, the route recomputes the line totals via
 * `computeRate()` and uses the resulting `rate` as the new `totalRate`
 * (unless the caller explicitly provides a `totalRate`).
 */
export const RateAnalysisUpdateApiSchema = z.object({
  totalRate: z.string().optional(),
  overheadPct: z.string().optional(),
  profitPct: z.string().optional(),
  laborMode: RateAnalysisLaborModeSchema.optional(),
  lines: z.array(RateAnalysisLineInputSchema).optional(),
  expectedVersion: z.number().int().nonnegative(),
});
export type RateAnalysisUpdateApiInput = z.infer<
  typeof RateAnalysisUpdateApiSchema
>;

/**
 * Body for `POST /api/rate-analyses/[id]/apply`.
 *
 * `boqItemId` is the target BoQItem to apply the analysis's `totalRate` to.
 * `expectedVersion` is the analysis's current version (optimistic concurrency).
 *
 * This is the "engineer approves the AI proposal" action — the analysis's
 * `totalRate` is written to the BoQItem's `rate` column atomically.
 */
export const ApplyToBoqItemSchema = z.object({
  boqItemId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
});
export type ApplyToBoqItemInput = z.infer<typeof ApplyToBoqItemSchema>;
