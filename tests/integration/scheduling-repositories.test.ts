/**
 * Scheduling Repositories — Integration Tests (Group K, W2-5).
 *
 * These tests hit the real SQLite database (db/custom.db). They exercise the
 * full persistence stack: Prisma repositories → Prisma client → SQLite.
 *
 * Coverage:
 *   WBS repository:
 *     - create node, create child, list, reorder, soft-delete
 *   Activity repository:
 *     - create, update duration, create relationship, list relationships, soft-delete
 *   Schedule repository:
 *     - createRun with a small network (3 activities, 2 FS relationships),
 *       verify ScheduleRun + ScheduleActivity rows created atomically
 *     - cycle case writes ScheduleRun with status=CYCLE_DETECTED, no activities
 *     - getLatestRun returns the most recent by createdAt
 *     - getRunById returns run + activities
 *   Calendar repository:
 *     - upsert (creates + updates with version increment)
 *     - addException (new + existing date is updated)
 *     - removeException (silent no-op on missing date)
 *     - get returns calendar + exceptions
 *
 * Each test wipes all scheduling tables + project + user before running so
 * tests are independent. Activities reference each other for relationships,
 * and ScheduleRun references a User (runById) and a Project — so we create
 * both as fixtures.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { PrismaWbsRepository } from "@/infrastructure/persistence/prisma/scheduling/wbs-repository";
import { PrismaActivityRepository } from "@/infrastructure/persistence/prisma/scheduling/activity-repository";
import { PrismaScheduleRepository } from "@/infrastructure/persistence/prisma/scheduling/schedule-repository";
import { PrismaCalendarRepository } from "@/infrastructure/persistence/prisma/scheduling/calendar-repository";
import { computeSchedule } from "@domain/scheduling/cpm";
import type { NetworkInput } from "@shared/schemas/scheduling/network";

describe("Scheduling repositories (integration)", () => {
  let wbsRepo: PrismaWbsRepository;
  let activityRepo: PrismaActivityRepository;
  let scheduleRepo: PrismaScheduleRepository;
  let calendarRepo: PrismaCalendarRepository;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    // Clean slate — wipe scheduling + project + user tables in dependency order.
    await db.$transaction([
      db.scheduleActivity.deleteMany(),
      db.scheduleRun.deleteMany(),
      db.activityRelationship.deleteMany(),
      db.activity.deleteMany(),
      db.wbsNode.deleteMany(),
      db.calendarException.deleteMany(),
      db.projectCalendar.deleteMany(),
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

    // Fixture user — ScheduleRun.runById requires a real User row.
    const user = await db.user.create({
      data: {
        email: "scheduling-repo@example.com",
        passwordHash: "$2a$12$dummyhashforthistest0123456789012345678",
        role: "USER",
        locale: "EN",
      },
    });
    userId = user.id;

    // Fixture project — every scheduling row references a real Project row.
    const project = await db.project.create({
      data: {
        ownerId: userId,
        nameEn: "Scheduling Test Project",
        currency: "USD",
      },
    });
    projectId = project.id;

    wbsRepo = new PrismaWbsRepository();
    activityRepo = new PrismaActivityRepository();
    scheduleRepo = new PrismaScheduleRepository();
    calendarRepo = new PrismaCalendarRepository();
  });

  // ════════════════════════════════════════════════════════════════════
  // WBS Repository
  // ════════════════════════════════════════════════════════════════════

  describe("PrismaWbsRepository", () => {
    it("create() returns a WBS node with sortOrder=0 default", async () => {
      const node = await wbsRepo.create({
        projectId,
        code: "1",
        nameEn: "Site Work",
      });
      expect(node.id).toBeTruthy();
      expect(node.projectId).toBe(projectId);
      expect(node.code).toBe("1");
      expect(node.nameEn).toBe("Site Work");
      expect(node.nameAr).toBeNull();
      expect(node.sortOrder).toBe(0);
      expect(node.parentId).toBeNull();
      expect(node.deletedAt).toBeNull();
    });

    it("create() child node references parent", async () => {
      const parent = await wbsRepo.create({
        projectId,
        code: "1",
        nameEn: "Site Work",
      });
      const child = await wbsRepo.create({
        projectId,
        parentId: parent.id,
        code: "1.1",
        nameEn: "Excavation",
        sortOrder: 1,
      });
      expect(child.parentId).toBe(parent.id);
      expect(child.sortOrder).toBe(1);
    });

    it("list() returns nodes ordered by sortOrder asc", async () => {
      const a = await wbsRepo.create({ projectId, code: "2", nameEn: "B", sortOrder: 1 });
      const b = await wbsRepo.create({ projectId, code: "1", nameEn: "A", sortOrder: 0 });
      const list = await wbsRepo.list(projectId);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(b.id); // sortOrder 0 first
      expect(list[1].id).toBe(a.id);
    });

    it("reorder() reassigns sortOrder by array index", async () => {
      const n1 = await wbsRepo.create({ projectId, code: "1", nameEn: "A", sortOrder: 0 });
      const n2 = await wbsRepo.create({ projectId, code: "2", nameEn: "B", sortOrder: 1 });
      const n3 = await wbsRepo.create({ projectId, code: "3", nameEn: "C", sortOrder: 2 });

      // Reverse the order
      await wbsRepo.reorder(projectId, [n3.id, n2.id, n1.id]);

      const list = await wbsRepo.list(projectId);
      expect(list[0].id).toBe(n3.id);
      expect(list[0].sortOrder).toBe(0);
      expect(list[1].id).toBe(n2.id);
      expect(list[1].sortOrder).toBe(1);
      expect(list[2].id).toBe(n1.id);
      expect(list[2].sortOrder).toBe(2);
    });

    it("softDelete() tombstones the node and excludes it from list()", async () => {
      const node = await wbsRepo.create({ projectId, code: "1", nameEn: "X" });
      const result = await wbsRepo.softDelete(node.id);
      expect(result.kind).toBe("ok");

      // Default list excludes soft-deleted
      const list = await wbsRepo.list(projectId);
      expect(list).toHaveLength(0);

      // includeDeleted surfaces the tombstoned row
      const listAll = await wbsRepo.list(projectId, true);
      expect(listAll).toHaveLength(1);
      expect(listAll[0].deletedAt).not.toBeNull();
    });

    it("softDelete() returns not_found for missing id", async () => {
      const result = await wbsRepo.softDelete("non-existent-id-12345");
      expect(result.kind).toBe("not_found");
    });

    it("update() patches fields and returns the updated node", async () => {
      const node = await wbsRepo.create({ projectId, code: "1", nameEn: "Old" });
      const result = await wbsRepo.update(node.id, {
        nameEn: "New Name",
        code: "1.A",
      });
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.node.nameEn).toBe("New Name");
        expect(result.node.code).toBe("1.A");
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Activity Repository
  // ════════════════════════════════════════════════════════════════════

  describe("PrismaActivityRepository", () => {
    it("create() returns an activity with defaults (duration=0, isMilestone=false)", async () => {
      const act = await activityRepo.create({
        projectId,
        code: "A",
        nameEn: "Excavate",
      });
      expect(act.id).toBeTruthy();
      expect(act.projectId).toBe(projectId);
      expect(act.duration).toBe(0);
      expect(act.isMilestone).toBe(false);
      expect(act.sortOrder).toBe(0);
      expect(act.version).toBe(1);
      expect(act.deletedAt).toBeNull();
    });

    it("create() with wbsNodeId + duration + isMilestone persists them", async () => {
      const node = await wbsRepo.create({ projectId, code: "1", nameEn: "Phase" });
      const act = await activityRepo.create({
        projectId,
        wbsNodeId: node.id,
        code: "M1",
        nameEn: "Start Milestone",
        duration: 0,
        isMilestone: true,
        sortOrder: 5,
      });
      expect(act.wbsNodeId).toBe(node.id);
      expect(act.isMilestone).toBe(true);
      expect(act.duration).toBe(0);
      expect(act.sortOrder).toBe(5);
    });

    it("update() with correct version bumps version and patches fields", async () => {
      const act = await activityRepo.create({
        projectId,
        code: "A",
        nameEn: "Original",
        duration: 3,
      });
      const result = await activityRepo.update(act.id, {
        duration: 5,
        nameEn: "Updated",
        expectedVersion: 1,
      });
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.activity.duration).toBe(5);
        expect(result.activity.nameEn).toBe("Updated");
        expect(result.activity.version).toBe(2);
      }
    });

    it("update() with wrong version returns conflict", async () => {
      const act = await activityRepo.create({
        projectId,
        code: "A",
        nameEn: "v1",
        duration: 3,
      });
      // Bump to v2 first
      await activityRepo.update(act.id, { duration: 4, expectedVersion: 1 });
      // Now try to update with stale v1
      const result = await activityRepo.update(act.id, {
        duration: 99,
        expectedVersion: 1,
      });
      expect(result.kind).toBe("conflict");
      if (result.kind === "conflict") {
        expect(result.currentVersion).toBe(2);
      }
    });

    it("update() for non-existent id returns not_found", async () => {
      const result = await activityRepo.update("non-existent-xyz", {
        duration: 5,
        expectedVersion: 1,
      });
      expect(result.kind).toBe("not_found");
    });

    it("createRelationship() + listRelationships() round-trip", async () => {
      const a = await activityRepo.create({ projectId, code: "A", nameEn: "A", duration: 3 });
      const b = await activityRepo.create({ projectId, code: "B", nameEn: "B", duration: 2 });

      const rel = await activityRepo.createRelationship({
        projectId,
        predecessorId: a.id,
        successorId: b.id,
        type: "FS",
        lag: 0,
      });
      expect(rel.type).toBe("FS");
      expect(rel.lag).toBe(0);
      expect(rel.predecessorId).toBe(a.id);
      expect(rel.successorId).toBe(b.id);

      const list = await activityRepo.listRelationships(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(rel.id);
    });

    it("createRelationship() with lag preserves the value", async () => {
      const a = await activityRepo.create({ projectId, code: "A", nameEn: "A", duration: 3 });
      const b = await activityRepo.create({ projectId, code: "B", nameEn: "B", duration: 2 });

      const rel = await activityRepo.createRelationship({
        projectId,
        predecessorId: a.id,
        successorId: b.id,
        type: "FS",
        lag: -2, // BR-P4 — negative lag
      });
      expect(rel.lag).toBe(-2);
    });

    it("deleteRelationship() removes the row", async () => {
      const a = await activityRepo.create({ projectId, code: "A", nameEn: "A", duration: 3 });
      const b = await activityRepo.create({ projectId, code: "B", nameEn: "B", duration: 2 });

      const rel = await activityRepo.createRelationship({
        projectId,
        predecessorId: a.id,
        successorId: b.id,
        type: "FS",
      });
      expect(await activityRepo.listRelationships(projectId)).toHaveLength(1);

      await activityRepo.deleteRelationship(rel.id);
      expect(await activityRepo.listRelationships(projectId)).toHaveLength(0);
    });

    it("softDelete() tombstones activity with version bump", async () => {
      const act = await activityRepo.create({
        projectId,
        code: "A",
        nameEn: "To Delete",
        duration: 3,
      });
      const result = await activityRepo.softDelete(act.id, 1);
      expect(result.kind).toBe("ok");

      const list = await activityRepo.list(projectId);
      expect(list).toHaveLength(0);

      const listAll = await activityRepo.list(projectId, true);
      expect(listAll).toHaveLength(1);
      expect(listAll[0].deletedAt).not.toBeNull();
      expect(listAll[0].version).toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Schedule Repository
  // ════════════════════════════════════════════════════════════════════

  describe("PrismaScheduleRepository", () => {
    /**
     * Helper: build a small network matching GT-P1 shape (3 activities, 2 FS).
     * Activities are created in the DB so they have stable IDs we can pass
     * to the engine + reference in ScheduleActivity rows.
     */
    async function seedGtP1Network(): Promise<{
      engineInput: NetworkInput;
      activityIdByCode: Record<string, string>;
    }> {
      const a = await activityRepo.create({ projectId, code: "A", nameEn: "A", duration: 3 });
      const b = await activityRepo.create({ projectId, code: "B", nameEn: "B", duration: 2 });
      const c = await activityRepo.create({ projectId, code: "C", nameEn: "C", duration: 4 });
      await activityRepo.createRelationship({
        projectId,
        predecessorId: a.id,
        successorId: b.id,
        type: "FS",
        lag: 0,
      });
      await activityRepo.createRelationship({
        projectId,
        predecessorId: b.id,
        successorId: c.id,
        type: "FS",
        lag: 0,
      });

      return {
        engineInput: {
          projectStart: "2026-01-05",
          calendar: {
            mask: {
              monday: true,
              tuesday: true,
              wednesday: true,
              thursday: true,
              friday: true,
              saturday: false,
              sunday: false,
            },
            exceptions: [],
          },
          activities: [
            { id: a.id, code: "A", duration: 3, type: "TASK" },
            { id: b.id, code: "B", duration: 2, type: "TASK" },
            { id: c.id, code: "C", duration: 4, type: "TASK" },
          ],
          relationships: [
            { predecessorId: a.id, successorId: b.id, type: "FS", lag: 0 },
            { predecessorId: b.id, successorId: c.id, type: "FS", lag: 0 },
          ],
        },
        activityIdByCode: { A: a.id, B: b.id, C: c.id },
      };
    }

    it("createRun() with success result persists ScheduleRun + ScheduleActivity rows atomically", async () => {
      const { engineInput, activityIdByCode } = await seedGtP1Network();
      const result = computeSchedule(engineInput);
      expect(result.kind).toBe("success");

      const run = await scheduleRepo.createRun(result, {
        projectId,
        projectStart: "2026-01-05",
        runById: userId,
      });

      // ScheduleRun row written with status=SUCCESS
      expect(run.id).toBeTruthy();
      expect(run.projectId).toBe(projectId);
      expect(run.projectStart).toBe("2026-01-05");
      expect(run.status).toBe("SUCCESS");
      expect(run.projectFinishDate).toBe("2026-01-15");
      expect(run.runById).toBe(userId);
      expect(run.criticalPathJson).not.toBeNull();
      expect(JSON.parse(run.criticalPathJson!)).toEqual([
        activityIdByCode.A,
        activityIdByCode.B,
        activityIdByCode.C,
      ]);

      // Verify ScheduleActivity rows were persisted — fetch via getRunById
      const fetched = await scheduleRepo.getRunById(run.id);
      expect(fetched).not.toBeNull();
      if (fetched) {
        expect(fetched.activities).toHaveLength(3);
        const aRow = fetched.activities.find(
          (sa) => sa.activityId === activityIdByCode.A,
        )!;
        expect(aRow.es).toBe("2026-01-05");
        expect(aRow.ef).toBe("2026-01-07");
        expect(aRow.isCritical).toBe(true);
        expect(aRow.totalFloatDays).toBe(0);

        const cRow = fetched.activities.find(
          (sa) => sa.activityId === activityIdByCode.C,
        )!;
        expect(cRow.es).toBe("2026-01-12");
        expect(cRow.ef).toBe("2026-01-15");
        expect(cRow.isCritical).toBe(true);
      }

      // Verify exactly 1 run row + 3 activity rows exist in the DB
      const runCount = await db.scheduleRun.count({ where: { projectId } });
      const actCount = await db.scheduleActivity.count({
        where: { scheduleRunId: run.id },
      });
      expect(runCount).toBe(1);
      expect(actCount).toBe(3);
    });

    it("createRun() with cycle result persists ScheduleRun with status=CYCLE_DETECTED, no ScheduleActivity rows", async () => {
      // Create A and B that form a cycle: A FS→ B, B SS→ A.
      const a = await activityRepo.create({ projectId, code: "A", nameEn: "A", duration: 3 });
      const b = await activityRepo.create({ projectId, code: "B", nameEn: "B", duration: 2 });
      await activityRepo.createRelationship({
        projectId,
        predecessorId: a.id,
        successorId: b.id,
        type: "FS",
      });
      await activityRepo.createRelationship({
        projectId,
        predecessorId: b.id,
        successorId: a.id,
        type: "SS",
      });

      const result = computeSchedule({
        projectStart: "2026-01-05",
        calendar: {
          mask: {
            monday: true,
            tuesday: true,
            wednesday: true,
            thursday: true,
            friday: true,
            saturday: false,
            sunday: false,
          },
          exceptions: [],
        },
        activities: [
          { id: a.id, code: "A", duration: 3, type: "TASK" },
          { id: b.id, code: "B", duration: 2, type: "TASK" },
        ],
        relationships: [
          { predecessorId: a.id, successorId: b.id, type: "FS", lag: 0 },
          { predecessorId: b.id, successorId: a.id, type: "SS", lag: 0 },
        ],
      });
      expect(result.kind).toBe("cycle");

      const run = await scheduleRepo.createRun(result, {
        projectId,
        projectStart: "2026-01-05",
        runById: userId,
      });

      expect(run.status).toBe("CYCLE_DETECTED");
      expect(run.projectFinishDate).toBeNull();
      expect(run.criticalPathJson).toBeNull();
      expect(run.errorJson).not.toBeNull();
      const err = JSON.parse(run.errorJson!);
      expect(Array.isArray(err.cycleActivityIds)).toBe(true);
      expect(err.cycleActivityIds).toHaveLength(2);

      // No ScheduleActivity rows persisted
      const actCount = await db.scheduleActivity.count({
        where: { scheduleRunId: run.id },
      });
      expect(actCount).toBe(0);
    });

    it("getLatestRun() returns the most recent run by createdAt", async () => {
      const { engineInput } = await seedGtP1Network();
      const result = computeSchedule(engineInput);

      const run1 = await scheduleRepo.createRun(result, {
        projectId,
        projectStart: "2026-01-05",
        runById: userId,
      });
      // Small delay so createdAt differs.
      await new Promise((r) => setTimeout(r, 20));
      const run2 = await scheduleRepo.createRun(result, {
        projectId,
        projectStart: "2026-01-05",
        runById: userId,
      });

      const latest = await scheduleRepo.getLatestRun(projectId);
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(run2.id);
      expect(latest!.id).not.toBe(run1.id);

      // Verify both runs are persisted (BR-WEB-P3: runs are immutable / auditable)
      const allRuns = await db.scheduleRun.findMany({ where: { projectId } });
      expect(allRuns).toHaveLength(2);
    });

    it("getLatestRun() returns null when no runs exist", async () => {
      const latest = await scheduleRepo.getLatestRun(projectId);
      expect(latest).toBeNull();
    });

    it("getRunById() returns null for non-existent id", async () => {
      const fetched = await scheduleRepo.getRunById("non-existent-run-xyz");
      expect(fetched).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Calendar Repository
  // ════════════════════════════════════════════════════════════════════

  describe("PrismaCalendarRepository", () => {
    it("get() returns null when no calendar exists", async () => {
      const cal = await calendarRepo.get(projectId);
      expect(cal).toBeNull();
    });

    it("upsert() creates a calendar with the default Sun-Thu mask", async () => {
      const cal = await calendarRepo.upsert({
        projectId,
        mask: {
          mondayWorking: true,
          tuesdayWorking: true,
          wednesdayWorking: true,
          thursdayWorking: true,
          fridayWorking: false,
          saturdayWorking: false,
          sundayWorking: true,
        },
      });
      expect(cal.projectId).toBe(projectId);
      expect(cal.version).toBe(1);
      expect(cal.sundayWorking).toBe(true);
      expect(cal.fridayWorking).toBe(false);

      const fetched = await calendarRepo.get(projectId);
      expect(fetched).not.toBeNull();
      expect(fetched!.exceptions).toEqual([]);
    });

    it("upsert() on existing calendar increments version", async () => {
      const mask = {
        mondayWorking: true,
        tuesdayWorking: true,
        wednesdayWorking: true,
        thursdayWorking: true,
        fridayWorking: false,
        saturdayWorking: false,
        sundayWorking: true,
      };
      await calendarRepo.upsert({ projectId, mask });
      const v2 = await calendarRepo.upsert({ projectId, mask });
      expect(v2.version).toBe(2);

      // Change mask and verify it persists
      const v3 = await calendarRepo.upsert({
        projectId,
        mask: { ...mask, fridayWorking: true },
      });
      expect(v3.version).toBe(3);
      expect(v3.fridayWorking).toBe(true);
    });

    it("upsert() with exceptions list replaces the exception list atomically", async () => {
      // First upsert with one exception
      await calendarRepo.upsert({
        projectId,
        mask: {
          mondayWorking: true,
          tuesdayWorking: true,
          wednesdayWorking: true,
          thursdayWorking: true,
          fridayWorking: false,
          saturdayWorking: false,
          sundayWorking: true,
        },
        exceptions: [
          { date: "2026-01-07", isWorking: false, nameEn: "Holiday" },
        ],
      });
      let fetched = await calendarRepo.get(projectId);
      expect(fetched!.exceptions).toHaveLength(1);
      expect(fetched!.exceptions[0].date).toBe("2026-01-07");

      // Second upsert with a different exception list — first should be replaced
      await calendarRepo.upsert({
        projectId,
        mask: {
          mondayWorking: true,
          tuesdayWorking: true,
          wednesdayWorking: true,
          thursdayWorking: true,
          fridayWorking: false,
          saturdayWorking: false,
          sundayWorking: true,
        },
        exceptions: [
          { date: "2026-02-02", isWorking: false, nameEn: "Other Holiday" },
          { date: "2026-02-15", isWorking: true, nameEn: "Working Sat" },
        ],
      });
      fetched = await calendarRepo.get(projectId);
      expect(fetched!.exceptions).toHaveLength(2);
      expect(fetched!.exceptions.map((e) => e.date).sort()).toEqual([
        "2026-02-02",
        "2026-02-15",
      ]);
    });

    it("addException() creates a new exception when date is absent", async () => {
      // Ensure calendar exists
      await calendarRepo.upsert({
        projectId,
        mask: {
          mondayWorking: true,
          tuesdayWorking: true,
          wednesdayWorking: true,
          thursdayWorking: true,
          fridayWorking: false,
          saturdayWorking: false,
          sundayWorking: true,
        },
      });

      const exc = await calendarRepo.addException(projectId, {
        date: "2026-01-07",
        isWorking: false,
        nameEn: "Holiday",
        nameAr: "عطلة",
      });
      expect(exc.date).toBe("2026-01-07");
      expect(exc.isWorking).toBe(false);
      expect(exc.nameEn).toBe("Holiday");
      expect(exc.nameAr).toBe("عطلة");

      const fetched = await calendarRepo.get(projectId);
      expect(fetched!.exceptions).toHaveLength(1);
    });

    it("addException() auto-creates the calendar if missing", async () => {
      // No prior calendar — addException should create one with defaults.
      const exc = await calendarRepo.addException(projectId, {
        date: "2026-01-07",
        isWorking: false,
      });
      expect(exc.date).toBe("2026-01-07");

      const fetched = await calendarRepo.get(projectId);
      expect(fetched).not.toBeNull();
      expect(fetched!.calendar.sundayWorking).toBe(true); // BR-P9 default
      expect(fetched!.calendar.fridayWorking).toBe(false);
      expect(fetched!.exceptions).toHaveLength(1);
    });

    it("addException() on existing date updates the exception (idempotent per date)", async () => {
      await calendarRepo.addException(projectId, {
        date: "2026-01-07",
        isWorking: false,
        nameEn: "Holiday",
      });
      // Add again — should update, not duplicate
      const updated = await calendarRepo.addException(projectId, {
        date: "2026-01-07",
        isWorking: true,
        nameEn: "Working Day Override",
      });
      expect(updated.isWorking).toBe(true);
      expect(updated.nameEn).toBe("Working Day Override");

      const fetched = await calendarRepo.get(projectId);
      expect(fetched!.exceptions).toHaveLength(1); // still 1, not 2
    });

    it("removeException() deletes the exception by date", async () => {
      await calendarRepo.addException(projectId, {
        date: "2026-01-07",
        isWorking: false,
      });
      expect((await calendarRepo.get(projectId))!.exceptions).toHaveLength(1);

      await calendarRepo.removeException(projectId, "2026-01-07");
      expect((await calendarRepo.get(projectId))!.exceptions).toHaveLength(0);
    });

    it("removeException() is a no-op for a missing date", async () => {
      await calendarRepo.upsert({
        projectId,
        mask: {
          mondayWorking: true,
          tuesdayWorking: true,
          wednesdayWorking: true,
          thursdayWorking: true,
          fridayWorking: false,
          saturdayWorking: false,
          sundayWorking: true,
        },
      });
      // Should not throw
      await calendarRepo.removeException(projectId, "2026-12-31");
      const fetched = await calendarRepo.get(projectId);
      expect(fetched!.exceptions).toEqual([]);
    });

    it("removeException() is a no-op when no calendar exists", async () => {
      // Should not throw
      await calendarRepo.removeException(projectId, "2026-01-07");
      expect(await calendarRepo.get(projectId)).toBeNull();
    });
  });
});
