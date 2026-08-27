/**
 * GT-PAY-3 — Retention cap (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Contract 100,000 · retention 5% · cap 3,000
 *   IPC-1 gross 50,000 → retention 2,500
 *   IPC-2 gross 70,000 → raw 3,500 → capped 3,000 (this 500)
 *   IPC-3 gross 90,000 → 3,000 (this 0)
 *
 * Verifies BR-IP4 (retention with cap — min of raw vs cap, this_period = cum delta).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { computeApplications } from "@domain/payments/ipc-engine";
import type { IpcEngineInput } from "@shared/schemas/payments/ipc";

describe("GT-PAY-3 — Retention cap (authoritative)", () => {
  const input: IpcEngineInput = {
    contractValue: "100000",
    retentionPercent: "5",
    retentionCapAmount: "3000",
    advance: { enabled: false, amount: "0" },
    boqRates: { I1: "100" },
    applications: [
      {
        ipcNo: "IPC-1",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        status: "CERTIFIED",
        lines: [{ itemId: "I1", qtyThisPeriod: "500" }], // cum 500, gross 50,000
        deductions: [],
        additions: [],
      },
      {
        ipcNo: "IPC-2",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        status: "CERTIFIED",
        lines: [{ itemId: "I1", qtyThisPeriod: "200" }], // cum 700, gross 70,000
        deductions: [],
        additions: [],
      },
      {
        ipcNo: "IPC-3",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "CERTIFIED",
        lines: [{ itemId: "I1", qtyThisPeriod: "200" }], // cum 900, gross 90,000
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
  const ipc3 = result.applications[2];

  // ─── IPC-1: gross 50,000 → retention 2,500 (below cap) ───────────────

  it("IPC-1: gross_cum = 50,000.00", () => {
    expect(ipc1.grossCum).toBe("50000.00");
  });

  it("IPC-1: retention_cum = min(round(5% × 50,000, 2), 3,000) = 2,500.00 (BR-IP4)", () => {
    expect(ipc1.retentionCum).toBe("2500.00");
  });

  it("IPC-1: retention_this_period = 2,500.00", () => {
    expect(ipc1.retentionThisPeriod).toBe("2500.00");
  });

  it("IPC-1: net_cum = 50,000 − 2,500 = 47,500.00", () => {
    expect(ipc1.netCum).toBe("47500.00");
  });

  // ─── IPC-2: gross 70,000 → raw 3,500 → capped 3,000 ──────────────────

  it("IPC-2: gross_cum = 70,000.00", () => {
    expect(ipc2.grossCum).toBe("70000.00");
  });

  it("IPC-2: retention_cum = min(round(5% × 70,000, 2), 3,000) = min(3,500, 3,000) = 3,000.00 (BR-IP4 — cap engages)", () => {
    expect(ipc2.retentionCum).toBe("3000.00");
  });

  it("IPC-2: retention_this_period = 3,000 − 2,500 = 500.00 (BR-IP4 — cum delta)", () => {
    expect(ipc2.retentionThisPeriod).toBe("500.00");
  });

  it("IPC-2: net_cum = 70,000 − 3,000 = 67,000.00", () => {
    expect(ipc2.netCum).toBe("67000.00");
  });

  it("IPC-2: net_this_period = 67,000 − 47,500 = 19,500.00", () => {
    expect(ipc2.netThisPeriod).toBe("19500.00");
  });

  // ─── IPC-3: gross 90,000 → retention already at cap ──────────────────

  it("IPC-3: gross_cum = 90,000.00", () => {
    expect(ipc3.grossCum).toBe("90000.00");
  });

  it("IPC-3: retention_cum = min(round(5% × 90,000, 2), 3,000) = min(4,500, 3,000) = 3,000.00 (BR-IP4 — cap holds)", () => {
    expect(ipc3.retentionCum).toBe("3000.00");
  });

  it("IPC-3: retention_this_period = 3,000 − 3,000 = 0.00 (cap reached → zero release)", () => {
    expect(ipc3.retentionThisPeriod).toBe("0.00");
  });

  it("IPC-3: net_cum = 90,000 − 3,000 = 87,000.00", () => {
    expect(ipc3.netCum).toBe("87000.00");
  });

  it("IPC-3: net_this_period = 87,000 − 67,000 = 20,000.00", () => {
    expect(ipc3.netThisPeriod).toBe("20000.00");
  });

  // ─── Summary ─────────────────────────────────────────────────────────

  it("summary: totalRetentionCum = 3,000.00 (saturated at cap)", () => {
    expect(result.summary.totalRetentionCum).toBe("3000.00");
  });

  it("no warnings (no overrun, no advance)", () => {
    expect(result.warnings).toEqual([]);
  });
});
