/**
 * IItemLibraryRepository — interface for the app-level item catalog.
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementation: src/infrastructure/persistence/prisma/item-library-repository.ts (WO-W-2-c).
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 */

import type { ItemLibrary, LibraryCategory, LibraryItemScope } from "@shared/entities";

export interface LibraryItemSearchOptions {
  search?: string;
  categoryId?: string;
  scope?: LibraryItemScope;
  ownerId?: string;
  limit?: number;
  offset?: number;
}

export interface LibraryItemCreateInput {
  code?: string | null;
  descriptionEn: string;
  descriptionAr?: string | null;
  unitId?: string | null;
  defaultSpecsEn?: string | null;
  defaultSpecsAr?: string | null;
  categoryId?: string | null;
  scope: LibraryItemScope;
  ownerId?: string | null;
}

export interface IItemLibraryRepository {
  search(options: LibraryItemSearchOptions): Promise<ItemLibrary[]>;
  countSearch(options: LibraryItemSearchOptions): Promise<number>;
  getById(id: string): Promise<ItemLibrary | null>;
  create(input: LibraryItemCreateInput): Promise<ItemLibrary>;
  listCategories(): Promise<LibraryCategory[]>;
}
