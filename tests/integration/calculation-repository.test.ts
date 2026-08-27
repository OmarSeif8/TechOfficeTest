/**
 * PrismaCalculationRepository integration tests (WO-W-2-d).
 *
 * These tests hit the real SQLite database (db/custom.db) — they are NOT
 * mocked. Per the spec, every test starts with a clean slate (`beforeEach`
 * wipes Calculation + BoQ + Project + User tables in dependency order) and
 * creates a fresh test user + project so foreign-key constraints are satisfied.
 *
 * Coverage (per WO-W-2-d spec):
 *   1.  create() returns a CalculationRecord with all fields populated
 *   2.  getById() returns the created record
 *   3.  getById() returns null for non-existent id
 *   4.  listByProject() returns records ordered by createdAt DESC
 *   5.  listByProject(projectId, "CONCRETE") filters by calculatorType
 *   6.  linkToBoqItem() sets linkedBoqItemId + linkedAt
 *   7.  unlinkFromBoqItem() sets linkedBoqItemId=null, keeps linkedAt
 *   8.  delete() removes the record (verify with getById → null)
 *   9.  Orphan-safe (F5): unlink keeps the record visible with linkedBoqItemId=null
 *   10. linkToBoqItem returns null for non-existent record id
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaCalculationRepository } from "@/infrastructure/persistence/prisma/calculation-repository";

describe("PrismaCalculationRepository (integration, WO-W-2-d)", () => {
  let repo: PrismaCalculationRepository;
  let testUserId: string;
  let testProjectId: string;

  beforeEach(async () => {
    // Clean slate — wipe all test data before each test, in dependency order.
    // (All these tables have onDelete: Cascade, but we delete explicitly to be
    // defensive and to keep tests independent of cascade behavior.)
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

    // Create a test user (FK target for Project.ownerId).
    const user = await db.user.create({
      data: {
        email: "test-calc-repo@example.com",
        passwordHash: "$2a$12$dummyhashforthistest0123456789012345678",
        role: "USER",
        locale: "EN",
      },
    });
    testUserId = user.id;

    // Create a test project (FK target for CalculationRecord.projectId).
    const project = await db.project.create({
      data: {
        ownerId: testUserId,
        nameEn: "Calc Repo Test Project",
      },
    });
    testProjectId = project.id;

    repo = new PrismaCalculationRepository();
  });

  afterEach(async () => {
    // Cleanup is handled by the next beforeEach's deleteMany cascade.
  });

  // ─── 1. create ──────────────────────────────────────────────────────────

  it("1. create() returns a CalculationRecord with all fields populated", async () => {
    const record = await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: JSON.stringify({ length: 1, width: 1, height: 1, count: 1 }),
      resultJson: JSON.stringify({ perItem: 1, total: 1 }),
      resultQuantity: "1.00",
      resultUnitId: null,
    });

    expect(record.id).toBeTruthy();
    expect(record.projectId).toBe(testProjectId);
    expect(record.calculatorType).toBe("CONCRETE");
    expect(record.inputsJson).toBe(JSON.stringify({ length: 1, width: 1, height: 1, count: 1 }));
    expect(record.resultJson).toBe(JSON.stringify({ perItem: 1, total: 1 }));
    expect(record.resultQuantity).toBe("1.00");
    expect(record.resultUnitId).toBeNull();
    // Newly-created record is unlinked by default.
    expect(record.linkedBoqItemId).toBeNull();
    expect(record.linkedAt).toBeNull();
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  // ─── 2. getById ─────────────────────────────────────────────────────────

  it("2. getById() returns the created record", async () => {
    const created = await repo.create({
      projectId: testProjectId,
      calculatorType: "FORMWORK",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "3.60",
      resultUnitId: null,
    });

    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.calculatorType).toBe("FORMWORK");
    expect(fetched!.resultQuantity).toBe("3.60");
  });

  // ─── 3. getById — non-existent ─────────────────────────────────────────

  it("3. getById() returns null for non-existent id", async () => {
    const fetched = await repo.getById("does-not-exist-cuid");
    expect(fetched).toBeNull();
  });

  // ─── 4. listByProject — order ──────────────────────────────────────────

  it("4. listByProject() returns records ordered by createdAt DESC", async () => {
    // Insert three records. Add small delays to guarantee distinct timestamps.
    const r1 = await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "1.00",
    });
    await new Promise((r) => setTimeout(r, 15));
    const r2 = await repo.create({
      projectId: testProjectId,
      calculatorType: "FORMWORK",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "2.00",
    });
    await new Promise((r) => setTimeout(r, 15));
    const r3 = await repo.create({
      projectId: testProjectId,
      calculatorType: "REBAR",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "3.00",
    });

    const list = await repo.listByProject(testProjectId);
    expect(list).toHaveLength(3);
    // Most-recent first: r3 was created last, should be first.
    expect(list[0].id).toBe(r3.id);
    expect(list[1].id).toBe(r2.id);
    expect(list[2].id).toBe(r1.id);
  });

  // ─── 5. listByProject — filter by calculatorType ───────────────────────

  it("5. listByProject(projectId, 'CONCRETE') filters by calculatorType", async () => {
    await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "1.00",
    });
    await repo.create({
      projectId: testProjectId,
      calculatorType: "FORMWORK",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "2.00",
    });
    await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "3.00",
    });

    // Filter to CONCRETE only — should return 2 records.
    const concreteOnly = await repo.listByProject(testProjectId, "CONCRETE");
    expect(concreteOnly).toHaveLength(2);
    expect(concreteOnly.every((r) => r.calculatorType === "CONCRETE")).toBe(true);

    // No filter — all 3.
    const all = await repo.listByProject(testProjectId);
    expect(all).toHaveLength(3);

    // Filter to REBAR — 0.
    const rebarOnly = await repo.listByProject(testProjectId, "REBAR");
    expect(rebarOnly).toHaveLength(0);
  });

  // ─── 6. linkToBoqItem ──────────────────────────────────────────────────

  it("6. linkToBoqItem() sets linkedBoqItemId and linkedAt", async () => {
    // First, create a BoQItem to link to.
    const doc = await db.boQDocument.create({
      data: {
        projectId: testProjectId,
        nameEn: "Test Doc",
      },
    });
    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: testProjectId,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    const boqItem = await db.boQItem.create({
      data: {
        sectionId: section.id,
        documentId: doc.id,
        projectId: testProjectId,
        descriptionEn: "Test Item",
        quantity: "10",
        rate: "100.00",
        sortOrder: 0,
      },
    });

    const calc = await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "10.00",
    });
    expect(calc.linkedBoqItemId).toBeNull();
    expect(calc.linkedAt).toBeNull();

    const beforeLink = new Date();
    const linked = await repo.linkToBoqItem(calc.id, boqItem.id);
    expect(linked).not.toBeNull();
    expect(linked!.linkedBoqItemId).toBe(boqItem.id);
    expect(linked!.linkedAt).not.toBeNull();
    expect(linked!.linkedAt!.getTime()).toBeGreaterThanOrEqual(beforeLink.getTime());
  });

  // ─── 7. unlinkFromBoqItem ─────────────────────────────────────────────

  it("7. unlinkFromBoqItem() sets linkedBoqItemId=null, keeps linkedAt for audit", async () => {
    // Set up linked state first (reuse the setup from test 6).
    const doc = await db.boQDocument.create({
      data: { projectId: testProjectId, nameEn: "Test Doc" },
    });
    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: testProjectId,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    const boqItem = await db.boQItem.create({
      data: {
        sectionId: section.id,
        documentId: doc.id,
        projectId: testProjectId,
        descriptionEn: "Test Item",
        quantity: "10",
        rate: "100.00",
        sortOrder: 0,
      },
    });
    const calc = await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "10.00",
    });
    const linked = await repo.linkToBoqItem(calc.id, boqItem.id);
    expect(linked!.linkedBoqItemId).toBe(boqItem.id);
    expect(linked!.linkedAt).not.toBeNull();
    const linkedAtTime = linked!.linkedAt!;

    // Now unlink.
    const unlinked = await repo.unlinkFromBoqItem(calc.id);
    expect(unlinked).not.toBeNull();
    // F5: linkedBoqItemId is now null (orphaned)...
    expect(unlinked!.linkedBoqItemId).toBeNull();
    // ...BUT linkedAt is preserved for audit (the timestamp of when it WAS linked).
    expect(unlinked!.linkedAt).not.toBeNull();
    expect(unlinked!.linkedAt!.getTime()).toBe(linkedAtTime.getTime());
  });

  // ─── 8. delete ─────────────────────────────────────────────────────────

  it("8. delete() removes the record (verified by subsequent getById → null)", async () => {
    const calc = await repo.create({
      projectId: testProjectId,
      calculatorType: "PLASTER",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "5.00",
    });

    // Sanity: exists.
    expect(await repo.getById(calc.id)).not.toBeNull();

    // Hard delete.
    await repo.delete(calc.id);

    // After delete: gone.
    expect(await repo.getById(calc.id)).toBeNull();

    // And the list is empty.
    const list = await repo.listByProject(testProjectId);
    expect(list).toHaveLength(0);
  });

  // ─── 9. Orphan-safe (F5 acceptance criterion) ──────────────────────────

  it("9. F5: deleting the BoQItem keeps the CalculationRecord (SetNull), marked orphaned", async () => {
    // Set up linked state.
    const doc = await db.boQDocument.create({
      data: { projectId: testProjectId, nameEn: "Test Doc" },
    });
    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: testProjectId,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    const boqItem = await db.boQItem.create({
      data: {
        sectionId: section.id,
        documentId: doc.id,
        projectId: testProjectId,
        descriptionEn: "Test Item",
        quantity: "10",
        rate: "100.00",
        sortOrder: 0,
      },
    });
    const calc = await repo.create({
      projectId: testProjectId,
      calculatorType: "CONCRETE",
      inputsJson: "{}",
      resultJson: "{}",
      resultQuantity: "10.00",
    });
    await repo.linkToBoqItem(calc.id, boqItem.id);

    // Verify linked state.
    const linked = await repo.getById(calc.id);
    expect(linked!.linkedBoqItemId).toBe(boqItem.id);

    // Now DELETE the BoQItem. The schema declares
    // `linkedBoqItem BoQItem? @relation(fields: [linkedBoqItemId], references: [id], onDelete: SetNull)`
    // so the CalculationRecord's linkedBoqItemId should be nulled by the DB cascade.
    await db.boQItem.delete({ where: { id: boqItem.id } });

    // F5 acceptance: CalculationRecord still exists, but linkedBoqItemId is null.
    const orphaned = await repo.getById(calc.id);
    expect(orphaned).not.toBeNull();
    expect(orphaned!.linkedBoqItemId).toBeNull();
    // linkedAt is preserved (audit trail of when it WAS linked).
    expect(orphaned!.linkedAt).not.toBeNull();

    // The orphaned record is still visible in listByProject.
    const list = await repo.listByProject(testProjectId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(calc.id);
    expect(list[0].linkedBoqItemId).toBeNull();
  });

  // ─── 10. linkToBoqItem returns null for non-existent record ───────────

  it("10. linkToBoqItem() returns null for non-existent record id", async () => {
    // We need a real BoQItem so the link target is valid — the only failure
    // mode here should be the missing calculation record.
    const doc = await db.boQDocument.create({
      data: { projectId: testProjectId, nameEn: "Test Doc" },
    });
    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: testProjectId,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    const boqItem = await db.boQItem.create({
      data: {
        sectionId: section.id,
        documentId: doc.id,
        projectId: testProjectId,
        descriptionEn: "Test Item",
        quantity: "1",
        rate: "1.00",
        sortOrder: 0,
      },
    });

    const result = await repo.linkToBoqItem("non-existent-calc-id", boqItem.id);
    expect(result).toBeNull();
  });
});
