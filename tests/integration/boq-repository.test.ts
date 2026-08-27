/**
 * Integration tests for PrismaBoQRepository.
 *
 * These tests hit the real SQLite database (configured via DATABASE_URL).
 * The `beforeEach` hook wipes BoQ + Project + User rows (NOT the seed data:
 * units, rebar, shape codes, library items survive) and creates a fresh
 * test user + project + document for each test.
 *
 * Run: `bun run test tests/integration/boq-repository.test.ts`
 *
 * Test 17 is the critical "totals path" test that proves the repository
 * and the domain layer (`@domain/boq/totals`) work end-to-end: items
 * persisted via the repository are read back via `listAllItemsInDocument`,
 * grouped by section, fed into `computeDocumentTotals`, and the GT-1
 * golden value "43389.90" is reproduced EXACTLY.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaBoQRepository } from "@/infrastructure/persistence/prisma/boq-repository";
import { computeDocumentTotals } from "@domain/boq/totals";
import type { BoqDocumentInput, BoqItemInput } from "@shared/schemas/boq/boq-item";
import type { BoQItem } from "@shared/entities";

// ─── Shared fixtures (re-created before each test) ──────────────────────

const repo = new PrismaBoQRepository();

let userId: string;
let projectId: string;
let documentId: string;

beforeEach(async () => {
  // Clean slate — wipe in dependency order (items → sections → documents →
  // projects → users). Seed data (units, rebar, library items) is preserved.
  await db.$transaction([
    db.boQItem.deleteMany(),
    db.boQSection.deleteMany(),
    db.boQDocument.deleteMany(),
    db.project.deleteMany(),
    db.user.deleteMany(),
  ]);

  // Create test user + project + document for use in tests.
  const user = await db.user.create({
    data: {
      email: "test-boq@example.com",
      passwordHash: "$2a$12$dummy",
      role: "USER",
      locale: "EN",
    },
  });
  const project = await db.project.create({
    data: {
      ownerId: user.id,
      nameEn: "Test Project",
      currency: "USD",
    },
  });
  const document = await db.boQDocument.create({
    data: { projectId: project.id, nameEn: "Main BoQ" },
  });

  userId = user.id;
  projectId = project.id;
  documentId = document.id;
});

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Convenience: create a section in the shared document.
 * Default code "S", sortOrder 0.
 */
async function makeSection(
  overrides: Partial<{
    code: string;
    titleEn: string;
    sortOrder: number;
    documentId: string;
  }> = {},
) {
  return repo.createSection({
    documentId: overrides.documentId ?? documentId,
    projectId,
    code: overrides.code ?? "S",
    titleEn: overrides.titleEn ?? "Section",
    sortOrder: overrides.sortOrder ?? 0,
  });
}

/**
 * Convenience: create a RATE_BASED item in a section.
 * Defaults: quantity="1", rate="0", sortOrder=0.
 */
async function makeItem(
  sectionId: string,
  overrides: Partial<{
    quantity: string;
    rate: string;
    code: string | null;
    descriptionEn: string;
    sortOrder: number;
    itemType: "RATE_BASED" | "LUMP_SUM" | "PROVISIONAL_SUM" | "DAYWORK" | "UNIT_ONLY";
  }> = {},
) {
  return repo.createItem({
    sectionId,
    documentId,
    projectId,
    code: overrides.code ?? null,
    descriptionEn: overrides.descriptionEn ?? "Item",
    quantity: overrides.quantity ?? "1",
    rate: overrides.rate ?? "0",
    itemType: overrides.itemType ?? "RATE_BASED",
    sortOrder: overrides.sortOrder ?? 0,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("PrismaBoQRepository — Documents", () => {
  it("1. createDocument() returns a document with status DRAFT, version=1", async () => {
    const doc = await repo.createDocument({
      projectId,
      nameEn: "New Doc",
    });

    expect(doc.id).toBeTruthy();
    expect(doc.projectId).toBe(projectId);
    expect(doc.nameEn).toBe("New Doc");
    expect(doc.status).toBe("DRAFT");
    expect(doc.version).toBe(1);
    expect(doc.deletedAt).toBeNull();
  });

  it("2. listDocuments() returns documents in a project", async () => {
    // beforeEach created 1 document; add 2 more.
    await repo.createDocument({ projectId, nameEn: "Doc A" });
    await repo.createDocument({ projectId, nameEn: "Doc B" });

    const docs = await repo.listDocuments(projectId);
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.nameEn).sort()).toEqual([
      "Doc A",
      "Doc B",
      "Main BoQ",
    ]);
  });

  it("3. listDocuments() excludes soft-deleted by default", async () => {
    // Soft-delete the shared document (its version is 1).
    const result = await repo.softDeleteDocument(documentId, 1);
    expect(result.kind).toBe("ok");

    const visible = await repo.listDocuments(projectId);
    expect(visible).toHaveLength(0);

    const includingDeleted = await repo.listDocuments(projectId, true);
    expect(includingDeleted).toHaveLength(1);
    expect(includingDeleted[0].deletedAt).not.toBeNull();
  });

  it("4. getDocument() returns null for non-existent id", async () => {
    const missing = await repo.getDocument("nonexistent-cuid");
    expect(missing).toBeNull();
  });

  it("4b. getDocument() returns the document when it exists", async () => {
    const doc = await repo.getDocument(documentId);
    expect(doc).not.toBeNull();
    expect(doc!.nameEn).toBe("Main BoQ");
    expect(doc!.version).toBe(1);
  });
});

describe("PrismaBoQRepository — Sections", () => {
  it("5. createSection() returns a section with version=1", async () => {
    const section = await makeSection({ code: "1", titleEn: "First" });

    expect(section.id).toBeTruthy();
    expect(section.documentId).toBe(documentId);
    expect(section.code).toBe("1");
    expect(section.titleEn).toBe("First");
    expect(section.sortOrder).toBe(0);
    expect(section.version).toBe(1);
    expect(section.deletedAt).toBeNull();
  });

  it("6. listSections() returns sections ordered by sortOrder", async () => {
    // Create out-of-order to verify sorting.
    await makeSection({ code: "C", sortOrder: 30 });
    await makeSection({ code: "A", sortOrder: 10 });
    await makeSection({ code: "B", sortOrder: 20 });

    const sections = await repo.listSections(documentId);
    expect(sections.map((s) => s.code)).toEqual(["A", "B", "C"]);
    expect(sections.map((s) => s.sortOrder)).toEqual([10, 20, 30]);
  });

  it("7. reorderSections() updates sortOrder for all sections in transaction", async () => {
    const s1 = await makeSection({ code: "A", sortOrder: 0 });
    const s2 = await makeSection({ code: "B", sortOrder: 1 });
    const s3 = await makeSection({ code: "C", sortOrder: 2 });

    // Reverse the order.
    await repo.reorderSections(documentId, [s3.id, s2.id, s1.id]);

    const after = await repo.listSections(documentId);
    expect(after.map((s) => s.id)).toEqual([s3.id, s2.id, s1.id]);
    expect(after.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("PrismaBoQRepository — Items", () => {
  it("8. createItem() returns an item with itemType RATE_BASED, version=1", async () => {
    const section = await makeSection();
    const item = await makeItem(section.id, {
      quantity: "12.5",
      rate: "85.40",
    });

    expect(item.id).toBeTruthy();
    expect(item.sectionId).toBe(section.id);
    expect(item.documentId).toBe(documentId);
    expect(item.itemType).toBe("RATE_BASED");
    expect(item.quantity).toBe("12.5");
    expect(item.rate).toBe("85.40");
    // BR-2: amount = round(12.5 × 85.40, 2) = 1,067.50
    expect(item.amount).toBe("1067.50");
    expect(item.version).toBe(1);
    expect(item.deletedAt).toBeNull();
  });

  it("9. listItems() returns items in a section, ordered by sortOrder", async () => {
    const section = await makeSection();
    await makeItem(section.id, { descriptionEn: "Third", sortOrder: 30 });
    await makeItem(section.id, { descriptionEn: "First", sortOrder: 10 });
    await makeItem(section.id, { descriptionEn: "Second", sortOrder: 20 });

    const items = await repo.listItems(section.id);
    expect(items.map((i) => i.descriptionEn)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("10. listAllItemsInDocument() returns items across all sections", async () => {
    const s1 = await makeSection({ code: "1", sortOrder: 0 });
    const s2 = await makeSection({ code: "2", sortOrder: 1 });

    await makeItem(s1.id, { descriptionEn: "1.a", sortOrder: 0 });
    await makeItem(s1.id, { descriptionEn: "1.b", sortOrder: 1 });
    await makeItem(s2.id, { descriptionEn: "2.a", sortOrder: 0 });
    await makeItem(s2.id, { descriptionEn: "2.b", sortOrder: 1 });
    await makeItem(s2.id, { descriptionEn: "2.c", sortOrder: 2 });

    const all = await repo.listAllItemsInDocument(documentId);
    expect(all).toHaveLength(5);
    // All items belong to the document.
    expect(all.every((i) => i.documentId === documentId)).toBe(true);
    // All items belong to one of the two sections.
    const sectionIds = new Set(all.map((i) => i.sectionId));
    expect(sectionIds.size).toBe(2);
  });
});

describe("PrismaBoQRepository — Optimistic Concurrency", () => {
  it("11. updateItem() with correct version returns ok and increments version", async () => {
    const section = await makeSection();
    const item = await makeItem(section.id, { quantity: "10", rate: "100" });
    expect(item.version).toBe(1);

    const result = await repo.updateItem(item.id, {
      quantity: "20",
      rate: "100",
      expectedVersion: 1,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.item.version).toBe(2);
      // BR-2: amount = round(20 × 100, 2) = 2,000.00
      expect(result.item.amount).toBe("2000.00");
      expect(result.item.quantity).toBe("20");
    }
  });

  it("12. updateItem() with wrong version returns conflict", async () => {
    const section = await makeSection();
    const item = await makeItem(section.id, { quantity: "10", rate: "100" });

    const result = await repo.updateItem(item.id, {
      quantity: "20",
      expectedVersion: 99, // wrong — actual is 1
    });

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(1);
    }

    // Verify nothing changed.
    const stillOriginal = await repo.getItem(item.id);
    expect(stillOriginal!.quantity).toBe("10");
    expect(stillOriginal!.version).toBe(1);
  });

  it("12b. updateItem() returns not_found for non-existent id", async () => {
    const result = await repo.updateItem("nonexistent-id", {
      quantity: "5",
      expectedVersion: 1,
    });
    expect(result.kind).toBe("not_found");
  });

  it("13. softDeleteItem() sets deletedAt with version check", async () => {
    const section = await makeSection();
    const item = await makeItem(section.id, { quantity: "1", rate: "50" });

    const result = await repo.softDeleteItem(item.id, 1);
    expect(result.kind).toBe("ok");

    // getItem returns null after soft-delete.
    const fetched = await repo.getItem(item.id);
    expect(fetched).toBeNull();

    // But listItems with includeDeleted=true should still see it.
    const all = await repo.listItems(section.id, true);
    expect(all).toHaveLength(1);
    expect(all[0].deletedAt).not.toBeNull();
    // Version was incremented on soft-delete.
    expect(all[0].version).toBe(2);
  });

  it("13b. softDeleteItem() with wrong version returns conflict", async () => {
    const section = await makeSection();
    const item = await makeItem(section.id);

    const result = await repo.softDeleteItem(item.id, 99);
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(1);
    }
  });
});

describe("PrismaBoQRepository — Cascading Soft-Delete", () => {
  it("14. softDeleteDocument() cascades: document + all sections + all items get deletedAt (one transaction)", async () => {
    // Setup: 1 document, 2 sections, 3 items.
    const section1 = await makeSection({ code: "1", sortOrder: 0 });
    const section2 = await makeSection({ code: "2", sortOrder: 1 });
    await makeItem(section1.id, { descriptionEn: "1.a", sortOrder: 0 });
    await makeItem(section1.id, { descriptionEn: "1.b", sortOrder: 1 });
    await makeItem(section2.id, { descriptionEn: "2.a", sortOrder: 0 });

    // Sanity: pre-delete state.
    expect(await repo.listAllItemsInDocument(documentId)).toHaveLength(3);
    expect(await repo.listSections(documentId)).toHaveLength(2);

    // Soft-delete the document with correct version (1).
    const result = await repo.softDeleteDocument(documentId, 1);
    expect(result.kind).toBe("ok");

    // Document is gone from default reads.
    const doc = await repo.getDocument(documentId);
    expect(doc).toBeNull();

    // Document is still readable with includeDeleted=true; deletedAt set.
    const docWithDeleted = await repo.getDocument(documentId, true);
    expect(docWithDeleted).not.toBeNull();
    expect(docWithDeleted!.deletedAt).not.toBeNull();
    expect(docWithDeleted!.version).toBe(2); // version was incremented

    // Cascade: sections + items are also soft-deleted (not visible to
    // default reads).
    const visibleSections = await repo.listSections(documentId);
    expect(visibleSections).toHaveLength(0);
    const visibleItems = await repo.listAllItemsInDocument(documentId);
    expect(visibleItems).toHaveLength(0);

    // But all rows are still present when explicitly asking for tombstoned
    // rows — proving they were SOFT-deleted, not hard-deleted.
    const tombstonedSections = await repo.listSections(documentId, true);
    expect(tombstonedSections).toHaveLength(2);
    expect(tombstonedSections.every((s) => s.deletedAt !== null)).toBe(true);

    const tombstonedItems = await repo.listAllItemsInDocument(documentId, true);
    expect(tombstonedItems).toHaveLength(3);
    expect(tombstonedItems.every((i) => i.deletedAt !== null)).toBe(true);

    // All tombstones share the same timestamp — proving the cascade ran
    // inside a single transaction (otherwise the timestamps could drift
    // across milliseconds and the test would be flaky). This is a stronger
    // assertion than "deletedAt is non-null".
    const allDeletedAts = [
      docWithDeleted!.deletedAt!,
      ...tombstonedSections.map((s) => s.deletedAt!),
      ...tombstonedItems.map((i) => i.deletedAt!),
    ];
    const first = allDeletedAts[0].getTime();
    expect(allDeletedAts.every((d) => d.getTime() === first)).toBe(true);
  });

  it("14b. softDeleteDocument() with wrong version does NOT cascade", async () => {
    const section = await makeSection({ code: "1" });
    await makeItem(section.id);

    // Wrong version (actual is 1).
    const result = await repo.softDeleteDocument(documentId, 99);
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(1);
    }

    // Verify nothing was cascaded.
    const doc = await repo.getDocument(documentId);
    expect(doc).not.toBeNull();
    expect(doc!.deletedAt).toBeNull();

    const sections = await repo.listSections(documentId);
    expect(sections).toHaveLength(1);
    expect(sections[0].deletedAt).toBeNull();

    const items = await repo.listAllItemsInDocument(documentId);
    expect(items).toHaveLength(1);
    expect(items[0].deletedAt).toBeNull();
  });
});

describe("PrismaBoQRepository — Move & Renumber", () => {
  it("15. moveItem() updates sectionId and sortOrder", async () => {
    const s1 = await makeSection({ code: "1", sortOrder: 0 });
    const s2 = await makeSection({ code: "2", sortOrder: 1 });
    const item = await makeItem(s1.id, { sortOrder: 0 });

    // Move item from s1 to s2 with new sortOrder 7.
    await repo.moveItem(item.id, s2.id, 7);

    // Verify via direct DB read (since getItem returns the BoQItem entity).
    const moved = await repo.getItem(item.id);
    expect(moved).not.toBeNull();
    expect(moved!.sectionId).toBe(s2.id);
    expect(moved!.sortOrder).toBe(7);
  });

  it("16. renumberItems() sets codes like '1.1', '1.2', '2.1' based on section + item order (BR-7)", async () => {
    const s1 = await makeSection({ code: "old1", sortOrder: 0 });
    const s2 = await makeSection({ code: "old2", sortOrder: 1 });

    // Section 1: 2 items (out-of-order to verify sort)
    const i1a = await makeItem(s1.id, { sortOrder: 10, code: "old" });
    const i1b = await makeItem(s1.id, { sortOrder: 5, code: "old" });
    // Section 2: 1 item
    const i2a = await makeItem(s2.id, { sortOrder: 0, code: "old" });

    await repo.renumberItems(documentId);

    // Fetch via DB to see the persisted codes.
    const all = await repo.listAllItemsInDocument(documentId);
    const byId = new Map(all.map((i) => [i.id, i]));

    // Section 1, ordered by sortOrder: i1b (5) comes first, then i1a (10).
    expect(byId.get(i1b.id)!.code).toBe("1.1");
    expect(byId.get(i1a.id)!.code).toBe("1.2");
    // Section 2: only item.
    expect(byId.get(i2a.id)!.code).toBe("2.1");
  });
});

describe("PrismaBoQRepository — Totals Path (GT-1 end-to-end)", () => {
  it("17. listAllItemsInDocument() feeds computeDocumentTotals() — subtotal === '43389.90' (GT-1)", async () => {
    // Build the GT-1 fixture via the repository:
    //   Section 1: (12.5 × 85.40), (3 × 1,250.00)
    //   Section 2: (40 × 964.31)
    // VAT 14%.
    const s1 = await makeSection({ code: "1", sortOrder: 0, titleEn: "Section 1" });
    const s2 = await makeSection({ code: "2", sortOrder: 1, titleEn: "Section 2" });

    const i1 = await repo.createItem({
      sectionId: s1.id,
      documentId,
      projectId,
      descriptionEn: "Item 1",
      quantity: "12.5",
      rate: "85.40",
      sortOrder: 0,
    });
    const i2 = await repo.createItem({
      sectionId: s1.id,
      documentId,
      projectId,
      descriptionEn: "Item 2",
      quantity: "3",
      rate: "1250.00",
      sortOrder: 1,
    });
    const i3 = await repo.createItem({
      sectionId: s2.id,
      documentId,
      projectId,
      descriptionEn: "Item 3",
      quantity: "40",
      rate: "964.31",
      sortOrder: 0,
    });

    // ─── Verify denormalised amounts were computed correctly at write time ──
    expect(i1.amount).toBe("1067.50"); // 12.5 × 85.40
    expect(i2.amount).toBe("3750.00"); // 3 × 1250.00
    expect(i3.amount).toBe("38572.40"); // 40 × 964.31

    // ─── Repository → Domain layer bridge ────────────────────────────────
    //
    // 1. Read all items back via the repository (the totals-path read).
    // 2. Read all sections back (to preserve section identity + sortOrder).
    // 3. Group items by sectionId, ordered by section sortOrder.
    // 4. Build a BoqDocumentInput and call computeDocumentTotals.
    //
    // This is EXACTLY the shape a real service-layer caller would use.

    const allItems: BoQItem[] = await repo.listAllItemsInDocument(documentId);
    expect(allItems).toHaveLength(3);

    const sections = await repo.listSections(documentId);
    expect(sections).toHaveLength(2);
    // Sanity: sections are sorted by sortOrder.
    expect(sections.map((s) => s.code)).toEqual(["1", "2"]);

    // Build the BoqDocumentInput — section-by-section, items grouped inside.
    const sectionInputs = sections.map((section) => {
      const itemsInThisSection: BoQItem[] = allItems
        .filter((it) => it.sectionId === section.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const itemInputs: BoqItemInput[] = itemsInThisSection.map((it) => ({
        id: it.id,
        itemType: it.itemType,
        quantity: it.quantity,
        rate: it.rate,
      }));

      return {
        id: section.id,
        code: section.code,
        titleEn: section.titleEn,
        items: itemInputs,
      };
    });

    const docInput: BoqDocumentInput = {
      id: documentId,
      sections: sectionInputs,
      vatPercentage: "14",
    };

    const totals = computeDocumentTotals(docInput);

    // ─── GT-1 expected values (must reproduce EXACTLY) ──────────────────
    // Item amounts: 1,067.50 · 3,750.00 · 38,572.40
    expect(totals.sections[0].items[0].amount).toBe("1067.50");
    expect(totals.sections[0].items[1].amount).toBe("3750.00");
    expect(totals.sections[1].items[0].amount).toBe("38572.40");

    // Section subtotals: 4,817.50 (s1) · 38,572.40 (s2)
    expect(totals.sections[0].subtotal).toBe("4817.50");
    expect(totals.sections[1].subtotal).toBe("38572.40");

    // Document subtotal: 4,817.50 + 38,572.40 = 43,389.90  ← THE GT-1 VALUE
    expect(totals.subtotal).toBe("43389.90");

    // VAT (14%): 43,389.90 × 0.14 = 6,074.586 → 6,074.59 (HALF_UP)
    expect(totals.vatAmount).toBe("6074.59");

    // Total incl. VAT: 43,389.90 + 6,074.59 = 49,464.49
    expect(totals.totalIncludingVat).toBe("49464.49");

    // Item count: 3 RATE_BASED items.
    expect(totals.itemCount).toBe(3);
  });
});
