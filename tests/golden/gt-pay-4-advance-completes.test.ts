/**
 * GT-PAY-4 — Advance recovery completes (Golden Test — AUTHORITATIVE).
 *
 * From SPEC_PHASE4_WEB.md §4:
 *   Contract 200,000 · advance 40,000
 *   Scenario A: gross cum 200,000 → recovery 40,000 exactly (no warning).
 *   Scenario B: gross cum 210,000 → recovery still 40,000 (capped) + warning.
 *
 * Verifies BR-IP5 (proportional advance recovery with cumulative cap).
 *
 * This test is the AUTHORITATIVE source of truth. If it fails, the code is wrong.
 */

import { describe, it, expect } from "vitest";
import { computeApplications } from "@domain/payments/ipc-engine";
import type { IpcEngineInput } from "@shared/schemas/payments/ipc";

describe("GT-PAY-4 — Advance recovery completes (authoritative)", () => {
  // ─── Scenario A: gross cum exactly equals contract value ───────────────

  describe("scenario A — gross cum = contract value (recovery = advance exactly)", () => {
    const input: IpcEngineInput = {
      contractValue: "200000",
      retentionPercent: "0", // disable retention to isolate advance recovery
      advance: { enabled: true, amount: "40000" },
      boqRates: { I1: "100" },
      applications: [
        {
          ipcNo: "IPC-1",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          status: "CERTIFIED",
          lines: [{ itemId: "I1", qtyThisPeriod: "2000" }], // cum 2,000 → gross 200,000
          deductions: [],
          additions: [],
        },
      ],
    };

    const result = computeApplications(input);
    if (result.kind !== "success") throw new Error("expected success");

    it("IPC-1: gross_cum = 200,000.00 (matches contract value)", () => {
      expect(result.applications[0].grossCum).toBe("200000.00");
    });

    it("IPC-1: recovery_this_period = round(40,000 × 200,000 / 200,000, 2) = 40,000.00 (BR-IP5)", () => {
      expect(result.applications[0].recoveryThisPeriod).toBe("40000.00");
    });

    it("IPC-1: recovery_cum = 40,000.00 (advance fully recovered — no cap)", () => {
      expect(result.applications[0].recoveryCum).toBe("40000.00");
    });

    it("IPC-1: net_cum = 200,000 − 0 − 40,000 = 160,000.00", () => {
      expect(result.applications[0].netCum).toBe("160000.00");
    });

    it("summary: advanceRemaining = 0.00 (fully recovered)", () => {
      expect(result.summary.advanceRemaining).toBe("0.00");
    });

    it("no ADVANCE_RECOVERY_CAPPED warning (recovery equals advance exactly, not exceeds)", () => {
      const capped = result.warnings.find((w) => w.code === "ADVANCE_RECOVERY_CAPPED");
      expect(capped).toBeUndefined();
    });
  });

  // ─── Scenario B: gross cum exceeds contract value ─────────────────────

  describe("scenario B — gross cum overshoots contract value (recovery capped)", () => {
    const input: IpcEngineInput = {
      contractValue: "200000",
      retentionPercent: "0",
      advance: { enabled: true, amount: "40000" },
      boqRates: { I1: "100" },
      applications: [
        {
          ipcNo: "IPC-1",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          status: "CERTIFIED",
          lines: [{ itemId: "I1", qtyThisPeriod: "2100" }], // cum 2,100 → gross 210,000
          deductions: [],
          additions: [],
        },
      ],
    };

    const result = computeApplications(input);
    if (result.kind !== "success") throw new Error("expected success");

    it("IPC-1: gross_cum = 210,000.00 (exceeds contract value 200,000)", () => {
      expect(result.applications[0].grossCum).toBe("210000.00");
    });

    it("IPC-1: recovery_cum capped at advance = 40,000.00 (BR-IP5 — cum ≤ advance)", () => {
      expect(result.applications[0].recoveryCum).toBe("40000.00");
    });

    it("IPC-1: recovery_this_period = 40,000.00 (capped — would have been 42,000)", () => {
      expect(result.applications[0].recoveryThisPeriod).toBe("40000.00");
    });

    it("IPC-1: net_cum = 210,000 − 0 − 40,000 = 170,000.00", () => {
      expect(result.applications[0].netCum).toBe("170000.00");
    });

    it("summary: advanceRemaining = 0.00 (fully recovered)", () => {
      expect(result.summary.advanceRemaining).toBe("0.00");
    });

    it("emits ADVANCE_RECOVERY_CAPPED warning (BR-IP5)", () => {
      const capped = result.warnings.find((w) => w.code === "ADVANCE_RECOVERY_CAPPED");
      expect(capped).toBeDefined();
      expect(capped?.ipcNo).toBe("IPC-1");
    });
  });

  // ─── Scenario C: two-IPC recovery (cumulative cap engages mid-stream) ───

  describe("scenario C — recovery completes across two IPCs", () => {
    const input: IpcEngineInput = {
      contractValue: "200000",
      retentionPercent: "0",
      advance: { enabled: true, amount: "40000" },
      boqRates: { I1: "100" },
      applications: [
        {
          ipcNo: "IPC-1",
          periodStart: "2026-01-01",
          periodEnd: "2026-06-30",
          status: "CERTIFIED",
          lines: [{ itemId: "I1", qtyThisPeriod: "1000" }], // cum 1,000 → gross 100,000
          deductions: [],
          additions: [],
        },
        {
          ipcNo: "IPC-2",
          periodStart: "2026-07-01",
          periodEnd: "2026-12-31",
          status: "CERTIFIED",
          lines: [{ itemId: "I1", qtyThisPeriod: "1100" }], // cum 2,100 → gross 210,000
          deductions: [],
          additions: [],
        },
      ],
    };

    const result = computeApplications(input);
    if (result.kind !== "success") throw new Error("expected success");

    it("IPC-1: recovery_this_period = round(40,000 × 100,000 / 200,000, 2) = 20,000.00", () => {
      expect(result.applications[0].recoveryThisPeriod).toBe("20000.00");
    });

    it("IPC-1: recovery_cum = 20,000.00 (below advance)", () => {
      expect(result.applications[0].recoveryCum).toBe("20000.00");
    });

    it("IPC-2: recovery_this_period = 40,000 − 20,000 = 20,000.00 (capped — would have been 22,000)", () => {
      // Proportional: round(40,000 × 110,000 / 200,000, 2) = 22,000.
      // Cumulative attempt: 20,000 + 22,000 = 42,000 > 40,000 → capped.
      // this_period = 40,000 − 20,000 = 20,000.
      expect(result.applications[1].recoveryThisPeriod).toBe("20000.00");
    });

    it("IPC-2: recovery_cum = 40,000.00 (cap engages on second IPC)", () => {
      expect(result.applications[1].recoveryCum).toBe("40000.00");
    });

    it("IPC-2: emits ADVANCE_RECOVERY_CAPPED warning", () => {
      const capped = result.warnings.find(
        (w) => w.code === "ADVANCE_RECOVERY_CAPPED" && w.ipcNo === "IPC-2",
      );
      expect(capped).toBeDefined();
    });
  });
});
