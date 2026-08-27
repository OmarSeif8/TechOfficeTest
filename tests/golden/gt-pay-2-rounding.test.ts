/**
 * GT-PAY-2 — Rounding + cumulative method (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Items A rate 964.31, B rate 85.40 · retention 10%, no advance.
 *   IPC-1: A 12.5, B 40 (cum A=12.5, B=40)
 *   IPC-2: A +3.5 (cum 16), B +10 (cum 50)
 *
 *   Expected:
 *     IPC-1: A value_cum 12,053.88, B value_cum 3,416.00
 *            gross cum 15,469.88, retention cum 1,546.99, net 13,922.89
 *     IPC-2: A value_cum 15,428.96, B value_cum 4,270.00
 *            gross cum 19,698.96, gross this 4,229.08
 *            retention cum 1,969.90, net this 3,806.17, net cum 17,729.06
 *
 * Verifies BR-IP1 (HALF_UP rounding), BR-IP2 (cumulative method — never sum
 * period-rounded values), BR-IP3 (gross), BR-IP4 (retention), BR-IP7 (net).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { computeApplications } from "@domain/payments/ipc-engine";
import type { IpcEngineInput } from "@shared/schemas/payments/ipc";

describe("GT-PAY-2 — Rounding + cumulative method (authoritative)", () => {
  const input: IpcEngineInput = {
    contractValue: "1000000", // unused — no advance
    retentionPercent: "10",
    advance: { enabled: false, amount: "0" },
    boqRates: { A: "964.31", B: "85.40" },
    applications: [
      {
        ipcNo: "IPC-1",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        status: "CERTIFIED",
        lines: [
          { itemId: "A", qtyThisPeriod: "12.5" },
          { itemId: "B", qtyThisPeriod: "40" },
        ],
        deductions: [],
        additions: [],
      },
      {
        ipcNo: "IPC-2",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        status: "CERTIFIED",
        lines: [
          { itemId: "A", qtyThisPeriod: "3.5" }, // cum 16
          { itemId: "B", qtyThisPeriod: "10" },  // cum 50
        ],
        deductions: [],
        additions: [],
      },
    ],
  };

  const result = computeApplications(input);

  it("returns success", () => {
    expect(result.kind).toBe("success");
  });
  if (result.kind !== "success") return;

  const ipc1 = result.applications[0];
  const ipc2 = result.applications[1];

  // ─── IPC-1 ──────────────────────────────────────────────────────────

  it("IPC-1 A: value_cum = round(12.5 × 964.31, 2) = 12,053.88 (BR-IP2, BR-IP1 HALF_UP)", () => {
    const a = ipc1.lines.find((l) => l.itemId === "A")!;
    expect(a.valueCum).toBe("12053.88");
    expect(a.qtyCum).toBe("12.50");
  });

  it("IPC-1 B: value_cum = round(40 × 85.40, 2) = 3,416.00", () => {
    const b = ipc1.lines.find((l) => l.itemId === "B")!;
    expect(b.valueCum).toBe("3416.00");
    expect(b.qtyCum).toBe("40.00");
  });

  it("IPC-1: gross_cum = 12,053.88 + 3,416.00 = 15,469.88 (BR-IP3)", () => {
    expect(ipc1.grossCum).toBe("15469.88");
  });

  it("IPC-1: retention_cum = round(10% × 15,469.88, 2) = 1,546.99 (BR-IP4 — HALF_UP on 1,546.988)", () => {
    expect(ipc1.retentionCum).toBe("1546.99");
  });

  it("IPC-1: net_cum = 15,469.88 − 1,546.99 = 13,922.89 (BR-IP7)", () => {
    expect(ipc1.netCum).toBe("13922.89");
  });

  it("IPC-1: net_this_period = 13,922.89 (first application)", () => {
    expect(ipc1.netThisPeriod).toBe("13922.89");
  });

  it("IPC-1: recovery is zero (advance disabled)", () => {
    expect(ipc1.recoveryCum).toBe("0.00");
    expect(ipc1.recoveryThisPeriod).toBe("0.00");
  });

  // ─── IPC-2 ──────────────────────────────────────────────────────────

  it("IPC-2 A: qty_cum = 16.00 (cumulative — adds 3.5 to IPC-1's 12.5)", () => {
    const a = ipc2.lines.find((l) => l.itemId === "A")!;
    expect(a.qtyCum).toBe("16.00");
  });

  it("IPC-2 A: value_cum = round(16 × 964.31, 2) = 15,428.96 (BR-IP2)", () => {
    const a = ipc2.lines.find((l) => l.itemId === "A")!;
    expect(a.valueCum).toBe("15428.96");
  });

  it("IPC-2 A: value_this_period = 15,428.96 − 12,053.88 = 3,375.08 (BR-IP2 — cumulative)", () => {
    const a = ipc2.lines.find((l) => l.itemId === "A")!;
    expect(a.valueThisPeriod).toBe("3375.08");
  });

  it("IPC-2 B: qty_cum = 50.00", () => {
    const b = ipc2.lines.find((l) => l.itemId === "B")!;
    expect(b.qtyCum).toBe("50.00");
  });

  it("IPC-2 B: value_cum = round(50 × 85.40, 2) = 4,270.00", () => {
    const b = ipc2.lines.find((l) => l.itemId === "B")!;
    expect(b.valueCum).toBe("4270.00");
  });

  it("IPC-2 B: value_this_period = 4,270.00 − 3,416.00 = 854.00", () => {
    const b = ipc2.lines.find((l) => l.itemId === "B")!;
    expect(b.valueThisPeriod).toBe("854.00");
  });

  it("IPC-2: gross_cum = 15,428.96 + 4,270.00 = 19,698.96 (BR-IP3)", () => {
    expect(ipc2.grossCum).toBe("19698.96");
  });

  it("IPC-2: gross_this_period = 19,698.96 − 15,469.88 = 4,229.08 (BR-IP3 — cum delta, NOT period-rounded sum)", () => {
    expect(ipc2.grossThisPeriod).toBe("4229.08");
  });

  it("IPC-2: retention_cum = round(10% × 19,698.96, 2) = 1,969.90 (BR-IP4 — HALF_UP on 1,969.896)", () => {
    expect(ipc2.retentionCum).toBe("1969.90");
  });

  it("IPC-2: retention_this_period = 1,969.90 − 1,546.99 = 422.91", () => {
    expect(ipc2.retentionThisPeriod).toBe("422.91");
  });

  it("IPC-2: net_cum = 19,698.96 − 1,969.90 = 17,729.06 (BR-IP7)", () => {
    expect(ipc2.netCum).toBe("17729.06");
  });

  it("IPC-2: net_this_period = 17,729.06 − 13,922.89 = 3,806.17 (BR-IP7 — cum delta)", () => {
    expect(ipc2.netThisPeriod).toBe("3806.17");
  });

  it("no warnings (no overrun, no advance cap, no negative net)", () => {
    expect(result.warnings).toEqual([]);
  });
});
