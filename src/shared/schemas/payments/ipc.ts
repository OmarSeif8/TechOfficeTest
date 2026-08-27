/**
 * Payments — Interim Payment Certificate (IPC) schemas.
 *
 * Pure zod schemas for the IPC engine input + output types.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only zod + stdlib.
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Per BR-1 — all money/qty values are strings (decimal.js on the domain side).
 *
 * Law (SPEC_PHASE4_WEB.md §3 — BR-IP1..IP12):
 *   - BR-IP1: decimal.js, string I/O, ROUND_HALF_UP, 2dp for all money.
 *   - BR-IP2: value_cum = round(qty_cum × rate, 2); this_period = cum − cum_prev_certified.
 *   - BR-IP6: Deductions/additions are manual line items (positive amounts).
 *   - BR-IP11: Validation runs BEFORE compute.
 *   - BR-IP12: Pure, deterministic, no I/O.
 */

import { z } from "zod";

/**
 * Payment application status (mirrors Prisma `PaymentApplication.status`).
 *
 *   - DRAFT:     application is being edited; not yet submitted for certification.
 *   - SUBMITTED: application has been submitted; awaiting engineer's certification.
 *   - CERTIFIED: application is locked; corrections via later applications (BR-IP10).
 */
export const PaymentStatusSchema = z.enum(["DRAFT", "SUBMITTED", "CERTIFIED"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Payment line input — one line per BoQ item worked in this period.
 *
 * `qtyThisPeriod` is the quantity executed THIS period (NOT cumulative). The
 * engine tracks cumulative qty across applications.
 */
export const PaymentLineInputSchema = z.object({
  itemId: z.string(),
  qtyThisPeriod: z.string(),
});
export type PaymentLineInput = z.infer<typeof PaymentLineInputSchema>;

/**
 * Deduction type (mirrors Prisma `PaymentDeduction.type`).
 *   - PENALTY:     contract penalty (e.g. liquidated damages).
 *   - BACKCHARGE:  cost recharged to a subcontractor / supplier.
 *   - OTHER:       any other deduction (description required).
 */
export const DeductionTypeSchema = z.enum(["PENALTY", "BACKCHARGE", "OTHER"]);
export type DeductionType = z.infer<typeof DeductionTypeSchema>;

/**
 * Payment deduction input — a manual negative adjustment (BR-IP6).
 *
 * `amount` is positive; the engine subtracts it from net payable.
 */
export const PaymentDeductionInputSchema = z.object({
  type: DeductionTypeSchema,
  descriptionEn: z.string(),
  amount: z.string(),
});
export type PaymentDeductionInput = z.infer<typeof PaymentDeductionInputSchema>;

/**
 * Addition type (mirrors Prisma `PaymentAddition.type`).
 *   - MATERIALS_ON_SITE: payment for materials delivered to site but not yet installed.
 *   - OTHER:             any other addition (description required).
 */
export const AdditionTypeSchema = z.enum(["MATERIALS_ON_SITE", "OTHER"]);
export type AdditionType = z.infer<typeof AdditionTypeSchema>;

/**
 * Payment addition input — a manual positive adjustment (BR-IP6).
 *
 * `amount` is positive; the engine adds it to net payable.
 */
export const PaymentAdditionInputSchema = z.object({
  type: AdditionTypeSchema,
  descriptionEn: z.string(),
  amount: z.string(),
});
export type PaymentAdditionInput = z.infer<typeof PaymentAdditionInputSchema>;

/**
 * One IPC application input — the per-period work execution.
 */
export const PaymentApplicationInputSchema = z.object({
  ipcNo: z.string(),
  periodStart: z.string(), // ISO yyyy-MM-dd
  periodEnd: z.string(),    // ISO yyyy-MM-dd
  status: PaymentStatusSchema,
  lines: z.array(PaymentLineInputSchema).default([]),
  deductions: z.array(PaymentDeductionInputSchema).default([]),
  additions: z.array(PaymentAdditionInputSchema).default([]),
});
export type PaymentApplicationInput = z.infer<typeof PaymentApplicationInputSchema>;

/**
 * Advance payment input.
 *
 *   - `enabled`: if false, advance recovery is skipped entirely.
 *   - `amount`:  the advance paid to the contractor at contract commencement.
 *
 * Per BR-IP5: recovery is proportional (advance × gross_this_period / contract_value),
 * capped so cumulative recovery ≤ advance.
 */
export const AdvancePaymentInputSchema = z.object({
  enabled: z.boolean(),
  amount: z.string(),
});
export type AdvancePaymentInput = z.infer<typeof AdvancePaymentInputSchema>;

/**
 * IPC engine input — the top-level aggregate consumed by `computeApplications`.
 *
 *   - `contractValue`:      the original contract sum (used as the advance recovery denominator).
 *   - `retentionPercent`:   e.g. "5" for 5%.
 *   - `retentionCapAmount`: optional cap (e.g. "3000"); retention stops accumulating once hit.
 *   - `advance`:            advance payment configuration.
 *   - `boqRates`:           rate per BoQ item id (used to compute line values).
 *   - `boqQtys`:            optional BoQ quantity per item id (for overrun warnings — BR-IP8).
 *   - `applications`:       the IPC applications, processed in IPC-number order (BR-IP9).
 */
export const IpcEngineInputSchema = z.object({
  contractValue: z.string(),
  retentionPercent: z.string(),
  retentionCapAmount: z.string().optional(),
  advance: AdvancePaymentInputSchema,
  boqRates: z.record(z.string(), z.string()),
  boqQtys: z.record(z.string(), z.string()).optional(),
  applications: z.array(PaymentApplicationInputSchema),
});
export type IpcEngineInput = z.infer<typeof IpcEngineInputSchema>;
