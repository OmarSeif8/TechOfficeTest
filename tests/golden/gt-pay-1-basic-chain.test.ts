/**
 * GT-PAY-1 — Basic IPC chain (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Contract 1,000,000 · advance 200,000 · retention 5%, no cap · rate 100
 *   IPC-1: qty 500 (cum 500)
 *   IPC-2: qty 1,000 (cum 1,500)
 *
 *   Expected:
 *     IPC-1: value_cum 50,000, gross 50,000, retention 2,500, recovery 10,000, net 37,500
 *     IPC-2: value_cum 150,000, gross this 100,000, retention cum 7,500,
 *            recovery cum 30,000, net this 75,000, net cum 112,500
 *
 * Verifies BR-IP2 (cumulative method), BR-IP3 (gross), BR-IP4 (retention),
 * BR-IP5 (proportional advance recovery), BR-IP7 (net).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 * Per the Constitution: golden tests are law. NEVER edit expected values to make
 * a test pass — if you believe the GT is wrong, STOP and report.
 */

import { describe, it, expect } from "vitest";
import { computeApplications } from "@domain/payments/ipc-engine";
import type { IpcEngineInput } from "@shared/schemas/payments/ipc";

describe("GT-PAY-1 — Basic IPC chain (authoritative)", () => {
  const input: IpcEngineInput = {
    contractValue: "1000000",
    retentionPercent: "5",
    advance: { enabled: true, amount: "200000" },
    boqRates: { I1: "100" },
    applications: [
      {
        ipcNo: "IPC-1",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        status: "CERTIFIED",
        lines: [
          { itemId: "I1", qtyThisPeriod: "500" },
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
          { itemId: "I1", qtyThisPeriod: "1000" },
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

  it("IPC-1: line value_cum = round(qty_cum × rate, 2) = 50,000.00 (BR-IP2)", () => {
    expect(ipc1.lines[0].valueCum).toBe("50000.00");
    expect(ipc1.lines[0].qtyCum).toBe("500.00");
  });

  it("IPC-1: line value_this_period = 50,000.00 (no prior certified baseline)", () => {
    expect(ipc1.lines[0].valueThisPeriod).toBe("50000.00");
  });

  it("IPC-1: gross_cum = 50,000.00 (BR-IP3)", () => {
    expect(ipc1.grossCum).toBe("50000.00");
  });

  it("IPC-1: gross_this_period = 50,000.00 (BR-IP3)", () => {
    expect(ipc1.grossThisPeriod).toBe("50000.00");
  });

  it("IPC-1: retention_cum = round(5% × 50,000, 2) = 2,500.00 (BR-IP4)", () => {
    expect(ipc1.retentionCum).toBe("2500.00");
  });

  it("IPC-1: retention_this_period = 2,500.00 (BR-IP4)", () => {
    expect(ipc1.retentionThisPeriod).toBe("2500.00");
  });

  it("IPC-1: recovery_this_period = round(200,000 × 50,000 / 1,000,000, 2) = 10,000.00 (BR-IP5)", () => {
    expect(ipc1.recoveryThisPeriod).toBe("10000.00");
  });

  it("IPC-1: recovery_cum = 10,000.00 (BR-IP5)", () => {
    expect(ipc1.recoveryCum).toBe("10000.00");
  });

  it("IPC-1: net_cum = 50,000 − 2,500 − 10,000 = 37,500.00 (BR-IP7)", () => {
    expect(ipc1.netCum).toBe("37500.00");
  });

  it("IPC-1: net_this_period = 37,500.00", () => {
    expect(ipc1.netThisPeriod).toBe("37500.00");
  });

  // ─── IPC-2 ──────────────────────────────────────────────────────────

  it("IPC-2: qty_cum = 1,500.00 (cumulative across both applications)", () => {
    expect(ipc2.lines[0].qtyCum).toBe("1500.00");
  });

  it("IPC-2: line value_cum = round(1,500 × 100, 2) = 150,000.00 (BR-IP2)", () => {
    expect(ipc2.lines[0].valueCum).toBe("150000.00");
  });

  it("IPC-2: line value_this_period = 150,000 − 50,000 = 100,000.00 (BR-IP2 — cumulative method)", () => {
    expect(ipc2.lines[0].valueThisPeriod).toBe("100000.00");
  });

  it("IPC-2: gross_cum = 150,000.00 (BR-IP3)", () => {
    expect(ipc2.grossCum).toBe("150000.00");
  });

  it("IPC-2: gross_this_period = 150,000 − 50,000 = 100,000.00 (BR-IP3)", () => {
    expect(ipc2.grossThisPeriod).toBe("100000.00");
  });

  it("IPC-2: retention_cum = round(5% × 150,000, 2) = 7,500.00 (BR-IP4)", () => {
    expect(ipc2.retentionCum).toBe("7500.00");
  });

  it("IPC-2: retention_this_period = 7,500 − 2,500 = 5,000.00 (BR-IP4)", () => {
    expect(ipc2.retentionThisPeriod).toBe("5000.00");
  });

  it("IPC-2: recovery_this_period = round(200,000 × 100,000 / 1,000,000, 2) = 20,000.00 (BR-IP5)", () => {
    expect(ipc2.recoveryThisPeriod).toBe("20000.00");
  });

  it("IPC-2: recovery_cum = 10,000 + 20,000 = 30,000.00 (BR-IP5 — cum ≤ advance 200,000)", () => {
    expect(ipc2.recoveryCum).toBe("30000.00");
  });

  it("IPC-2: net_cum = 150,000 − 7,500 − 30,000 = 112,500.00 (BR-IP7)", () => {
    expect(ipc2.netCum).toBe("112500.00");
  });

  it("IPC-2: net_this_period = 112,500 − 37,500 = 75,000.00 (BR-IP7)", () => {
    expect(ipc2.netThisPeriod).toBe("75000.00");
  });

  // ─── Summary ─────────────────────────────────────────────────────────

  it("summary: totalGrossCum = 150,000.00 (last application)", () => {
    expect(result.summary.totalGrossCum).toBe("150000.00");
  });

  it("summary: totalRetentionCum = 7,500.00", () => {
    expect(result.summary.totalRetentionCum).toBe("7500.00");
  });

  it("summary: totalRecoveryCum = 30,000.00", () => {
    expect(result.summary.totalRecoveryCum).toBe("30000.00");
  });

  it("summary: totalNetCum = 112,500.00", () => {
    expect(result.summary.totalNetCum).toBe("112500.00");
  });

  it("summary: advanceRemaining = 200,000 − 30,000 = 170,000.00", () => {
    expect(result.summary.advanceRemaining).toBe("170000.00");
  });

  it("no warnings (advance recovery NOT capped, qty NOT overrun)", () => {
    expect(result.warnings).toEqual([]);
  });
});
