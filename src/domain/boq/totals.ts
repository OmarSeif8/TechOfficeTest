/**
 * BoQ Totals — pure domain calculation (platform-agnostic).
 *
 * Implements BR-2, BR-3, BR-4, BR-5 from SPEC_PHASE1_BOQ_WEB.md §5.
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* and decimal.js (a pure TypeScript library, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *   - Same file compiles under Next.js server, Next.js client, Vitest, Electron main, Tauri, React Native.
 *
 * Law (golden tests are the authoritative source of truth — tests/golden/gt1-boq-totals.test.ts):
 *   - BR-1: All money/qty math uses decimal.js. Floats never touch money.
 *   - BR-2: Item amount = round(qty × rate, 2). [HALF_UP per decimal.js default]
 *   - BR-3: Section subtotal = Σ of rounded item amounts. Document total = Σ section subtotals.
 *           Project grand total = Σ document totals. (Round at item; sum rounded.)
 *   - BR-4: VAT (if enabled): VAT = round(subtotal × vat%, 2); Total incl. VAT = subtotal + VAT.
 *   - BR-5: LS items: qty fixed at 1; amount = rate. PS & daywork excluded from analysis features;
 *           PS included in totals, flagged.
 *
 * GT-1 expected (must reproduce exactly):
 *   Items: (12.5 × 85.40), (3 × 1250.00), (40 × 964.31); VAT 14%
 *   Expected amounts: 1,067.50 · 3,750.00 · 38,572.40 → subtotal 43,389.90 →
 *                     VAT 6,074.59 → total 49,464.49
 */

import Decimal from "decimal.js";
import type {
  BoqDocumentInput,
  BoqItemInput,
  BoqSectionInput,
} from "@shared/schemas/boq/boq-item";

// ─── decimal.js configuration ─────────────────────────────────────────────
// HALF_UP is the standard for money. precision: 28 (default) is plenty.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

// ─── Types ────────────────────────────────────────────────────────────────

export interface ItemAmount {
  /** The item's id (passed through if provided). */
  id?: string;
  /** Item amount = round(qty × rate, 2) per BR-2. For LUMP_SUM, qty=1, amount=rate. */
  amount: string;
  /** The qty actually used in the calculation (1 for LUMP_SUM). */
  effectiveQuantity: string;
  /** The rate used in the calculation. */
  rate: string;
  /** Item type, passed through for UI display. */
  itemType: string;
  /** True if item is excluded from totals (UNIT_ONLY has no qty/rate). */
  excludedFromTotals: boolean;
}

export interface SectionSubtotal {
  id?: string;
  code?: string;
  titleEn?: string;
  titleAr?: string;
  /** Σ of rounded item amounts (BR-3). */
  subtotal: string;
  /** Per-item breakdown (for UI display). */
  items: ItemAmount[];
}

export interface DocumentTotals {
  id?: string;
  /** Σ of section subtotals (BR-3). */
  subtotal: string;
  /** VAT percentage as a string (e.g. "14"). Empty if no VAT. */
  vatPercentage: string;
  /** VAT amount = round(subtotal × vat%, 2) (BR-4). Empty if no VAT. */
  vatAmount: string;
  /** Subtotal + VAT (BR-4). Equal to subtotal when no VAT. */
  totalIncludingVat: string;
  /** Per-section breakdown. */
  sections: SectionSubtotal[];
  /** Number of items (excluding UNIT_ONLY non-counted). */
  itemCount: number;
}

// ─── Pure domain functions ────────────────────────────────────────────────

/**
 * Compute a single item's amount per BR-2 and BR-5.
 *
 * - RATE_BASED: amount = round(qty × rate, 2)
 * - LUMP_SUM:   qty forced to 1; amount = round(1 × rate, 2) = round(rate, 2)
 * - PROVISIONAL_SUM: same as RATE_BASED (qty × rate); included in totals, flagged
 * - DAYWORK:    same as RATE_BASED (qty × rate); included in totals; flagged in analysis
 * - UNIT_ONLY:  no qty (qty=0); amount = 0; excluded from totals
 *
 * @throws if quantity or rate cannot be parsed as a number.
 */
export function computeItemAmount(item: BoqItemInput): ItemAmount {
  const itemType = item.itemType ?? "RATE_BASED";

  // UNIT_ONLY: excluded from totals
  if (itemType === "UNIT_ONLY") {
    return {
      id: item.id,
      amount: "0.00",
      effectiveQuantity: "0",
      rate: formatDecimal(new Decimal(item.rate ?? "0")),
      itemType,
      excludedFromTotals: true,
    };
  }

  // LUMP_SUM: qty forced to 1 (BR-5)
  const effectiveQty =
    itemType === "LUMP_SUM" ? new Decimal(1) : new Decimal(item.quantity ?? "0");

  const rate = new Decimal(item.rate ?? "0");

  // BR-2: amount = round(qty × rate, 2)
  const amount = effectiveQty.times(rate).toDecimalPlaces(2);

  return {
    id: item.id,
    amount: formatDecimal(amount),
    effectiveQuantity: formatDecimal(effectiveQty),
    rate: formatDecimal(rate),
    itemType,
    excludedFromTotals: false,
  };
}

/**
 * Compute a section subtotal per BR-3.
 * Section subtotal = Σ of rounded item amounts (sum of rounded, not round of sum).
 */
export function computeSectionSubtotal(section: BoqSectionInput): SectionSubtotal {
  const itemAmounts = (section.items ?? []).map(computeItemAmount);

  // BR-3: Σ of rounded item amounts
  const subtotal = itemAmounts.reduce<Decimal>((sum, item) => {
    if (item.excludedFromTotals) return sum;
    return sum.plus(new Decimal(item.amount));
  }, new Decimal(0));

  return {
    id: section.id,
    code: section.code,
    titleEn: section.titleEn,
    titleAr: section.titleAr,
    subtotal: formatDecimal(subtotal),
    items: itemAmounts,
  };
}

/**
 * Compute full document totals per BR-3 and BR-4.
 *
 * - Document subtotal = Σ of section subtotals.
 * - VAT (if vatPercentage provided) = round(subtotal × vat%, 2).
 * - Total incl. VAT = subtotal + VAT.
 *
 * @throws if vatPercentage is provided but cannot be parsed.
 */
export function computeDocumentTotals(doc: BoqDocumentInput): DocumentTotals {
  const sections = (doc.sections ?? []).map(computeSectionSubtotal);

  // BR-3: Document total = Σ section subtotals
  const subtotal = sections.reduce<Decimal>(
    (sum, s) => sum.plus(new Decimal(s.subtotal)),
    new Decimal(0),
  );

  // BR-4: VAT as separate line on document total
  const vatPercentageStr = doc.vatPercentage?.trim() ?? "";
  const hasVat = vatPercentageStr.length > 0;

  let vatAmount: Decimal;
  let totalIncludingVat: Decimal;

  if (hasVat) {
    const vatPct = new Decimal(vatPercentageStr).dividedBy(100);
    vatAmount = subtotal.times(vatPct).toDecimalPlaces(2);
    totalIncludingVat = subtotal.plus(vatAmount);
  } else {
    vatAmount = new Decimal(0);
    totalIncludingVat = subtotal;
  }

  const itemCount = sections.reduce(
    (count, s) => count + s.items.filter((i) => !i.excludedFromTotals).length,
    0,
  );

  return {
    id: doc.id,
    subtotal: formatDecimal(subtotal),
    vatPercentage: vatPercentageStr,
    vatAmount: formatDecimal(vatAmount),
    totalIncludingVat: formatDecimal(totalIncludingVat),
    sections,
    itemCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Decimal as a string with exactly 2 decimal places (money format).
 * Trailing zeros preserved: "1067.5" → "1,067.50" (no thousand separators —
 * we keep raw number form; UIs may format with separators for display).
 *
 * @internal
 */
function formatDecimal(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}
