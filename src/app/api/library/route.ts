/**
 * GET  /api/library          — search library items (paginated)
 * POST /api/library          — create a new library item
 *
 * Per BR-WEB-5: all routes require an authenticated session.
 * Per BR-WEB-8: mutations write to AuditLog.
 * Per BR-WEB-11: input validated by zod (LibraryItemSearchSchema / LibraryItemCreateSchema).
 *
 * Layer purity: top of the stack — App Router route handler. Imports
 * @/lib/api-helpers, @/lib/services, @/lib/auth, @shared/schemas.
 */

import { NextRequest } from "next/server";
import {
  withErrorHandler,
  json,
  created,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import {
  LibraryItemCreateSchema,
  LibraryItemSearchSchema,
} from "@shared/schemas/library";

/**
 * GET /api/library?search=...&categoryId=...&scope=...&limit=...&offset=...
 *
 * Returns `{ data: ItemLibrary[], total: number }`.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireUserId();
  const url = new URL(req.url);
  const params = LibraryItemSearchSchema.parse({
    search: url.searchParams.get("search") ?? undefined,
    categoryId: url.searchParams.get("categoryId") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  const services = getServices();
  const [data, total] = await Promise.all([
    services.library.search(params),
    services.library.countSearch(params),
  ]);
  return json({ data, total });
});

/**
 * POST /api/library
 *
 * Create a new library item.
 *   - scope: USER_PRIVATE  → ownerId is set from the session user.
 *   - scope: APP_GLOBAL    → ownerId is null. Admin gating is deferred to
 *                            Phase 5 (per WO-W-12a spec — any authenticated
 *                            user may create APP_GLOBAL items for now).
 *
 * Returns 201 with the created item.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const userId = await requireUserId();
  const body = LibraryItemCreateSchema.parse(await req.json());
  const services = getServices();

  const ownerId = body.scope === "USER_PRIVATE" ? userId : null;

  const item = await services.library.create({
    code: body.code,
    descriptionEn: body.descriptionEn,
    descriptionAr: body.descriptionAr,
    unitId: body.unitId,
    defaultSpecsEn: body.defaultSpecsEn,
    defaultSpecsAr: body.defaultSpecsAr,
    categoryId: body.categoryId,
    scope: body.scope,
    ownerId,
  });

  await writeAuditLog({
    action: "create",
    entityType: "ItemLibrary",
    entityId: item.id,
    afterJson: item,
  });

  return created(item);
});
