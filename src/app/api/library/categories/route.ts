/**
 * GET /api/library/categories
 *
 * Returns all LibraryCategory rows ordered by sortOrder ASC (with nameEn
 * tie-break — matches `PrismaItemLibraryRepository.listCategories`).
 *
 * Per BR-WEB-5: requires an authenticated session.
 *
 * Layer purity: top of the stack — App Router route handler.
 */

import { withErrorHandler, json } from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";

export const GET = withErrorHandler(async () => {
  await requireUserId();
  const services = getServices();
  const categories = await services.library.listCategories();
  return json(categories);
});
