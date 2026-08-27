/**
 * WO-W-17: Multi-tab optimistic concurrency test.
 *
 * Per BR-WEB-4: every PATCH must include expectedVersion. If two clients
 * edit the same item simultaneously, the second client's PATCH should
 * get 409 Conflict.
 *
 * This test simulates the "two tabs" scenario using concurrent API calls
 * against the same item version.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { computeItemAmount } from "@domain/boq/totals";
import Decimal from "decimal.js";

describe("WO-W-17: Optimistic concurrency (BR-WEB-4)", () => {
  let testUserId: string;
  let testProjectId: string;
  let testDocumentId: string;
  let testSectionId: string;
  let testItemId: string;

  beforeAll(async () => {
    // Clean slate
    await db.$transaction([
      db.boQItem.deleteMany(),
      db.boQSection.deleteMany(),
      db.boQDocument.deleteMany(),
      db.project.deleteMany(),
      db.user.deleteMany(),
    ]);

    const user = await db.user.create({
      data: {
        email: "concurrency-test@example.com",
        passwordHash: "$2a$12$dummy",
        role: "USER",
        locale: "EN",
      },
    });
    testUserId = user.id;

    const project = await db.project.create({
      data: { ownerId: user.id, nameEn: "Concurrency Test", currency: "USD" },
    });
    testProjectId = project.id;

    const doc = await db.boQDocument.create({
      data: { projectId: project.id, nameEn: "Concurrency BoQ", status: "DRAFT" },
    });
    testDocumentId = doc.id;

    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: project.id,
        code: "1",
        titleEn: "Test Section",
        sortOrder: 0,
      },
    });
    testSectionId = section.id;

    const item = await db.boQItem.create({
      data: {
        sectionId: section.id,
        documentId: doc.id,
        projectId: project.id,
        code: "1.1",
        descriptionEn: "Concurrency test item",
        quantity: "10",
        rate: "100",
        amount: "1000.00",
        itemType: "RATE_BASED",
        sortOrder: 0,
      },
    });
    testItemId = item.id;
  });

  afterAll(async () => {
    await db.$transaction([
      db.boQItem.deleteMany(),
      db.boQSection.deleteMany(),
      db.boQDocument.deleteMany(),
      db.project.deleteMany(),
      db.user.deleteMany(),
    ]);
    await db.$disconnect();
  });

  it("first update with correct version succeeds", async () => {
    const result = await db.boQItem.updateMany({
      where: { id: testItemId, version: 1, deletedAt: null },
      data: {
        quantity: "20",
        amount: "2000.00",
        version: { increment: 1 },
      },
    });

    expect(result.count).toBe(1); // 1 row updated

    // Verify the version was incremented
    const updated = await db.boQItem.findUnique({ where: { id: testItemId } });
    expect(updated?.version).toBe(2);
    expect(updated?.quantity).toBe("20");
  });

  it("second update with stale (old) version fails — 0 rows updated", async () => {
    // Try to update with the OLD version (1) — should fail because the
    // current version is now 2.
    const result = await db.boQItem.updateMany({
      where: { id: testItemId, version: 1, deletedAt: null },
      data: {
        quantity: "30",
        version: { increment: 1 },
      },
    });

    expect(result.count).toBe(0); // 0 rows updated — conflict detected
  });

  it("update with current version succeeds", async () => {
    const result = await db.boQItem.updateMany({
      where: { id: testItemId, version: 2, deletedAt: null },
      data: {
        quantity: "50",
        amount: "5000.00",
        version: { increment: 1 },
      },
    });

    expect(result.count).toBe(1);

    const updated = await db.boQItem.findUnique({ where: { id: testItemId } });
    expect(updated?.version).toBe(3);
    expect(updated?.quantity).toBe("50");
  });

  it("simulated two-tab concurrent edit — only one succeeds", async () => {
    // Fetch the current version
    const item = await db.boQItem.findUnique({ where: { id: testItemId } });
    const currentVersion = item!.version; // 3

    // Simulate two concurrent updates with the SAME expected version.
    // In a real scenario these would be HTTP requests from two browser tabs.
    // We run them "concurrently" via Promise.all.
    const [result1, result2] = await Promise.all([
      db.boQItem.updateMany({
        where: { id: testItemId, version: currentVersion, deletedAt: null },
        data: { quantity: "100", amount: "10000.00", version: { increment: 1 } },
      }),
      db.boQItem.updateMany({
        where: { id: testItemId, version: currentVersion, deletedAt: null },
        data: { quantity: "200", amount: "20000.00", version: { increment: 1 } },
      }),
    ]);

    // Exactly ONE should succeed (count=1), the other should fail (count=0).
    // Prisma's updateMany is atomic at the SQL level — the WHERE clause
    // includes version, so the second update sees version=currentVersion+1
    // and matches 0 rows.
    const successCount = result1.count + result2.count;
    expect(successCount).toBe(1);

    // Verify the final state — one of the two values won.
    const final = await db.boQItem.findUnique({ where: { id: testItemId } });
    expect(final?.version).toBe(currentVersion + 1);
    expect(["100", "200"]).toContain(final?.quantity);
  });

  it("computeItemAmount produces correct amount after concurrent edits", async () => {
    const item = await db.boQItem.findUnique({ where: { id: testItemId } });
    const computed = computeItemAmount({
      itemType: item!.itemType as "RATE_BASED",
      quantity: item!.quantity,
      rate: item!.rate,
    });

    // The amount should be qty × rate
    const expected = new Decimal(item!.quantity)
      .times(item!.rate)
      .toDecimalPlaces(2)
      .toFixed(2);

    expect(computed.amount).toBe(expected);
  });
});
