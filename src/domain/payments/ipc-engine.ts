/**
 * IPC Engine — pure Interim Payment Certificate computation.
 *
 * Implements BR-IP1..IP12 from SPEC_PHASE4_WEB.md §3 (Part 4A).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js (a pure TypeScript library, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt-pay-*.test.ts):
 *   - BR-IP1: decimal.js, string I/O, ROUND_HALF_UP, 2dp for all money.
 *   - BR-IP2: Line: value_cum = round(qty_cum × rate, 2);
 *             value_this_period = value_cum − value_cum_previously_certified.
 *             Never sum period-rounded values across IPCs (cumulative method).
 *   - BR-IP3: Gross cumulative = Σ line value_cum (across ALL items, not just lines in this IPC).
 *             Gross this period = gross cum − gross cum previously certified.
 *   - BR-IP4: Retention: retention_cum = min(round(ret% × gross_cum, 2), cap?);
 *             this_period = retention_cum − retention_previously_held.
 *   - BR-IP5: Advance recovery (proportional):
 *             recovery_this_period = round(advance × gross_this_period / contract_value, 2);
 *             cumulative ≤ advance (cap). If would exceed → clamp + emit warning.
 *   - BR-IP6: Deductions/additions are manual, positive amounts. Computed (retention,
 *             advance recovery) are never manual.
 *   - BR-IP7: net_cum = gross_cum − retention_cum − recovery_cum − Σdeductions_cum
 *                       + Σadditions_cum;
 *             net_this_period = net_cum − net_certified_prev.
 *             Negative net is legal — emit warning, never clamp.
 *   - BR-IP8: Line qty_cum > BoQ qty → warning (overrun), not error.
 *   - BR-IP9: Process applications in IPC-number order. "Previously certified" = the
 *             most recent application with status CERTIFIED preceding the current one.
 *             If none exists, baseline is zero.
 *   - BR-IP10: Certified applications are immutable. (Engine doesn't enforce this — it's
 *              a repository concern — but the engine treats CERTIFIED apps as the
 *              baseline for the next application.)
 *   - BR-IP11: Validation runs BEFORE compute. Violations → structured errors, no compute.
 *   - BR-IP12: Pure, deterministic, no I/O. Same input → byte-identical output.
 */

import Decimal from "decimal.js";
import type {
  IpcEngineInput,
  PaymentApplicationInput,
  PaymentStatus,
} from "@shared/schemas/payments/ipc";

// ─── decimal.js configuration ─────────────────────────────────────────────
// HALF_UP is the standard for money. precision: 28 (default) is plenty.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Helpers ─────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a Decimal as a money string with exactly 2 decimal places.
 * Trailing zeros preserved: "1067.5" → "1067.50".
 * @internal
 */
function money(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

// ─── Engine output types ─────────────────────────────────────────────────

/**
 * One computed payment line — per-BoQ-item values for a single IPC application.
 */
export interface ComputedLine {
  itemId: string;
  /** Quantity executed this period (input passthrough). */
  qtyThisPeriod: string;
  /** Cumulative quantity through this application. */
  qtyCum: string;
  /** BoQ rate for this item. */
  rate: string;
  /** value_this_period = value_cum − value_cum_previously_certified. */
  valueThisPeriod: string;
  /** value_cum = round(qty_cum × rate, 2). */
  valueCum: string;
  /** True if qty_cum > BoQ qty (BR-IP8 overrun warning). */
  overrun: boolean;
}

/**
 * One computed IPC application — full breakdown of gross/retention/recovery/net.
 */
export interface ComputedApplication {
  ipcNo: string;
  periodStart: string;
  periodEnd: string;
  status: PaymentStatus;
  lines: ComputedLine[];
  grossCum: string;
  grossThisPeriod: string;
  retentionCum: string;
  retentionThisPeriod: string;
  recoveryCum: string;
  recoveryThisPeriod: string;
  /** Deduction total THIS period (manual). */
  deductionsTotal: string;
  /** Cumulative deductions through this application. */
  deductionsCum: string;
  /** Addition total THIS period (manual). */
  additionsTotal: string;
  /** Cumulative additions through this application. */
  additionsCum: string;
  /** net_cum = gross_cum − retention_cum − recovery_cum − deductions_cum + additions_cum. */
  netCum: string;
  netThisPeriod: string;
}

/**
 * Project-wide payment summary — cumulative values from the last application.
 */
export interface PaymentSummary {
  totalGrossCum: string;
  totalRetentionCum: string;
  totalRecoveryCum: string;
  totalDeductionsCum: string;
  totalAdditionsCum: string;
  totalNetCum: string;
  totalNetThisPeriod: string;
  /** Advance amount still to be recovered (advance − recovered cumulatively). */
  advanceRemaining: string;
}

/**
 * Non-fatal warning surfaced during compute.
 */
export interface PaymentWarning {
  code: string;
  message: string;
  ipcNo?: string;
  itemId?: string;
}

/**
 * Fatal validation error — no compute produced.
 */
export interface PaymentValidationError {
  code: string;
  message: string;
  ipcNo?: string;
  itemId?: string;
}

/**
 * IPC engine result — discriminated union by `kind`.
 *   - "success":    applications computed; consume `applications` + `summary` + `warnings`.
 *   - "validation": input was malformed (BR-IP11); no compute produced.
 */
export type IpcEngineResult =
  | {
      kind: "success";
      applications: ComputedApplication[];
      summary: PaymentSummary;
      warnings: PaymentWarning[];
    }
  | { kind: "validation"; errors: PaymentValidationError[] };

// ─── Validation (BR-IP11) ────────────────────────────────────────────────

/**
 * Validate the IPC engine input per BR-IP11.
 *
 * Checks:
 *   - contractValue > 0 and parseable.
 *   - retentionPercent ∈ (0, 100] and parseable.
 *   - retentionCapAmount (if present) ≥ 0 and parseable.
 *   - advance.amount (if enabled) ≥ 0 and ≤ contractValue.
 *   - all boqRates values parseable as numbers.
 *   - all boqQtys values (if present) parseable as numbers.
 *   - per application: ipcNo non-empty and unique; periodStart / periodEnd ISO dates;
 *     each line.itemId exists in boqRates; qtyThisPeriod parseable and ≥ 0;
 *     each deduction/addition amount parseable.
 *
 * @returns array of structured validation errors. Empty array = valid.
 */
export function validateIpcInput(input: IpcEngineInput): PaymentValidationError[] {
  const errors: PaymentValidationError[] = [];

  // Contract value.
  let contractValue: Decimal;
  try {
    contractValue = new Decimal(input.contractValue);
    if (!contractValue.isFinite()) throw new Error("not finite");
    if (contractValue.lte(0)) {
      errors.push({
        code: "INVALID_CONTRACT_VALUE",
        message: `contractValue must be > 0 (got "${input.contractValue}")`,
      });
    }
  } catch {
    errors.push({
      code: "INVALID_CONTRACT_VALUE",
      message: `contractValue is not a valid number (got "${input.contractValue}")`,
    });
    contractValue = new Decimal(0);
  }

  // Retention percent. 0 is allowed (disables retention — useful when the
  // contract has no retention, or for tests isolating advance recovery).
  try {
    const rp = new Decimal(input.retentionPercent);
    if (!rp.isFinite()) throw new Error("not finite");
    if (rp.lt(0) || rp.gt(100)) {
      errors.push({
        code: "INVALID_RETENTION_PERCENT",
        message: `retentionPercent must be in [0, 100] (got "${input.retentionPercent}")`,
      });
    }
  } catch {
    errors.push({
      code: "INVALID_RETENTION_PERCENT",
      message: `retentionPercent is not a valid number (got "${input.retentionPercent}")`,
    });
  }

  // Retention cap.
  if (input.retentionCapAmount !== undefined) {
    try {
      const cap = new Decimal(input.retentionCapAmount);
      if (!cap.isFinite()) throw new Error("not finite");
      if (cap.lt(0)) {
        errors.push({
          code: "INVALID_RETENTION_CAP",
          message: `retentionCapAmount must be ≥ 0 (got "${input.retentionCapAmount}")`,
        });
      }
    } catch {
      errors.push({
        code: "INVALID_RETENTION_CAP",
        message: `retentionCapAmount is not a valid number (got "${input.retentionCapAmount}")`,
      });
    }
  }

  // Advance.
  let advanceAmount: Decimal;
  try {
    advanceAmount = new Decimal(input.advance.amount);
    if (!advanceAmount.isFinite()) throw new Error("not finite");
    if (advanceAmount.lt(0)) {
      errors.push({
        code: "INVALID_ADVANCE",
        message: `advance.amount must be ≥ 0 (got "${input.advance.amount}")`,
      });
    }
    if (input.advance.enabled && advanceAmount.gt(contractValue)) {
      errors.push({
        code: "ADVANCE_EXCEEDS_CONTRACT",
        message: `advance amount ${input.advance.amount} exceeds contract value ${input.contractValue}`,
      });
    }
  } catch {
    errors.push({
      code: "INVALID_ADVANCE",
      message: `advance.amount is not a valid number (got "${input.advance.amount}")`,
    });
    advanceAmount = new Decimal(0);
  }

  // BoQ rates parseable.
  for (const [itemId, rate] of Object.entries(input.boqRates)) {
    try {
      const r = new Decimal(rate);
      if (!r.isFinite()) throw new Error("not finite");
    } catch {
      errors.push({
        code: "INVALID_BOQ_RATE",
        message: `boqRates["${itemId}"] is not a valid number (got "${rate}")`,
        itemId,
      });
    }
  }

  // BoQ quantities (optional).
  if (input.boqQtys) {
    for (const [itemId, qty] of Object.entries(input.boqQtys)) {
      try {
        const q = new Decimal(qty);
        if (!q.isFinite()) throw new Error("not finite");
      } catch {
        errors.push({
          code: "INVALID_BOQ_QTY",
          message: `boqQtys["${itemId}"] is not a valid number (got "${qty}")`,
          itemId,
        });
      }
    }
  }

  // IPC numbers: non-empty + unique.
  const seenIpc = new Set<string>();
  for (const app of input.applications) {
    if (!app.ipcNo || app.ipcNo.trim().length === 0) {
      errors.push({
        code: "EMPTY_IPC_NO",
        message: `application ipcNo must be non-empty`,
      });
      continue;
    }
    if (seenIpc.has(app.ipcNo)) {
      errors.push({
        code: "DUPLICATE_IPC_NO",
        message: `duplicate ipcNo: "${app.ipcNo}"`,
        ipcNo: app.ipcNo,
      });
    }
    seenIpc.add(app.ipcNo);

    // Period dates valid ISO yyyy-MM-dd.
    if (!ISO_DATE_RE.test(app.periodStart)) {
      errors.push({
        code: "INVALID_PERIOD_START",
        message: `periodStart must be ISO yyyy-MM-dd (got "${app.periodStart}")`,
        ipcNo: app.ipcNo,
      });
    }
    if (!ISO_DATE_RE.test(app.periodEnd)) {
      errors.push({
        code: "INVALID_PERIOD_END",
        message: `periodEnd must be ISO yyyy-MM-dd (got "${app.periodEnd}")`,
        ipcNo: app.ipcNo,
      });
    }

    // Lines reference existing BoQ items.
    for (const line of app.lines) {
      if (!(line.itemId in input.boqRates)) {
        errors.push({
          code: "UNKNOWN_BOQ_ITEM",
          message: `line item "${line.itemId}" not found in boqRates`,
          ipcNo: app.ipcNo,
          itemId: line.itemId,
        });
      }
      try {
        const q = new Decimal(line.qtyThisPeriod);
        if (!q.isFinite()) throw new Error("not finite");
        if (q.lt(0)) {
          errors.push({
            code: "NEGATIVE_QTY",
            message: `qtyThisPeriod must be ≥ 0 (got "${line.qtyThisPeriod}")`,
            ipcNo: app.ipcNo,
            itemId: line.itemId,
          });
        }
      } catch {
        errors.push({
          code: "INVALID_QTY",
          message: `qtyThisPeriod is not a valid number (got "${line.qtyThisPeriod}")`,
          ipcNo: app.ipcNo,
          itemId: line.itemId,
        });
      }
    }

    // Deductions/additions amounts parseable + non-negative.
    for (const d of app.deductions) {
      try {
        const a = new Decimal(d.amount);
        if (!a.isFinite()) throw new Error("not finite");
        if (a.lt(0)) {
          errors.push({
            code: "NEGATIVE_DEDUCTION",
            message: `deduction amount must be ≥ 0 (got "${d.amount}")`,
            ipcNo: app.ipcNo,
          });
        }
      } catch {
        errors.push({
          code: "INVALID_DEDUCTION_AMOUNT",
          message: `deduction amount is not a valid number (got "${d.amount}")`,
          ipcNo: app.ipcNo,
        });
      }
    }
    for (const a of app.additions) {
      try {
        const v = new Decimal(a.amount);
        if (!v.isFinite()) throw new Error("not finite");
        if (v.lt(0)) {
          errors.push({
            code: "NEGATIVE_ADDITION",
            message: `addition amount must be ≥ 0 (got "${a.amount}")`,
            ipcNo: app.ipcNo,
          });
        }
      } catch {
        errors.push({
          code: "INVALID_ADDITION_AMOUNT",
          message: `addition amount is not a valid number (got "${a.amount}")`,
          ipcNo: app.ipcNo,
        });
      }
    }
  }

  // Suppress unused warning for advanceAmount (kept for clarity).
  void advanceAmount;

  return errors;
}

// ─── Baseline (previously-certified cumulative state) ────────────────────

/**
 * The "previously certified" baseline — the cumulative state at the most
 * recent CERTIFIED application before the current one (BR-IP9).
 *
 * If no prior application is CERTIFIED, the baseline is zero (empty maps / zero scalars).
 */
interface CertifiedBaseline {
  /** Per-item value_cum at the last CERTIFIED application. */
  itemValueCum: Map<string, Decimal>;
  grossCum: Decimal;
  retentionCum: Decimal;
  recoveryCum: Decimal;
  deductionsCum: Decimal;
  additionsCum: Decimal;
  netCum: Decimal;
}

function emptyBaseline(): CertifiedBaseline {
  return {
    itemValueCum: new Map(),
    grossCum: new Decimal(0),
    retentionCum: new Decimal(0),
    recoveryCum: new Decimal(0),
    deductionsCum: new Decimal(0),
    additionsCum: new Decimal(0),
    netCum: new Decimal(0),
  };
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Compute IPC applications per BR-IP1..IP12.
 *
 * Pipeline:
 *   1. validateIpcInput (BR-IP11) → on violations, return {kind:"validation"}.
 *   2. Sort applications by ipcNo (numeric-aware lexicographic).
 *   3. Walk applications in order; track running qty_cum per item;
 *      compute per-line value_cum, gross_cum, retention_cum, recovery_cum, net_cum.
 *   4. After each CERTIFIED application, snapshot its cumulative state as the new
 *      "previously certified" baseline (BR-IP9).
 *   5. Emit warnings: qty overrun (BR-IP8), advance recovery capped (BR-IP5),
 *      negative net (BR-IP7).
 *
 * @returns discriminated union by `kind`. See IpcEngineResult.
 */
export function computeApplications(input: IpcEngineInput): IpcEngineResult {
  // 1. Validate (BR-IP11) — BEFORE any compute.
  const errors = validateIpcInput(input);
  if (errors.length > 0) {
    return { kind: "validation", errors };
  }

  // 2. Sort applications by ipcNo (numeric-aware — IPC-2 < IPC-10).
  const sorted = [...input.applications].sort((a, b) =>
    a.ipcNo.localeCompare(b.ipcNo, undefined, { numeric: true, sensitivity: "base" }),
  );

  // Pre-compute constants from input.
  const contractValue = new Decimal(input.contractValue);
  const retentionPct = new Decimal(input.retentionPercent).dividedBy(100);
  const retentionCap =
    input.retentionCapAmount !== undefined ? new Decimal(input.retentionCapAmount) : null;
  const advanceEnabled = input.advance.enabled;
  const advanceAmount = advanceEnabled ? new Decimal(input.advance.amount) : new Decimal(0);

  // 3. Walk applications in order.
  let baseline = emptyBaseline();
  const runningQtyCum = new Map<string, Decimal>();

  const computedApplications: ComputedApplication[] = [];
  const warnings: PaymentWarning[] = [];

  for (const app of sorted) {
    const appWarnings: PaymentWarning[] = [];

    // 3a. Update running qty_cum for each line in this application.
    for (const line of app.lines) {
      const prev = runningQtyCum.get(line.itemId) ?? new Decimal(0);
      runningQtyCum.set(line.itemId, prev.plus(new Decimal(line.qtyThisPeriod)));
    }

    // 3b. Compute per-item value_cum across ALL items that have appeared so far
    //     (BR-IP3: gross_cum is the sum over all items, not just this period's lines).
    const itemValueCum = new Map<string, Decimal>();
    for (const [itemId, qtyCum] of runningQtyCum) {
      const rate = new Decimal(input.boqRates[itemId] ?? "0");
      itemValueCum.set(itemId, qtyCum.times(rate).toDecimalPlaces(2));
    }

    // 3c. Compute per-line value_cum + this_period + overrun (BR-IP2, BR-IP8).
    const computedLines: ComputedLine[] = [];
    for (const line of app.lines) {
      const rate = new Decimal(input.boqRates[line.itemId] ?? "0");
      const qtyCum = runningQtyCum.get(line.itemId) ?? new Decimal(0);
      const valueCum = itemValueCum.get(line.itemId) ?? new Decimal(0);
      const baselineValueCum = baseline.itemValueCum.get(line.itemId) ?? new Decimal(0);
      const valueThisPeriod = valueCum.minus(baselineValueCum);

      // Overrun check (BR-IP8).
      const boqQtyStr = input.boqQtys?.[line.itemId];
      let overrun = false;
      if (boqQtyStr !== undefined) {
        try {
          overrun = new Decimal(boqQtyStr).lt(qtyCum);
        } catch {
          // Already validated — ignore.
        }
      }
      if (overrun) {
        appWarnings.push({
          code: "QTY_OVERRUN",
          message:
            `Item "${line.itemId}" qty_cum ${money(qtyCum)} exceeds BoQ qty ${boqQtyStr} ` +
            `in IPC ${app.ipcNo}.`,
          ipcNo: app.ipcNo,
          itemId: line.itemId,
        });
      }

      computedLines.push({
        itemId: line.itemId,
        qtyThisPeriod: line.qtyThisPeriod,
        qtyCum: money(qtyCum),
        rate: money(rate),
        valueThisPeriod: money(valueThisPeriod),
        valueCum: money(valueCum),
        overrun,
      });
    }

    // 3d. Gross (BR-IP3).
    let grossCum = new Decimal(0);
    for (const v of itemValueCum.values()) {
      grossCum = grossCum.plus(v);
    }
    const grossThisPeriod = grossCum.minus(baseline.grossCum);

    // 3e. Retention (BR-IP4) — round then cap.
    const rawRetentionCum = retentionPct.times(grossCum).toDecimalPlaces(2);
    const retentionCum = retentionCap !== null
      ? Decimal.min(rawRetentionCum, retentionCap)
      : rawRetentionCum;
    const retentionThisPeriod = retentionCum.minus(baseline.retentionCum);

    // 3f. Advance recovery (BR-IP5) — proportional, capped at advance amount.
    let recoveryCum = baseline.recoveryCum;
    let recoveryThisPeriod = new Decimal(0);
    let recoveryCapped = false;
    if (advanceEnabled && advanceAmount.gt(0) && contractValue.gt(0) && !grossThisPeriod.isZero()) {
      const proportional = advanceAmount
        .times(grossThisPeriod)
        .dividedBy(contractValue)
        .toDecimalPlaces(2);
      const attemptedCum = baseline.recoveryCum.plus(proportional);
      if (attemptedCum.gt(advanceAmount)) {
        recoveryCum = advanceAmount;
        recoveryThisPeriod = recoveryCum.minus(baseline.recoveryCum);
        recoveryCapped = true;
      } else {
        recoveryCum = attemptedCum;
        recoveryThisPeriod = proportional;
      }
    }
    if (recoveryCapped) {
      appWarnings.push({
        code: "ADVANCE_RECOVERY_CAPPED",
        message:
          `IPC ${app.ipcNo}: advance recovery capped at ${money(advanceAmount)} ` +
          `(proportional amount would have exceeded the advance).`,
        ipcNo: app.ipcNo,
      });
    }

    // 3g. Deductions + additions (BR-IP6) — manual, per-period.
    let deductionsTotal = new Decimal(0);
    for (const d of app.deductions) {
      deductionsTotal = deductionsTotal.plus(new Decimal(d.amount));
    }
    let additionsTotal = new Decimal(0);
    for (const a of app.additions) {
      additionsTotal = additionsTotal.plus(new Decimal(a.amount));
    }
    const deductionsCum = baseline.deductionsCum.plus(deductionsTotal);
    const additionsCum = baseline.additionsCum.plus(additionsTotal);

    // 3h. Net payable (BR-IP7).
    const netCum = grossCum
      .minus(retentionCum)
      .minus(recoveryCum)
      .minus(deductionsCum)
      .plus(additionsCum);
    const netThisPeriod = netCum.minus(baseline.netCum);

    // Negative-net warnings (BR-IP7) — legal but warned, never clamped.
    if (netThisPeriod.lt(0)) {
      appWarnings.push({
        code: "NEGATIVE_NET_THIS_PERIOD",
        message:
          `IPC ${app.ipcNo}: net payable this period is negative (${money(netThisPeriod)}). ` +
          `Legal — review deductions / recovery.`,
        ipcNo: app.ipcNo,
      });
    }
    if (netCum.lt(0)) {
      appWarnings.push({
        code: "NEGATIVE_NET_CUM",
        message:
          `IPC ${app.ipcNo}: cumulative net payable is negative (${money(netCum)}). ` +
          `Legal — review deductions / recovery.`,
        ipcNo: app.ipcNo,
      });
    }

    // 3i. Assemble the computed application.
    const computed: ComputedApplication = {
      ipcNo: app.ipcNo,
      periodStart: app.periodStart,
      periodEnd: app.periodEnd,
      status: app.status,
      lines: computedLines,
      grossCum: money(grossCum),
      grossThisPeriod: money(grossThisPeriod),
      retentionCum: money(retentionCum),
      retentionThisPeriod: money(retentionThisPeriod),
      recoveryCum: money(recoveryCum),
      recoveryThisPeriod: money(recoveryThisPeriod),
      deductionsTotal: money(deductionsTotal),
      deductionsCum: money(deductionsCum),
      additionsTotal: money(additionsTotal),
      additionsCum: money(additionsCum),
      netCum: money(netCum),
      netThisPeriod: money(netThisPeriod),
    };
    computedApplications.push(computed);
    warnings.push(...appWarnings);

    // 3j. If CERTIFIED, snapshot cumulative state as the new baseline (BR-IP9, BR-IP10).
    if (app.status === "CERTIFIED") {
      const snapshotItemValueCum = new Map<string, Decimal>();
      for (const [itemId, v] of itemValueCum) {
        snapshotItemValueCum.set(itemId, v);
      }
      baseline = {
        itemValueCum: snapshotItemValueCum,
        grossCum,
        retentionCum,
        recoveryCum,
        deductionsCum,
        additionsCum,
        netCum,
      };
    }
  }

  // 4. Summary — cumulative values from the last computed application.
  const lastApp = computedApplications[computedApplications.length - 1];
  const summary: PaymentSummary = lastApp
    ? {
        totalGrossCum: lastApp.grossCum,
        totalRetentionCum: lastApp.retentionCum,
        totalRecoveryCum: lastApp.recoveryCum,
        totalDeductionsCum: lastApp.deductionsCum,
        totalAdditionsCum: lastApp.additionsCum,
        totalNetCum: lastApp.netCum,
        totalNetThisPeriod: lastApp.netThisPeriod,
        advanceRemaining: money(advanceAmount.minus(new Decimal(lastApp.recoveryCum))),
      }
    : {
        totalGrossCum: "0.00",
        totalRetentionCum: "0.00",
        totalRecoveryCum: "0.00",
        totalDeductionsCum: "0.00",
        totalAdditionsCum: "0.00",
        totalNetCum: "0.00",
        totalNetThisPeriod: "0.00",
        advanceRemaining: money(advanceAmount),
      };

  return {
    kind: "success",
    applications: computedApplications,
    summary,
    warnings,
  };
}

// Re-export types so consumers can import everything from the engine module.
export type {
  IpcEngineInput,
  PaymentApplicationInput,
  PaymentStatus,
} from "@shared/schemas/payments/ipc";
