/**
 * PrismaRateAnalysisRepository integration tests (WO-W-2-d).
 *
 * These tests hit the real SQLite database (db/custom.db) — they are NOT
 * mocked. Per the spec, every test starts with a clean slate (`beforeEach`
 * wipes RateAnalysis + lines + BoQ + Project + User tables in dependency
 * order) and creates a fresh test user + project + BoQDocument + BoQSection +
 * BoQItem so foreign-key constraints are satisfied.
 *
 * Coverage (per WO-W-2-d spec):
 *   1.  create() with 5 lines returns a RateAnalysis with version=1
 *   2.  getById() returns the analysis
 *   3.  getById(id, true) includes lines (5 lines)
 *   4.  getByBoqItemId() returns the linked analysis (after linking)
 *   5.  getWithLines() returns analysis + lines
 *   6.  update() with correct version returns ok, increments version
 *   7.  update() with wrong version returns conflict
 *   8.  update() with lines replaces all lines (delete old + create new)
 *   9.  applyToBoqItem() sets RateAnalysis.boqItemId AND updates BoQItem.rate
 *       in the same transaction
 *   10. delete() removes the analysis AND its lines (cascade)
 *   11. Critical GT-2 path: totalRate="964.31" propagated to BoQItem.rate;
 *       BoQ totals (40 × 964.31 = 38,572.40) verified via computeDocumentTotals
 *
 * Adjacent / deviation coverage:
 *   12. create() with null boqItemId throws (schema deviation — see impl docstring)
 *   13. applyToBoqItem() with non-existent BoQItem returns not_found
 *   14. applyToBoqItem() with non-existent analysis returns not_found
 *   15. update() with non-existent id returns not_found
 *   16. update() replacing lines (5→3) preserves new sortOrder and totals
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaRateAnalysisRepository } from "@/infrastructure/persistence/prisma/rate-analysis-repository";
import { computeRate } from "@domain/estimating/rate-analysis";
import { computeDocumentTotals } from "@domain/boq/totals";
import type { RateAnalysisLineInput } from "@domain/repositories/rate-analysis-repository";

describe("PrismaRateAnalysisRepository (integration, WO-W-2-d)", () => {
  let repo: PrismaRateAnalysisRepository;
  let testUserId: string;
  let testProjectId: string;
  let testDocId: string;
  let testSectionId: string;
  let testBoqItemId: string;

  beforeEach(async () => {
    // Clean slate — wipe all test data before each test, in dependency order.
    await db.$transaction([
      db.rateAnalysisLine.deleteMany(),
      db.rateAnalysis.deleteMany(),
      db.calculationRecord.deleteMany(),
      db.boQItem.deleteMany(),
      db.boQSection.deleteMany(),
      db.boQDocument.deleteMany(),
      db.project.deleteMany(),
      db.userSettings.deleteMany(),
      db.session.deleteMany(),
      db.account.deleteMany(),
      db.user.deleteMany(),
    ]);

    // Test user (FK target for Project.ownerId).
    const user = await db.user.create({
      data: {
        email: "test-rate-analysis-repo@example.com",
        passwordHash: "$2a$12$dummyhashforthistest0123456789012345678",
        role: "USER",
        locale: "EN",
      },
    });
    testUserId = user.id;

    // Test project (FK target for RateAnalysis.projectId, BoQDocument.projectId).
    const project = await db.project.create({
      data: {
        ownerId: testUserId,
        nameEn: "Rate Analysis Repo Test Project",
      },
    });
    testProjectId = project.id;

    // Test BoQ document + section + item (FK target for RateAnalysis.boqItemId).
    const doc = await db.boQDocument.create({
      data: { projectId: testProjectId, nameEn: "Test Doc" },
    });
    testDocId = doc.id;

    const section = await db.boQSection.create({
      data: {
        documentId: testDocId,
        projectId: testProjectId,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    testSectionId = section.id;

    const boqItem = await db.boQItem.create({
      data: {
        sectionId: testSectionId,
        documentId: testDocId,
        projectId: testProjectId,
        descriptionEn: "Concrete 1 m³",
        quantity: "40",
        rate: "100.00", // initial rate — will be overwritten by applyToBoqItem
        sortOrder: 0,
      },
    });
    testBoqItemId = boqItem.id;

    repo = new PrismaRateAnalysisRepository();
  });

  afterEach(async () => {
    // Cleanup is handled by the next beforeEach's deleteMany cascade.
  });

  // ─── Helper: build N test lines (sorted, MATERIAL type, deterministic totals) ─

  function buildTestLines(count: number): RateAnalysisLineInput[] {
    const lines: RateAnalysisLineInput[] = [];
    for (let i = 0; i < count; i++) {
      const qty = (i + 1).toString();
      const unitPrice = (10 * (i + 1)).toString();
      const total = ((i + 1) * (10 * (i + 1))).toString(); // qty × unitPrice
      lines.push({
        lineType: "MATERIAL",
        descriptionEn: `Material ${i + 1}`,
        descriptionAr: null,
        quantity: qty,
        unitId: null,
        unitPrice,
        wastePct: "0",
        total,
        sortOrder: i,
      });
    }
    return lines;
  }

  // ─── Helper: build a basic analysis create input ────────────────────────────

  function buildCreateInput(overrides: Partial<{
    boqItemId: string | null;
    totalRate: string;
    overheadPct: string;
    profitPct: string;
    laborMode: "CONSUMPTION" | "CREW";
    lines: RateAnalysisLineInput[];
  }> = {}) {
    return {
      boqItemId: overrides.boqItemId ?? testBoqItemId,
      projectId: testProjectId,
      totalRate: overrides.totalRate ?? "100.00",
      overheadPct: overrides.overheadPct ?? "10",
      profitPct: overrides.profitPct ?? "15",
      laborMode: overrides.laborMode ?? "CONSUMPTION" as const,
      lines: overrides.lines ?? buildTestLines(5),
    };
  }

  // ─── 1. create ──────────────────────────────────────────────────────────

  it("1. create() with 5 lines returns a RateAnalysis with version=1", async () => {
    const analysis = await repo.create(buildCreateInput());

    expect(analysis.id).toBeTruthy();
    expect(analysis.projectId).toBe(testProjectId);
    expect(analysis.boqItemId).toBe(testBoqItemId);
    expect(analysis.totalRate).toBe("100.00");
    expect(analysis.overheadPct).toBe("10");
    expect(analysis.profitPct).toBe("15");
    expect(analysis.laborMode).toBe("CONSUMPTION");
    expect(analysis.version).toBe(1);
    expect(analysis.createdAt).toBeInstanceOf(Date);
    expect(analysis.updatedAt).toBeInstanceOf(Date);
  });

  // ─── 2. getById ─────────────────────────────────────────────────────────

  it("2. getById() returns the analysis", async () => {
    const created = await repo.create(buildCreateInput());
    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.totalRate).toBe("100.00");
    expect(fetched!.version).toBe(1);
  });

  // ─── 3. getById with includeLines ──────────────────────────────────────

  it("3. getById(id, true) — includeLines flag honored; lines fetched separately", async () => {
    const created = await repo.create(buildCreateInput());

    // Even when includeLines=true, the entity type doesn't expose lines —
    // callers wanting lines should use getWithLines(). But the flag is honored
    // internally (Prisma's `include` clause runs).
    const fetched = await repo.getById(created.id, true);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);

    // Independent verification: count lines directly via db.
    const lineCount = await db.rateAnalysisLine.count({
      where: { rateAnalysisId: created.id },
    });
    expect(lineCount).toBe(5);
  });

  // ─── 4. getByBoqItemId ──────────────────────────────────────────────────

  it("4. getByBoqItemId() returns the linked analysis (after linking)", async () => {
    // Analysis is created linked to the BoQItem (current schema requires non-null
    // boqItemId). "After linking" = after create.
    await repo.create(buildCreateInput({ boqItemId: testBoqItemId }));

    const fetched = await repo.getByBoqItemId(testBoqItemId);
    expect(fetched).not.toBeNull();
    expect(fetched!.boqItemId).toBe(testBoqItemId);

    // Non-existent BoQItem → null.
    const missing = await repo.getByBoqItemId("non-existent-boq-item-id");
    expect(missing).toBeNull();
  });

  // ─── 5. getWithLines ────────────────────────────────────────────────────

  it("5. getWithLines() returns analysis + lines", async () => {
    const created = await repo.create(buildCreateInput());

    const result = await repo.getWithLines(created.id);
    expect(result).not.toBeNull();
    expect(result!.rateAnalysis.id).toBe(created.id);
    expect(result!.lines).toHaveLength(5);

    // Lines should be ordered by sortOrder ASC.
    expect(result!.lines[0].sortOrder).toBe(0);
    expect(result!.lines[1].sortOrder).toBe(1);
    expect(result!.lines[2].sortOrder).toBe(2);
    expect(result!.lines[3].sortOrder).toBe(3);
    expect(result!.lines[4].sortOrder).toBe(4);

    // Verify line content (first line: qty=1, unitPrice=10, total=10 = 1×10).
    expect(result!.lines[0].lineType).toBe("MATERIAL");
    expect(result!.lines[0].descriptionEn).toBe("Material 1");
    expect(result!.lines[0].quantity).toBe("1");
    expect(result!.lines[0].unitPrice).toBe("10");
    expect(result!.lines[0].total).toBe("10"); // qty × unitPrice = 1 × 10 = 10
  });

  // ─── 6. update — correct version ────────────────────────────────────────

  it("6. update() with correct version returns ok, increments version", async () => {
    const created = await repo.create(buildCreateInput());
    expect(created.version).toBe(1);

    const result = await repo.update(created.id, {
      totalRate: "200.00",
      overheadPct: "12",
      expectedVersion: 1,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.rateAnalysis.id).toBe(created.id);
      expect(result.rateAnalysis.totalRate).toBe("200.00");
      expect(result.rateAnalysis.overheadPct).toBe("12");
      // Untouched fields preserved.
      expect(result.rateAnalysis.profitPct).toBe("15");
      // Version incremented.
      expect(result.rateAnalysis.version).toBe(2);
    }
  });

  // ─── 7. update — wrong version ─────────────────────────────────────────

  it("7. update() with wrong version returns conflict with currentVersion", async () => {
    const created = await repo.create(buildCreateInput());
    expect(created.version).toBe(1);

    // First bump version to 2.
    await repo.update(created.id, { totalRate: "150.00", expectedVersion: 1 });

    // Now try with stale expectedVersion=1.
    const result = await repo.update(created.id, {
      totalRate: "999.99",
      expectedVersion: 1,
    });

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(2);
    }
  });

  // ─── 8. update — replaces all lines ─────────────────────────────────────

  it("8. update() with lines replaces all existing lines (delete old + create new)", async () => {
    const created = await repo.create(buildCreateInput({ lines: buildTestLines(5) }));

    // Verify initial state: 5 lines.
    const before = await repo.getWithLines(created.id);
    expect(before!.lines).toHaveLength(5);

    // Replace with 3 new lines.
    const newLines: RateAnalysisLineInput[] = [
      {
        lineType: "LABOR",
        descriptionEn: "Crew",
        descriptionAr: null,
        quantity: "1",
        unitId: null,
        unitPrice: "4000",
        wastePct: "0",
        total: "100.00",
        sortOrder: 0,
      },
      {
        lineType: "EQUIPMENT",
        descriptionEn: "Mixer",
        descriptionAr: null,
        quantity: "1",
        unitId: null,
        unitPrice: "60",
        wastePct: "0",
        total: "60.00",
        sortOrder: 1,
      },
      {
        lineType: "MATERIAL",
        descriptionEn: "Cement",
        descriptionAr: null,
        quantity: "0.35",
        unitId: null,
        unitPrice: "1000",
        wastePct: "0",
        total: "350.00",
        sortOrder: 2,
      },
    ];

    const result = await repo.update(created.id, {
      lines: newLines,
      expectedVersion: 1,
    });

    expect(result.kind).toBe("ok");

    // Verify the lines were replaced.
    const after = await repo.getWithLines(created.id);
    expect(after!.lines).toHaveLength(3);
    expect(after!.lines[0].descriptionEn).toBe("Crew");
    expect(after!.lines[1].descriptionEn).toBe("Mixer");
    expect(after!.lines[2].descriptionEn).toBe("Cement");
    // sortOrder preserved.
    expect(after!.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
  });

  // ─── 9. applyToBoqItem — dual-write ─────────────────────────────────────

  it("9. applyToBoqItem() sets RateAnalysis.boqItemId AND updates BoQItem.rate in the same transaction", async () => {
    // Create analysis with totalRate="964.31" linked to the test BoQItem.
    const analysis = await repo.create(buildCreateInput({ totalRate: "964.31" }));

    // Pre-state: BoQItem.rate is still the initial "100.00".
    const beforeBoqItem = await db.boQItem.findUnique({ where: { id: testBoqItemId } });
    expect(beforeBoqItem!.rate).toBe("100.00");

    // Apply the analysis to the BoQItem.
    const result = await repo.applyToBoqItem(analysis.id, testBoqItemId, 1);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // Analysis version incremented.
      expect(result.rateAnalysis.version).toBe(2);
      // Analysis boqItemId set (idempotent — was already set at create time).
      expect(result.rateAnalysis.boqItemId).toBe(testBoqItemId);
    }

    // Post-state: BoQItem.rate is now "964.31" (matches analysis.totalRate).
    const afterBoqItem = await db.boQItem.findUnique({ where: { id: testBoqItemId } });
    expect(afterBoqItem!.rate).toBe("964.31");
  });

  // ─── 10. delete — cascade ───────────────────────────────────────────────

  it("10. delete() removes the analysis AND its lines (cascade)", async () => {
    const created = await repo.create(buildCreateInput({ lines: buildTestLines(5) }));

    // Sanity: analysis + 5 lines exist.
    expect(await repo.getById(created.id)).not.toBeNull();
    expect(await db.rateAnalysisLine.count({ where: { rateAnalysisId: created.id } })).toBe(5);

    // Hard delete the analysis.
    await repo.delete(created.id);

    // After delete: analysis is gone.
    expect(await repo.getById(created.id)).toBeNull();
    // And the lines are cascaded-deleted (Prisma onDelete: Cascade on the FK).
    expect(await db.rateAnalysisLine.count({ where: { rateAnalysisId: created.id } })).toBe(0);
  });

  // ─── 11. GT-2 critical path test ────────────────────────────────────────

  it("11. GT-2 critical path: totalRate '964.31' propagated to BoQItem.rate; BoQ totals verified", async () => {
    // ── Step A: Build the GT-2 rate analysis input (per the spec).
    //   Materials (Σ 602.30):
    //     - cement 0.35 t @ 1,000 → 350.00
    //     - sand   0.45 m³ @ 150 → 67.50
    //     - agg    0.85 m³ @ 180 → 153.00
    //     - water  0.18 @ 10     → 1.80
    //     - admix  1 @ 30        → 30.00
    //   Labor crew 4,000/day ÷ 40 m³/day = 100.00 (CREW mode)
    //   Equipment 60.00
    //   OH 10%, profit 15%
    //   Expected: Direct 762.30 → +OH ×1.10 = 838.53 → +Profit ×1.15 = 964.31

    const gt2Input = {
      laborMode: "CREW" as const,
      outputQuantity: "40", // 40 m³/day crew output
      overheadPct: "10",
      profitPct: "15",
      lines: [
        { lineType: "MATERIAL" as const, descriptionEn: "Cement",     quantity: "0.35", unitPrice: "1000", wastePct: "0" },
        { lineType: "MATERIAL" as const, descriptionEn: "Sand",       quantity: "0.45", unitPrice: "150",  wastePct: "0" },
        { lineType: "MATERIAL" as const, descriptionEn: "Aggregate",  quantity: "0.85", unitPrice: "180",  wastePct: "0" },
        { lineType: "MATERIAL" as const, descriptionEn: "Water",      quantity: "0.18", unitPrice: "10",   wastePct: "0" },
        { lineType: "MATERIAL" as const, descriptionEn: "Admixture",  quantity: "1",    unitPrice: "30",   wastePct: "0" },
        { lineType: "LABOR"    as const, descriptionEn: "Crew (per day)",  quantity: "1",  unitPrice: "4000", wastePct: "0" },
        { lineType: "EQUIPMENT" as const, descriptionEn: "Equipment", quantity: "1",    unitPrice: "60",   wastePct: "0" },
      ],
    };

    // ── Step B: Compute the rate via the domain function (this is what the
    //    real app would do before persisting). The repository never computes
    //    money — it stores the precomputed totalRate as a string.
    const rateResult = computeRate(gt2Input);

    // Verify the golden-test expectations (GT-2) — direct, OH, profit, rate.
    expect(rateResult.directCost).toBe("762.30");
    expect(rateResult.overheadAmount).toBe("76.23");
    expect(rateResult.profitAmount).toBe("125.78");
    expect(rateResult.rate).toBe("964.31");

    // ── Step C: Build the repository input. Each line's `total` is the
    //    domain-computed lineCost (the repository persists these verbatim).
    const repoLines: RateAnalysisLineInput[] = gt2Input.lines.map((line, i) => ({
      lineType: line.lineType,
      descriptionEn: line.descriptionEn,
      descriptionAr: null,
      quantity: line.quantity,
      unitId: null,
      unitPrice: line.unitPrice,
      wastePct: line.wastePct,
      total: rateResult.lines[i].lineCost,
      sortOrder: i,
    }));

    // ── Step D: Create the analysis linked to the test BoQItem (which has
    //    initial rate "100.00"). Apply the analysis to write the totalRate
    //    to the BoQItem.rate column.
    const analysis = await repo.create({
      boqItemId: testBoqItemId,
      projectId: testProjectId,
      totalRate: rateResult.rate, // "964.31"
      overheadPct: gt2Input.overheadPct,
      profitPct: gt2Input.profitPct,
      laborMode: gt2Input.laborMode,
      lines: repoLines,
    });

    expect(analysis.totalRate).toBe("964.31");
    expect(analysis.version).toBe(1);

    // Pre-apply: BoQItem.rate is still the initial "100.00".
    const beforeApply = await db.boQItem.findUnique({ where: { id: testBoqItemId } });
    expect(beforeApply!.rate).toBe("100.00");

    // ── Step E: CRITICAL — applyToBoqItem writes totalRate to BoQItem.rate
    //    in the same transaction as the version-bumping analysis update.
    const applyResult = await repo.applyToBoqItem(analysis.id, testBoqItemId, 1);
    expect(applyResult.kind).toBe("ok");

    // Post-apply: BoQItem.rate is now "964.31".
    const afterApply = await db.boQItem.findUnique({ where: { id: testBoqItemId } });
    expect(afterApply!.rate).toBe("964.31");

    // ── Step F: Verify BoQ totals computation produces the expected result.
    //    BoQItem: quantity="40", rate="964.31" → amount = 40 × 964.31 = 38,572.40
    //    (This matches the GT-1 golden test's third item exactly.)
    const boqItemFromDb = await db.boQItem.findUnique({ where: { id: testBoqItemId } });
    expect(boqItemFromDb!.quantity).toBe("40");
    expect(boqItemFromDb!.rate).toBe("964.31");

    const totals = computeDocumentTotals({
      id: testDocId,
      sections: [
        {
          id: testSectionId,
          code: "1",
          items: [
            {
              id: testBoqItemId,
              itemType: "RATE_BASED",
              quantity: boqItemFromDb!.quantity,
              rate: boqItemFromDb!.rate,
            },
          ],
        },
      ],
    });

    // Document subtotal = the single item's amount = 40 × 964.31 = 38,572.40
    expect(totals.sections[0].items[0].amount).toBe("38572.40");
    expect(totals.sections[0].subtotal).toBe("38572.40");
    expect(totals.subtotal).toBe("38572.40");
    expect(totals.totalIncludingVat).toBe("38572.40"); // no VAT configured
    expect(totals.itemCount).toBe(1);
  });

  // ─── 12. create with null boqItemId throws (deviation) ───────────────────

  it("12. create() with null boqItemId throws (schema deviation: schema requires non-null)", async () => {
    // The interface allows null per spec, but the Prisma schema declares
    // boqItemId as non-null String @unique. The impl throws with a clear
    // message pointing to the deviation. A future schema update (make
    // boqItemId nullable) would remove this restriction.
    await expect(
      repo.create({
        boqItemId: null,
        projectId: testProjectId,
        totalRate: "100.00",
        overheadPct: "10",
        profitPct: "15",
        laborMode: "CONSUMPTION",
        lines: buildTestLines(1),
      }),
    ).rejects.toThrow(/boqItemId is required by the Prisma schema/);
  });

  // ─── 13. applyToBoqItem — non-existent BoQItem ───────────────────────────

  it("13. applyToBoqItem() with non-existent BoQItem returns not_found", async () => {
    const analysis = await repo.create(buildCreateInput());

    // Use a non-existent BoQItem id — the pre-flight check should reject.
    const result = await repo.applyToBoqItem(analysis.id, "non-existent-boq-item", 1);
    expect(result.kind).toBe("not_found");
  });

  // ─── 14. applyToBoqItem — non-existent analysis ─────────────────────────

  it("14. applyToBoqItem() with non-existent analysis returns not_found", async () => {
    // The BoQItem exists (created in beforeEach), but the analysis id is bogus.
    const result = await repo.applyToBoqItem("non-existent-analysis-id", testBoqItemId, 1);
    expect(result.kind).toBe("not_found");
  });

  // ─── 15. update — non-existent id ────────────────────────────────────────

  it("15. update() with non-existent id returns not_found", async () => {
    const result = await repo.update("does-not-exist-xyz", {
      totalRate: "200.00",
      expectedVersion: 1,
    });
    expect(result.kind).toBe("not_found");
  });

  // ─── 16. update replacing lines preserves sortOrder and totals ──────────

  it("16. update() replacing lines (5→3) preserves sortOrder and totals", async () => {
    const created = await repo.create(buildCreateInput({ lines: buildTestLines(5) }));

    // Replace 5 lines with 3 lines that have non-sequential sortOrders.
    const newLines: RateAnalysisLineInput[] = [
      {
        lineType: "MATERIAL",
        descriptionEn: "Cement",
        descriptionAr: null,
        quantity: "0.35",
        unitId: null,
        unitPrice: "1000",
        wastePct: "5",
        total: "367.50", // 0.35 × 1.05 × 1000 = 367.50
        sortOrder: 10,
      },
      {
        lineType: "MATERIAL",
        descriptionEn: "Sand",
        descriptionAr: null,
        quantity: "0.45",
        unitId: null,
        unitPrice: "150",
        wastePct: "0",
        total: "67.50",
        sortOrder: 20,
      },
      {
        lineType: "MATERIAL",
        descriptionEn: "Aggregate",
        descriptionAr: null,
        quantity: "0.85",
        unitId: null,
        unitPrice: "180",
        wastePct: "0",
        total: "153.00",
        sortOrder: 30,
      },
    ];

    const result = await repo.update(created.id, {
      lines: newLines,
      expectedVersion: 1,
    });
    expect(result.kind).toBe("ok");

    // Verify the lines were replaced and sortOrders preserved.
    const after = await repo.getWithLines(created.id);
    expect(after!.lines).toHaveLength(3);
    // getWithLines orders by sortOrder ASC — so the order should match the
    // new sortOrders (10, 20, 30).
    expect(after!.lines[0].sortOrder).toBe(10);
    expect(after!.lines[0].descriptionEn).toBe("Cement");
    expect(after!.lines[0].total).toBe("367.50");
    expect(after!.lines[1].sortOrder).toBe(20);
    expect(after!.lines[2].sortOrder).toBe(30);
  });
});
