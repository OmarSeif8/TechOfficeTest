/**
 * Integration tests for PrismaItemLibraryRepository (WO-W-2-c).
 *
 * These tests run against the REAL SQLite database at db/custom.db.
 * They depend on the seed data (10 LibraryCategory rows + 23 APP_GLOBAL
 * ItemLibrary rows) populated by `bun run db:seed`.
 *
 * Strategy:
 *   - DO NOT wipe the library tables — they're seeded once before the suite.
 *   - For tests that CREATE items (test 12, 13), we use deterministic codes
 *     prefixed with `TEST-INT-` and clean them up in `afterEach`.
 *   - For the USER_PRIVATE test (14), we create a transient User row + private
 *     items owned by that user, then delete both in `afterEach`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaItemLibraryRepository } from "@/infrastructure/persistence/prisma/item-library-repository";
import type { ItemLibrary } from "@shared/entities";

// ─── Test-only constants ────────────────────────────────────────────────
const TEST_ITEM_CODE_PREFIX = "TEST-INT-";
const TEST_USER_EMAIL = "test-integration-library@example.com";

// ─── Repository under test ─────────────────────────────────────────────
const repo = new PrismaItemLibraryRepository();

// ─── Cleanup tracker ────────────────────────────────────────────────────
// IDs of ItemLibrary rows created by tests; cleaned up in afterEach.
const createdItemIds = new Set<string>();
// IDs of User rows created by tests; cleaned up in afterEach.
const createdUserIds = new Set<string>();

// ─── before/after hooks ────────────────────────────────────────────────

beforeEach(async () => {
  // Ensure the seed data is present. If the user wiped it, fail loudly.
  const categoryCount = await db.libraryCategory.count();
  const itemCount = await db.itemLibrary.count({ where: { scope: "APP_GLOBAL" } });
  if (categoryCount < 10 || itemCount < 23) {
    throw new Error(
      `Seed data missing: expected ≥10 categories + ≥23 APP_GLOBAL items, ` +
        `got ${categoryCount} categories + ${itemCount} items. Run \`bun run db:seed\` first.`,
    );
  }
});

afterEach(async () => {
  // Delete test-created items first (so they don't reference a deleted user).
  if (createdItemIds.size > 0) {
    await db.itemLibrary.deleteMany({
      where: { id: { in: Array.from(createdItemIds) } },
    });
    createdItemIds.clear();
  }
  // Belt-and-suspenders: also nuke any items with the test code prefix
  // (in case a test crashed before adding its id to the tracker).
  await db.itemLibrary.deleteMany({
    where: { code: { startsWith: TEST_ITEM_CODE_PREFIX } },
  });
  // Delete test-created users.
  if (createdUserIds.size > 0) {
    await db.user.deleteMany({
      where: { id: { in: Array.from(createdUserIds) } },
    });
    createdUserIds.clear();
  }
  // Belt-and-suspenders: also delete by email.
  await db.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
});

// ─── Helper: create a transient test user ────────────────────────────────
async function createTestUser(): Promise<string> {
  const user = await db.user.create({
    data: {
      email: TEST_USER_EMAIL,
      name: "Library Integration Test User",
      // passwordHash null = OAuth-only; fine for ownership tests.
    },
  });
  createdUserIds.add(user.id);
  return user.id;
}

// ─── Helper: get the CONCRETE category id from seed ──────────────────────
async function getConcreteCategoryId(): Promise<string> {
  const cat = await db.libraryCategory.findFirst({
    where: { nameEn: "CONCRETE" },
  });
  if (!cat) throw new Error("CONCRETE category not found in seed");
  return cat.id;
}

// =============================================================================
// TESTS
// =============================================================================

describe("PrismaItemLibraryRepository (WO-W-2-c)", () => {
  // ─── 1. listCategories() ────────────────────────────────────────────────
  it("listCategories() returns the 10 seeded categories, ordered by sortOrder", async () => {
    const categories = await repo.listCategories();
    expect(categories.length).toBe(10);
    // Verify sortOrder ascending.
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i].sortOrder).toBeGreaterThanOrEqual(categories[i - 1].sortOrder);
    }
    // First category is CONCRETE (sortOrder 1), last is PLUMBING (sortOrder 10).
    expect(categories[0].nameEn).toBe("CONCRETE");
    expect(categories[categories.length - 1].nameEn).toBe("PLUMBING");
    // Verify sortOrder values are 1..10.
    const sortOrders = categories.map((c) => c.sortOrder);
    expect(sortOrders.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // ─── 2. search({}) default returns 23 APP_GLOBAL items ───────────────────
  it("search({}) returns the 23 seeded APP_GLOBAL items by default", async () => {
    const items = await repo.search({});
    expect(items.length).toBe(23);
    // All should be APP_GLOBAL scope.
    expect(items.every((i) => i.scope === "APP_GLOBAL")).toBe(true);
  });

  // ─── 3. search({ limit: 5 }) returns 5 items ────────────────────────────
  it("search({ limit: 5 }) returns 5 items", async () => {
    const items = await repo.search({ limit: 5 });
    expect(items.length).toBe(5);
  });

  // ─── 4. Pagination — offset/limit return different sets ──────────────────
  it("search({ offset: 0, limit: 10 }) and search({ offset: 10, limit: 10 }) return different sets", async () => {
    const page1 = await repo.search({ offset: 0, limit: 10 });
    const page2 = await repo.search({ offset: 10, limit: 10 });
    expect(page1.length).toBe(10);
    expect(page2.length).toBe(10);
    // Verify different items (no id overlap).
    const page1Ids = new Set(page1.map((i) => i.id));
    const overlap = page2.filter((i) => page1Ids.has(i.id));
    expect(overlap.length).toBe(0);
    // Verify ordering: page1 items all come before page2 items (by code, then descriptionEn).
    const page1Last = page1[page1.length - 1];
    const page2First = page2[0];
    const sortKey1 = (page1Last.code ?? "") + "|" + page1Last.descriptionEn;
    const sortKey2 = (page2First.code ?? "") + "|" + page2First.descriptionEn;
    expect(sortKey1.localeCompare(sortKey2)).toBeLessThanOrEqual(0);
  });

  // ─── 5. countSearch({}) returns 23 ───────────────────────────────────────
  it("countSearch({}) returns 23", async () => {
    const count = await repo.countSearch({});
    expect(count).toBe(23);
  });

  // ─── 6. search "concrete" matches descriptionEn ──────────────────────────
  it('search({ search: "concrete" }) returns items matching descriptionEn containing "concrete" (case-insensitive)', async () => {
    // Lowercase search term — tests case-insensitivity (seed uses "Concrete" in descriptionEn? actually seed uses lowercase "concrete").
    const items = await repo.search({ search: "concrete" });
    expect(items.length).toBeGreaterThanOrEqual(7); // 6 concrete grades + BLOCK-200
    // All matches should contain "concrete" in descriptionEn (case-insensitive).
    items.forEach((i) => {
      expect(i.descriptionEn.toLowerCase()).toContain("concrete");
    });
    // Verify the C25 item is among them.
    expect(items.some((i) => i.code === "C25")).toBe(true);
    // Verify BLOCK-200 (hollow concrete block) is among them.
    expect(items.some((i) => i.code === "BLOCK-200")).toBe(true);
  });

  // ─── 7. Arabic search "خرسانة" matches descriptionAr ─────────────────────
  it('search({ search: "خرسانة" }) returns concrete items (descriptionAr contains "خرسانة")', async () => {
    const items = await repo.search({ search: "خرسانة" });
    // The seed has 6 concrete items whose descriptionAr starts with "خرسانة جاهزة".
    // (BLOCK-200 descriptionAr is "بلوك خرساني مفرغ" — contains "خرساني" but NOT "خرسانة"
    //  with the ة ending, so it does NOT match the substring.)
    expect(items.length).toBe(6);
    // All 6 should be concrete grades C15..C40.
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual(["C15", "C20", "C25", "C30", "C35", "C40"]);
    // Sanity-check: every match's descriptionAr contains the Arabic word.
    items.forEach((i) => {
      expect(i.descriptionAr).not.toBeNull();
      expect(i.descriptionAr!).toContain("خرسانة");
    });
  });

  // ─── 8. search "C25" matches code ────────────────────────────────────────
  it('search({ search: "C25" }) returns the C25 concrete item (matches code)', async () => {
    const items = await repo.search({ search: "C25" });
    // C25 item matches via code, descriptionEn (grade C25), and descriptionAr (درجة C25).
    // No other item's code or description contains "C25" as a substring.
    expect(items.length).toBe(1);
    expect(items[0].code).toBe("C25");
    expect(items[0].descriptionEn).toContain("C25");
  });

  // ─── 9. search by categoryId ──────────────────────────────────────────────
  it("search({ categoryId: <concrete-category-id> }) returns only items in the CONCRETE category", async () => {
    const categoryId = await getConcreteCategoryId();
    const items = await repo.search({ categoryId });
    // 6 concrete grades (C15..C40) are in the CONCRETE category.
    expect(items.length).toBe(6);
    items.forEach((i) => {
      expect(i.categoryId).toBe(categoryId);
    });
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual(["C15", "C20", "C25", "C30", "C35", "C40"]);
  });

  // ─── 10. getById valid id ────────────────────────────────────────────────
  it("getById() returns the item when given a valid id", async () => {
    // Find the C25 item's id first.
    const c25 = await db.itemLibrary.findFirst({ where: { code: "C25", scope: "APP_GLOBAL" } });
    if (!c25) throw new Error("C25 seed item not found");
    const item = await repo.getById(c25.id);
    expect(item).not.toBeNull();
    expect(item!.id).toBe(c25.id);
    expect(item!.code).toBe("C25");
    expect(item!.descriptionEn).toContain("Ready-mix concrete grade C25");
  });

  // ─── 11. getById non-existent id ────────────────────────────────────────
  it("getById() returns null for non-existent id", async () => {
    const item = await repo.getById("nonexistent-id-12345");
    expect(item).toBeNull();
  });

  // ─── 12. create with default scope APP_GLOBAL ────────────────────────────
  it("create() creates a new item with scope APP_GLOBAL, version=1", async () => {
    const categoryId = await getConcreteCategoryId();
    const item = await repo.create({
      code: TEST_ITEM_CODE_PREFIX + "CREATE-GLOBAL",
      descriptionEn: "Test integration item — global",
      descriptionAr: "عنصر اختبار تكامل — عام",
      categoryId,
      scope: "APP_GLOBAL",
    });
    createdItemIds.add(item.id);

    expect(item.id).toBeTruthy();
    expect(item.code).toBe(TEST_ITEM_CODE_PREFIX + "CREATE-GLOBAL");
    expect(item.scope).toBe("APP_GLOBAL");
    expect(item.version).toBe(1);
    expect(item.ownerId).toBeNull();
    expect(item.categoryId).toBe(categoryId);
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);

    // Verify it's retrievable via getById.
    const fetched = await repo.getById(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.code).toBe(TEST_ITEM_CODE_PREFIX + "CREATE-GLOBAL");
  });

  // ─── 13. create USER_PRIVATE with ownerId ────────────────────────────────
  it("create() with scope USER_PRIVATE and ownerId creates a private item", async () => {
    const userId = await createTestUser();
    const categoryId = await getConcreteCategoryId();
    const item = await repo.create({
      code: TEST_ITEM_CODE_PREFIX + "CREATE-PRIVATE",
      descriptionEn: "Test integration item — private",
      descriptionAr: "عنصر اختبار تكامل — خاص",
      categoryId,
      scope: "USER_PRIVATE",
      ownerId: userId,
    });
    createdItemIds.add(item.id);

    expect(item.scope).toBe("USER_PRIVATE");
    expect(item.ownerId).toBe(userId);
    expect(item.version).toBe(1);
  });

  // ─── 14. search USER_PRIVATE for specific user ──────────────────────────
  it("search({ scope: USER_PRIVATE, ownerId }) returns only that user's private items", async () => {
    const userId = await createTestUser();
    // Create 2 private items for this user.
    const item1 = await repo.create({
      code: TEST_ITEM_CODE_PREFIX + "PRIVATE-1",
      descriptionEn: "Private item 1",
      scope: "USER_PRIVATE",
      ownerId: userId,
    });
    const item2 = await repo.create({
      code: TEST_ITEM_CODE_PREFIX + "PRIVATE-2",
      descriptionEn: "Private item 2",
      scope: "USER_PRIVATE",
      ownerId: userId,
    });
    createdItemIds.add(item1.id);
    createdItemIds.add(item2.id);

    const items = await repo.search({ scope: "USER_PRIVATE", ownerId: userId });
    expect(items.length).toBe(2);
    items.forEach((i) => {
      expect(i.scope).toBe("USER_PRIVATE");
      expect(i.ownerId).toBe(userId);
    });

    // Sanity: countSearch should agree.
    const count = await repo.countSearch({ scope: "USER_PRIVATE", ownerId: userId });
    expect(count).toBe(2);
  });

  // ─── 15. search APP_GLOBAL excludes private items ────────────────────────
  it("search({ scope: APP_GLOBAL }) returns only global items (excludes private)", async () => {
    const userId = await createTestUser();
    // Create a private item that should NOT appear in APP_GLOBAL search.
    const privateItem = await repo.create({
      code: TEST_ITEM_CODE_PREFIX + "EXCLUDE-FROM-GLOBAL",
      descriptionEn: "Private item that should be excluded from APP_GLOBAL search",
      scope: "USER_PRIVATE",
      ownerId: userId,
    });
    createdItemIds.add(privateItem.id);

    const items = await repo.search({ scope: "APP_GLOBAL" });
    expect(items.length).toBe(23); // unchanged from seed
    items.forEach((i) => {
      expect(i.scope).toBe("APP_GLOBAL");
    });
    // Verify the private item is NOT in the results.
    expect(items.some((i) => i.id === privateItem.id)).toBe(false);

    // Also verify countSearch agrees.
    const count = await repo.countSearch({ scope: "APP_GLOBAL" });
    expect(count).toBe(23);
  });
});
