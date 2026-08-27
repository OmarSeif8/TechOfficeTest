/**
 * PrismaProjectRepository integration tests (WO-W-2-a).
 *
 * These tests hit the real SQLite database (db/custom.db) — they are NOT
 * mocked. Per the spec, every test starts with a clean slate (`beforeEach`
 * wipes BoQ + Project + User tables in dependency order) and creates a fresh
 * test user so foreign-key constraints are satisfied.
 *
 * Coverage:
 *   1.  create() → version=1, currency default USD
 *   2.  getById() returns the created project
 *   3.  getById() returns null for non-existent id
 *   4.  getById() returns null for soft-deleted (includeDeleted=false default)
 *   5.  getById() returns soft-deleted when includeDeleted=true
 *   6.  list() ordered by updatedAt desc
 *   7.  list() with ownerId filter
 *   8.  list() with search filter (nameEn, nameAr, clientEn)
 *   9.  list() excludes soft-deleted by default
 *   10. count() matches list().length
 *   11. update() with correct version → ok + incremented version
 *   12. update() with wrong version → conflict + currentVersion
 *   13. update() for non-existent id → not_found
 *   14. softDelete() sets deletedAt → ok
 *   15. softDelete() with wrong version → conflict
 *   16. restore() unsets deletedAt
 *   17. Concurrent updates — only the first wins, second gets conflict
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaProjectRepository } from "@/infrastructure/persistence/prisma/project-repository";

describe("PrismaProjectRepository (integration)", () => {
  let repo: PrismaProjectRepository;
  let testUserId: string;
  let otherUserId: string;

  beforeEach(async () => {
    // Clean slate — wipe all test data before each test.
    // Order matters: delete children before parents to respect FK constraints.
    // (All these tables have onDelete: Cascade, but we delete explicitly to be
    // defensive and to keep the test independent of cascade behavior.)
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

    // Primary test user — owns most projects in these tests.
    const user = await db.user.create({
      data: {
        email: "test-project-repo@example.com",
        passwordHash: "$2a$12$dummyhashforthistest0123456789012345678",
        role: "USER",
        locale: "EN",
      },
    });
    testUserId = user.id;

    // Secondary user — for ownerId filter test (test 7).
    const other = await db.user.create({
      data: {
        email: "other-project-repo@example.com",
        passwordHash: "$2a$12$dummyhashforthistest0123456789012345678",
        role: "USER",
        locale: "EN",
      },
    });
    otherUserId = other.id;

    repo = new PrismaProjectRepository();
  });

  afterEach(async () => {
    // Cleanup is handled by the next beforeEach's deleteMany cascade.
    // Disconnect any open connections the repo might be holding.
  });

  // ─── create ────────────────────────────────────────────────────────────

  it("1. create() returns a Project with version=1 and default currency USD", async () => {
    const project = await repo.create({
      ownerId: testUserId,
      nameEn: "Tower A",
    });

    expect(project.id).toBeTruthy();
    expect(project.ownerId).toBe(testUserId);
    expect(project.nameEn).toBe("Tower A");
    expect(project.nameAr).toBeNull();
    expect(project.clientEn).toBeNull();
    expect(project.currency).toBe("USD");
    expect(project.version).toBe(1);
    expect(project.deletedAt).toBeNull();
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
  });

  it("create() respects explicit currency override", async () => {
    const project = await repo.create({
      ownerId: testUserId,
      nameEn: "Tower B",
      currency: "EUR",
    });
    expect(project.currency).toBe("EUR");
  });

  // ─── getById ───────────────────────────────────────────────────────────

  it("2. getById() returns the created project", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: " getById test",
    });
    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.nameEn).toBe(" getById test");
  });

  it("3. getById() returns null for non-existent id", async () => {
    const fetched = await repo.getById("non-existent-id-12345");
    expect(fetched).toBeNull();
  });

  it("4. getById() returns null for soft-deleted project when includeDeleted=false (default)", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Soft-deleted Project",
    });
    await repo.softDelete(created.id, 1);

    const fetched = await repo.getById(created.id);
    expect(fetched).toBeNull();
  });

  it("5. getById() returns soft-deleted project when includeDeleted=true", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Soft-deleted Project",
    });
    await repo.softDelete(created.id, 1);

    const fetched = await repo.getById(created.id, true);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.deletedAt).not.toBeNull();
  });

  // ─── list ──────────────────────────────────────────────────────────────

  it("6. list() returns projects ordered by updatedAt desc", async () => {
    // Create three projects. The DB `updatedAt` is set on insert and again on
    // any update. To guarantee distinct timestamps we use Prisma create with
    // explicit updatedAt values via a small delay, OR rely on the fact that
    // the second project is created after the first.
    const p1 = await repo.create({ ownerId: testUserId, nameEn: "Project 1" });
    // Small delay so updatedAt differs by at least 1ms
    await new Promise((r) => setTimeout(r, 10));
    const p2 = await repo.create({ ownerId: testUserId, nameEn: "Project 2" });
    await new Promise((r) => setTimeout(r, 10));
    const p3 = await repo.create({ ownerId: testUserId, nameEn: "Project 3" });

    const list = await repo.list({});
    expect(list).toHaveLength(3);
    // Most recent first — p3 was created last, so should be first.
    expect(list[0].id).toBe(p3.id);
    expect(list[1].id).toBe(p2.id);
    expect(list[2].id).toBe(p1.id);
  });

  it("7. list() with ownerId filter returns only that user's projects", async () => {
    await repo.create({ ownerId: testUserId, nameEn: "Mine A" });
    await repo.create({ ownerId: testUserId, nameEn: "Mine B" });
    await repo.create({ ownerId: otherUserId, nameEn: "Theirs A" });

    const mine = await repo.list({ ownerId: testUserId });
    const theirs = await repo.list({ ownerId: otherUserId });

    expect(mine).toHaveLength(2);
    expect(mine.every((p) => p.ownerId === testUserId)).toBe(true);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].ownerId).toBe(otherUserId);
  });

  it("8. list() with search filter matches nameEn, nameAr, clientEn", async () => {
    await repo.create({
      ownerId: testUserId,
      nameEn: "Riverside Tower",
      nameAr: "برج النهر",
      clientEn: "Acme Corp",
    });
    await repo.create({
      ownerId: testUserId,
      nameEn: "Industrial Park",
      clientEn: "Globex LLC",
    });
    await repo.create({
      ownerId: testUserId,
      nameEn: "Unrelated Project",
      clientEn: "Initech",
    });

    // Match by nameEn substring (case-insensitive)
    const byNameEn = await repo.list({ search: "riverside" });
    expect(byNameEn).toHaveLength(1);
    expect(byNameEn[0].nameEn).toBe("Riverside Tower");

    // Match by nameAr substring
    const byNameAr = await repo.list({ search: "النهر" });
    expect(byNameAr).toHaveLength(1);
    expect(byNameAr[0].nameEn).toBe("Riverside Tower");

    // Match by clientEn substring
    const byClientEn = await repo.list({ search: "acme" });
    expect(byClientEn).toHaveLength(1);
    expect(byClientEn[0].clientEn).toBe("Acme Corp");

    // Match-all: "a" appears in many fields → expect multiple results.
    const broad = await repo.list({ search: "a" });
    expect(broad.length).toBeGreaterThanOrEqual(2);
  });

  it("9. list() excludes soft-deleted by default", async () => {
    const p1 = await repo.create({ ownerId: testUserId, nameEn: "Alive" });
    const p2 = await repo.create({ ownerId: testUserId, nameEn: "Dead" });
    await repo.softDelete(p2.id, 1);

    const list = await repo.list({});
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(p1.id);

    // And includeDeleted=true surfaces the tombstoned one too.
    const listAll = await repo.list({ includeDeleted: true });
    expect(listAll).toHaveLength(2);
  });

  // ─── count ────────────────────────────────────────────────────────────

  it("10. count() matches list().length under various filters", async () => {
    await repo.create({ ownerId: testUserId, nameEn: "Alpha" });
    await repo.create({ ownerId: testUserId, nameEn: "Beta" });
    await repo.create({ ownerId: otherUserId, nameEn: "Gamma" });

    // All
    expect(await repo.count({})).toBe(3);
    expect((await repo.list({})).length).toBe(3);

    // By owner
    expect(await repo.count({ ownerId: testUserId })).toBe(2);
    expect((await repo.list({ ownerId: testUserId })).length).toBe(2);

    // By search
    expect(await repo.count({ search: "a" })).toBeGreaterThanOrEqual(2);
    expect((await repo.list({ search: "a" })).length).toBe(await repo.count({ search: "a" }));

    // Pagination doesn't affect count
    expect(await repo.count({ limit: 1, offset: 0 })).toBe(3);
  });

  // ─── update ────────────────────────────────────────────────────────────

  it("11. update() with correct version returns ok and increments version", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Original Name",
      clientEn: "Original Client",
    });
    expect(created.version).toBe(1);

    const result = await repo.update(created.id, {
      nameEn: "Updated Name",
      expectedVersion: 1,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.project.id).toBe(created.id);
      expect(result.project.nameEn).toBe("Updated Name");
      // Untouched field preserved
      expect(result.project.clientEn).toBe("Original Client");
      // Version incremented
      expect(result.project.version).toBe(2);
    }
  });

  it("12. update() with wrong version returns conflict with currentVersion", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "v1",
    });
    // Bump to v2 (simulating another user editing first)
    await repo.update(created.id, { nameEn: "v2", expectedVersion: 1 });

    // Now try to update with the stale v1 expectation
    const result = await repo.update(created.id, {
      nameEn: "stale write",
      expectedVersion: 1,
    });

    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(2);
    }
  });

  it("13. update() for non-existent id returns not_found", async () => {
    const result = await repo.update("does-not-exist-xyz", {
      nameEn: "Nobody",
      expectedVersion: 1,
    });
    expect(result.kind).toBe("not_found");
  });

  // ─── softDelete ────────────────────────────────────────────────────────

  it("14. softDelete() sets deletedAt and returns ok", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "To Be Deleted",
    });

    const result = await repo.softDelete(created.id, 1);
    expect(result.kind).toBe("ok");

    // Verify the row is actually tombstoned
    const fetched = await repo.getById(created.id, true);
    expect(fetched).not.toBeNull();
    expect(fetched!.deletedAt).not.toBeNull();
    // Version should have been incremented as part of the optimistic write
    expect(fetched!.version).toBe(2);
  });

  it("15. softDelete() with wrong version returns conflict", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "v1",
    });
    // Bump to v2 first
    await repo.update(created.id, { nameEn: "v2", expectedVersion: 1 });

    // Now try to soft-delete with stale v1
    const result = await repo.softDelete(created.id, 1);
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.currentVersion).toBe(2);
    }
  });

  // ─── restore ───────────────────────────────────────────────────────────

  it("16. restore() unsets deletedAt", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Deleted Then Restored",
    });
    await repo.softDelete(created.id, 1);

    // Confirm it's soft-deleted
    expect(await repo.getById(created.id)).toBeNull();

    // Restore
    const restored = await repo.restore(created.id);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(created.id);
    expect(restored!.deletedAt).toBeNull();

    // Confirm it's now visible to default getById
    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.deletedAt).toBeNull();
  });

  it("restore() returns null for non-existent id", async () => {
    const result = await repo.restore("does-not-exist");
    expect(result).toBeNull();
  });

  it("restore() on already-live project returns the project unchanged", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Never Deleted",
    });
    const result = await repo.restore(created.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.deletedAt).toBeNull();
  });

  // ─── optimistic concurrency stress test ───────────────────────────────

  it("17. Concurrent updates — only the first wins, the second gets conflict", async () => {
    const created = await repo.create({
      ownerId: testUserId,
      nameEn: "Concurrent Target",
    });
    expect(created.version).toBe(1);

    // Fire two updates simultaneously with the same expectedVersion=1.
    // SQLite serializes writes, so exactly one updateMany will match (count=1)
    // and the other will miss (count=0 → conflict). The order is not
    // guaranteed, but the outcome is: one ok, one conflict.
    const [a, b] = await Promise.all([
      repo.update(created.id, { nameEn: "Writer A wins", expectedVersion: 1 }),
      repo.update(created.id, { nameEn: "Writer B wins", expectedVersion: 1 }),
    ]);

    const results = [a, b];
    const okCount = results.filter((r) => r.kind === "ok").length;
    const conflictCount = results.filter((r) => r.kind === "conflict").length;

    expect(okCount).toBe(1);
    expect(conflictCount).toBe(1);

    // The winning write should have incremented version to 2.
    const okResult = results.find((r) => r.kind === "ok") as { kind: "ok"; project: { version: number; nameEn: string } };
    expect(okResult.project.version).toBe(2);

    // The conflict should report the currentVersion (post-win = 2).
    const conflictResult = results.find((r) => r.kind === "conflict") as { kind: "conflict"; currentVersion: number };
    expect(conflictResult.currentVersion).toBe(2);

    // Final state: project version is 2, name is one of the two writers'.
    const final = await repo.getById(created.id);
    expect(final).not.toBeNull();
    expect(final!.version).toBe(2);
    expect(["Writer A wins", "Writer B wins"]).toContain(final!.nameEn);
  });

  // ─── pagination ───────────────────────────────────────────────────────

  it("list() respects limit/offset for pagination", async () => {
    // Create 5 projects; we want deterministic order so insert with explicit
    // nameEn alphabet labels. list() orders by updatedAt desc, so reverse-
    // alphabet will be the natural order if timestamps are monotonic.
    for (let i = 0; i < 5; i++) {
      await repo.create({ ownerId: testUserId, nameEn: `P${i}` });
      await new Promise((r) => setTimeout(r, 10));
    }

    const page1 = await repo.list({ limit: 2, offset: 0 });
    const page2 = await repo.list({ limit: 2, offset: 2 });
    const page3 = await repo.list({ limit: 2, offset: 4 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(1); // only 1 left

    // No overlap between pages
    const allIds = [...page1, ...page2, ...page3].map((p) => p.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(5);
  });

  it("list() with empty filter returns empty array (not error)", async () => {
    const list = await repo.list({});
    expect(list).toEqual([]);
  });
});
