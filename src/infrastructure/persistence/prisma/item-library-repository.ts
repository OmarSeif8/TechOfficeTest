/**
 * PrismaItemLibraryRepository — Prisma-backed implementation of IItemLibraryRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/ (server-only).
 * Per CONSTITUTION_V1.1_WEB §3.3 layer purity:
 *   - MAY import @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import next, react, or any UI code.
 *
 * The repository owns the ItemLibrary + LibraryCategory tables. Entity types come
 * from @shared/entities (plain TS interfaces — no Prisma dep), so the domain layer
 * never sees Prisma. This is what keeps the domain portable across Next.js, Electron,
 * Tauri, and React Native.
 *
 * SQLite note (search):
 *   SQLite does NOT support Prisma's `mode: 'insensitive'` option. By default,
 *   `contains` on SQLite is already case-insensitive for ASCII characters
 *   (Prisma uses `LIKE` under the hood, which is case-insensitive for ASCII by
 *   default in SQLite). For Arabic / non-ASCII content, `contains` performs a
 *   substring match (also case-insensitive for the Unicode default collation).
 *   So we omit `mode` here and rely on the default — matches the WO-W-2-c spec.
 */

import { db } from "@/lib/db";
import type {
  IItemLibraryRepository,
  LibraryItemCreateInput,
  LibraryItemSearchOptions,
} from "@domain/repositories/item-library-repository";
import type {
  ItemLibrary,
  LibraryCategory,
} from "@shared/entities";
import type {
  ItemLibrary as PrismaItemLibrary,
  LibraryCategory as PrismaLibraryCategory,
} from "@prisma/client";

export class PrismaItemLibraryRepository implements IItemLibraryRepository {
  // ─── search ────────────────────────────────────────────────────────────
  /**
   * Paginated search across the item library.
   *
   * Filters:
   *   - search (string): substring match against descriptionEn, descriptionAr, OR code
   *     (case-insensitive — SQLite default; mode:'insensitive' not supported)
   *   - categoryId, scope, ownerId: exact-match filters when provided
   *
   * Ordering: code ASC, then descriptionEn ASC.
   * Pagination: limit (default 50), offset (default 0).
   */
  async search(options: LibraryItemSearchOptions): Promise<ItemLibrary[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = await db.itemLibrary.findMany({
      where: {
        AND: [
          // ─── Search-term filter (substring match across 3 fields) ───────
          // NOTE: SQLite does not support `mode: 'insensitive'` — `contains`
          // on SQLite is already case-insensitive for ASCII (and uses Unicode
          // substring match for non-ASCII like Arabic). We omit `mode` per spec.
          ...(options.search
            ? [
                {
                  OR: [
                    { descriptionEn: { contains: options.search } },
                    { descriptionAr: { contains: options.search } },
                    { code: { contains: options.search } },
                  ],
                },
              ]
            : []),
          // ─── Exact-match filters ────────────────────────────────────────
          ...(options.categoryId ? [{ categoryId: options.categoryId }] : []),
          ...(options.scope ? [{ scope: options.scope }] : []),
          ...(options.ownerId ? [{ ownerId: options.ownerId }] : []),
        ],
      },
      orderBy: [{ code: "asc" }, { descriptionEn: "asc" }],
      take: limit,
      skip: offset,
    });

    return rows.map((r) => this.mapItemToEntity(r));
  }

  // ─── countSearch ──────────────────────────────────────────────────────
  /**
   * Count of items matching the same filters as `search`, WITHOUT pagination.
   * Used for paginated UIs to render "Showing 1–10 of 23 items".
   */
  async countSearch(options: LibraryItemSearchOptions): Promise<number> {
    const count = await db.itemLibrary.count({
      where: {
        AND: [
          ...(options.search
            ? [
                {
                  OR: [
                    { descriptionEn: { contains: options.search } },
                    { descriptionAr: { contains: options.search } },
                    { code: { contains: options.search } },
                  ],
                },
              ]
            : []),
          ...(options.categoryId ? [{ categoryId: options.categoryId }] : []),
          ...(options.scope ? [{ scope: options.scope }] : []),
          ...(options.ownerId ? [{ ownerId: options.ownerId }] : []),
        ],
      },
    });
    return count;
  }

  // ─── getById ──────────────────────────────────────────────────────────
  async getById(id: string): Promise<ItemLibrary | null> {
    const row = await db.itemLibrary.findUnique({ where: { id } });
    return row ? this.mapItemToEntity(row) : null;
  }

  // ─── create ───────────────────────────────────────────────────────────
  /**
   * Create a new library item. Defaults:
   *   - scope: APP_GLOBAL (if not provided — defensive; interface marks scope required)
   *   - version: 1 (matches schema @default(1))
   *
   * For USER_PRIVATE scope, the caller MUST pass ownerId — that contract is
   * enforced at the service layer (not here).
   */
  async create(input: LibraryItemCreateInput): Promise<ItemLibrary> {
    const row = await db.itemLibrary.create({
      data: {
        code: input.code ?? null,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr ?? null,
        unitId: input.unitId ?? null,
        defaultSpecsEn: input.defaultSpecsEn ?? null,
        defaultSpecsAr: input.defaultSpecsAr ?? null,
        categoryId: input.categoryId ?? null,
        scope: input.scope ?? "APP_GLOBAL",
        ownerId: input.ownerId ?? null,
        version: 1, // explicit; matches schema @default(1)
      },
    });
    return this.mapItemToEntity(row);
  }

  // ─── listCategories ───────────────────────────────────────────────────
  /**
   * List all library categories ordered by sortOrder ASC (then nameEn for tie-break).
   */
  async listCategories(): Promise<LibraryCategory[]> {
    const rows = await db.libraryCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
    return rows.map((r) => this.mapCategoryToEntity(r));
  }

  // ─── Private mappers (type assertions since shapes match — Prisma row
  //     has all entity fields plus extras like `deletedAt` which the entity
  //     omits intentionally). ─────────────────────────────────────────────
  private mapItemToEntity(row: PrismaItemLibrary): ItemLibrary {
    // Cast is safe: Prisma row contains every ItemLibrary field (plus deletedAt).
    // Prisma's $Enums.ItemLibraryScope union ("APP_GLOBAL" | "USER_PRIVATE")
    // is structurally identical to the entity's LibraryItemScope union.
    return row as unknown as ItemLibrary;
  }

  private mapCategoryToEntity(row: PrismaLibraryCategory): LibraryCategory {
    return row as unknown as LibraryCategory;
  }
}
