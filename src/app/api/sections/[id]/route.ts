/**
 * GET    /api/sections/[id] — fetch single section (with its items).
 * PATCH  /api/sections/[id] — update section fields with optimistic concurrency.
 * DELETE /api/sections/[id] — soft-delete section (cascades to items).
 *
 * BR-WEB-5: every route verifies the section's project is owned by the session
 *           user. Missing-or-not-owned → 404 (no existence leak).
 * BR-WEB-4: PATCH/DELETE take `expectedVersion` for optimistic concurrency.
 * BR-WEB-8: PATCH + DELETE write AuditLog entries.
 * BR-WEB-11: PATCH body is zod-validated.
 *
 * NOTE: IBoQRepository (WO-W-2-b) does NOT expose `updateSection` or
 * `softDeleteSection` methods. The route handler uses Prisma's `updateMany`
 * with version in WHERE for optimistic concurrency (same pattern as the
 * repository uses elsewhere). Soft-delete cascades to items in a single
 * `$transaction` (matches the softDeleteDocument pattern in the repo).
 */

import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  noContent,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { BoQSectionUpdateSchema } from "@/shared/schemas/boq/document";

// ─── GET single section ──────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const section = await db.boQSection.findUnique({
      where: { id, deletedAt: null },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!section) return notFound("Section not found");

    const project = await verifyProjectOwnership(section.projectId, userId);
    if (!project) return notFound("Section not found");

    return json({ section });
  },
);

// ─── PATCH section ─────────────────────────────────────────────────────────

export const PATCH = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const existing = await db.boQSection.findUnique({
      where: { id, deletedAt: null },
    });
    if (!existing) return notFound("Section not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Section not found");

    const body = await req.json();
    const input = BoQSectionUpdateSchema.parse(body);

    const where: Record<string, unknown> = { id, deletedAt: null };
    if (input.expectedVersion !== undefined) {
      where.version = input.expectedVersion;
    }

    const result = await db.boQSection.updateMany({
      where,
      data: {
        ...(input.code !== undefined && { code: input.code }),
        ...(input.titleEn !== undefined && { titleEn: input.titleEn }),
        ...(input.titleAr !== undefined && { titleAr: input.titleAr }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await db.boQSection.findUnique({ where: { id } });
      if (!current) return notFound("Section not found");
      return conflict(
        "Section was modified by another user. Please reload and try again.",
        current.version,
      );
    }

    const updated = await db.boQSection.findUniqueOrThrow({ where: { id } });
    await writeAuditLog({
      action: "boq.section.update",
      entityType: "BoQSection",
      entityId: id,
      beforeJson: existing,
      afterJson: updated,
    });

    return json({ section: updated });
  },
);

// ─── DELETE section (soft-delete, cascade to items) ──────────────────────

export const DELETE = withErrorHandler(
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const userId = await requireUserId();
    const { id } = await params;

    const existing = await db.boQSection.findUnique({
      where: { id, deletedAt: null },
    });
    if (!existing) return notFound("Section not found");

    const project = await verifyProjectOwnership(existing.projectId, userId);
    if (!project) return notFound("Section not found");

    const url = new URL(req.url);
    const versionParam = url.searchParams.get("expectedVersion");
    if (versionParam === null) {
      return conflict(
        "expectedVersion query parameter is required for optimistic concurrency.",
        existing.version,
      );
    }
    const expectedVersion = Number.parseInt(versionParam, 10);
    if (!Number.isFinite(expectedVersion) || expectedVersion < 0) {
      return conflict(
        "expectedVersion must be a non-negative integer.",
        existing.version,
      );
    }

    const now = new Date();
    // Single transaction: tombstone the section AND all its live items with
    // the same timestamp. If the section's version doesn't match, the
    // updateMany returns count=0 and we skip the cascade.
    const outcome = await db.$transaction(async (tx) => {
      const sectionUpdate = await tx.boQSection.updateMany({
        where: { id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      if (sectionUpdate.count === 0) {
        return { kind: "fail" as const };
      }
      await tx.boQItem.updateMany({
        where: { sectionId: id, deletedAt: null },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      return { kind: "ok" as const };
    });

    if (outcome.kind === "fail") {
      const current = await db.boQSection.findUnique({ where: { id } });
      if (!current) return notFound("Section not found");
      return conflict(
        "Section was modified by another user. Please reload and try again.",
        current.version,
      );
    }

    await writeAuditLog({
      action: "boq.section.delete",
      entityType: "BoQSection",
      entityId: id,
      beforeJson: existing,
    });

    return noContent();
  },
);
