/**
 * IBoQRepository — interface for BoQ document/section/item persistence.
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementation: src/infrastructure/persistence/prisma/boq-repository.ts (WO-W-2-b).
 *
 * Per the architecture, the repository does NOT compute totals — that's the
 * domain layer's job. The repository just persists and retrieves rows.
 * Totals are computed by `computeDocumentTotals` from `@domain/boq/totals`.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 */

import type {
  BoQDocument,
  BoQSection,
  BoQItem,
  BoQItemType,
} from "@shared/entities";

export interface BoQDocumentCreateInput {
  projectId: string;
  nameEn: string;
  nameAr?: string | null;
}

export interface BoQSectionCreateInput {
  documentId: string;
  projectId: string;
  code: string;
  titleEn?: string;
  titleAr?: string | null;
  sortOrder: number;
}

export interface BoQItemCreateInput {
  sectionId: string;
  documentId: string;
  projectId: string;
  code?: string | null;
  descriptionEn: string;
  descriptionAr?: string | null;
  unitId?: string | null;
  quantity: string;
  rate: string;
  itemType?: BoQItemType;
  libraryItemId?: string | null;
  sortOrder: number;
}

export interface BoQItemUpdateInput {
  code?: string | null;
  descriptionEn?: string;
  descriptionAr?: string | null;
  unitId?: string | null;
  quantity?: string;
  rate?: string;
  itemType?: BoQItemType;
  sortOrder?: number;
  expectedVersion: number;
}

export type BoQItemUpdateResult =
  | { kind: "ok"; item: BoQItem }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type BoQDocumentDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type BoQItemDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface IBoQRepository {
  // Documents
  listDocuments(projectId: string, includeDeleted?: boolean): Promise<BoQDocument[]>;
  getDocument(id: string, includeDeleted?: boolean): Promise<BoQDocument | null>;
  createDocument(input: BoQDocumentCreateInput): Promise<BoQDocument>;
  softDeleteDocument(id: string, expectedVersion: number): Promise<BoQDocumentDeleteResult>;

  // Sections
  listSections(documentId: string, includeDeleted?: boolean): Promise<BoQSection[]>;
  createSection(input: BoQSectionCreateInput): Promise<BoQSection>;
  reorderSections(documentId: string, orderedIds: string[]): Promise<void>;

  // Items
  listItems(sectionId: string, includeDeleted?: boolean): Promise<BoQItem[]>;
  listAllItemsInDocument(documentId: string, includeDeleted?: boolean): Promise<BoQItem[]>;
  createItem(input: BoQItemCreateInput): Promise<BoQItem>;
  getItem(id: string): Promise<BoQItem | null>;
  updateItem(id: string, input: BoQItemUpdateInput): Promise<BoQItemUpdateResult>;
  softDeleteItem(id: string, expectedVersion: number): Promise<BoQItemDeleteResult>;
  moveItem(itemId: string, toSectionId: string, newSortOrder: number): Promise<void>;
  renumberItems(documentId: string): Promise<void>;
}
