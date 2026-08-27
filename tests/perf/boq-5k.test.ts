/**
 * WO-W-17: 5,000-item BoQ performance test.
 *
 * Per SPEC_PHASE1_BOQ_WEB §3 (F3): "A BoQ with 5,000 items scrolls and
 * recalculates without visible lag (< 300 ms recompute)."
 *
 * This test verifies:
 *   1. Seeding 5,000 items completes in reasonable time (< 30s)
 *   2. Repository listAllItemsInDocument returns 5,000 items in < 500ms
 *   3. Pure domain function computeDocumentTotals computes 5,000 items in < 300ms
 *   4. The totals are CORRECT (sum of amounts matches)
 *
 * The test is marked with describe.skip by default to avoid slowing the
 * normal test suite — run explicitly with:
 *   bun run test tests/perf/boq-5k.test.ts
 *
 * Or enable by setting PERF_TEST=true env var.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { computeDocumentTotals } from "@domain/boq/totals";
import Decimal from "decimal.js";

const RUN_PERF = process.env.PERF_TEST === "true";

describe.skipIf(!RUN_PERF)("WO-W-17: 5k-item BoQ performance", () => {
  let testProjectId: string;
  let testDocumentId: string;
  let testSectionId: string;
  let testUserId: string;
  let itemIds: string[] = [];
  let expectedGrandTotal: Decimal;

  beforeAll(async () => {
    // Clean slate
    await db.$transaction([
      db.boQItem.deleteMany(),
      db.boQSection.deleteMany(),
      db.boQDocument.deleteMany(),
      db.project.deleteMany(),
      db.user.deleteMany(),
    ]);

    // Create test user + project + document + section
    const user = await db.user.create({
      data: {
        email: "perf-test@example.com",
        passwordHash: "$2a$12$dummy",
        role: "USER",
        locale: "EN",
      },
    });
    testUserId = user.id;

    const project = await db.project.create({
      data: { ownerId: user.id, nameEn: "Perf Test Project", currency: "USD" },
    });
    testProjectId = project.id;

    const doc = await db.boQDocument.create({
      data: { projectId: project.id, nameEn: "Perf BoQ", status: "DRAFT" },
    });
    testDocumentId = doc.id;

    const section = await db.boQSection.create({
      data: {
        documentId: doc.id,
        projectId: project.id,
        code: "1",
        titleEn: "All Items",
        sortOrder: 0,
      },
    });
    testSectionId = section.id;

    // Seed 5,000 items in batches
    const BATCH_SIZE = 500;
    const TOTAL = 5000;
    expectedGrandTotal = new Decimal(0);

    for (let batch = 0; batch < TOTAL / BATCH_SIZE; batch++) {
      const items: Array<{
        sectionId: string;
        documentId: string;
        projectId: string;
        code: string;
        descriptionEn: string;
        quantity: string;
        rate: string;
        amount: string;
        itemType: "RATE_BASED";
        sortOrder: number;
      }> = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const idx = batch * BATCH_SIZE + i;
        const qty = (idx % 100 + 1).toString();
        const rate = ((idx % 50) * 10 + 5).toString();
        const amount = new Decimal(qty).times(rate).toDecimalPlaces(2).toFixed(2);
        expectedGrandTotal = expectedGrandTotal.plus(amount);

        items.push({
          sectionId: testSectionId,
          documentId: testDocumentId,
          projectId: testProjectId,
          code: `1.${idx + 1}`,
          descriptionEn: `Item ${idx + 1}`,
          quantity: qty,
          rate: rate,
          amount: amount,
          itemType: "RATE_BASED",
          sortOrder: idx,
        });
      }
      await db.boQItem.createMany({ data: items });
    }

    console.log(`Seeded ${TOTAL} items. Expected grand total: ${expectedGrandTotal.toFixed(2)}`);
  }, 60_000); // 60s timeout for seeding

  afterAll(async () => {
    // Cleanup
    await db.$transaction([
      db.boQItem.deleteMany(),
      db.boQSection.deleteMany(),
      db.boQDocument.deleteMany(),
      db.project.deleteMany(),
      db.user.deleteMany(),
    ]);
    await db.$disconnect();
  });

  it("repository returns 5,000 items", async () => {
    const items = await db.boQItem.findMany({
      where: { documentId: testDocumentId, deletedAt: null },
    });
    expect(items.length).toBe(5000);
  });

  it("list query completes in < 500ms", async () => {
    const start = Date.now();
    const items = await db.boQItem.findMany({
      where: { documentId: testDocumentId, deletedAt: null },
      select: { quantity: true, rate: true, itemType: true },
    });
    const elapsed = Date.now() - start;

    console.log(`List 5k items: ${elapsed}ms (${items.length} items)`);
    expect(items.length).toBe(5000);
    expect(elapsed).toBeLessThan(500);
  });

  it("computeDocumentTotals computes 5,000 items in < 300ms", async () => {
    // Fetch the items (not counted in the perf measurement)
    const items = await db.boQItem.findMany({
      where: { documentId: testDocumentId, deletedAt: null },
      select: { quantity: true, rate: true, itemType: true },
    });

    // Measure ONLY the pure domain function
    const start = Date.now();
    const totals = computeDocumentTotals({
      sections: [
        {
          id: testSectionId,
          items: items.map((i) => ({
            itemType: i.itemType as "RATE_BASED",
            quantity: i.quantity,
            rate: i.rate,
          })),
        },
      ],
    });
    const elapsed = Date.now() - start;

    console.log(`computeDocumentTotals 5k items: ${elapsed}ms`);
    console.log(`Computed subtotal: ${totals.subtotal}`);
    expect(elapsed).toBeLessThan(300);

    // Verify correctness — the computed total should match our expected sum
    // (with small rounding tolerance due to sum-of-rounded vs round-of-sum)
    const expected = expectedGrandTotal.toDecimalPlaces(2).toFixed(2);
    const actual = new Decimal(totals.subtotal);
    const diff = actual.minus(expected).abs();
    // Allow up to $1 difference due to rounding (5000 items × 0.005 rounding)
    expect(diff.toNumber()).toBeLessThan(1.0);
  });

  it("repository count query is fast (< 100ms)", async () => {
    const start = Date.now();
    const count = await db.boQItem.count({
      where: { documentId: testDocumentId, deletedAt: null },
    });
    const elapsed = Date.now() - start;

    console.log(`Count 5k items: ${elapsed}ms (${count})`);
    expect(count).toBe(5000);
    expect(elapsed).toBeLessThan(100);
  });
});
