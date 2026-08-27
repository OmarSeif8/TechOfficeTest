/**
 * IProjectRepository — interface for project persistence.
 *
 * Lives in src/domain/repositories/ (pure interface — no Prisma imports).
 * Implementation: src/infrastructure/persistence/prisma/project-repository.ts (WO-W-2-a).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this is what makes the domain layer portable.
 * The interface is imported by both the domain layer (for type hints) and the
 * infrastructure layer (for implementation). Same interface, two consumers.
 *
 * Entity types come from @shared/entities (plain TS interfaces — no Prisma dep).
 */

import type { Project } from "@shared/entities";

/**
 * Filter/pagination options for list queries.
 */
export interface ProjectListOptions {
  ownerId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ProjectCreateInput {
  ownerId: string;
  nameEn: string;
  nameAr?: string | null;
  clientEn?: string | null;
  clientAr?: string | null;
  locationEn?: string | null;
  locationAr?: string | null;
  contractNo?: string | null;
  currency?: string;
}

export interface ProjectUpdateInput {
  nameEn?: string;
  nameAr?: string | null;
  clientEn?: string | null;
  clientAr?: string | null;
  locationEn?: string | null;
  locationAr?: string | null;
  contractNo?: string | null;
  currency?: string;
  /** For optimistic concurrency (BR-WEB-4). Must match the current version. */
  expectedVersion: number;
}

/**
 * Result of an update operation. If the version didn't match, returns
 * `{ kind: "conflict" }` instead of throwing — caller decides how to handle.
 */
export type ProjectUpdateResult =
  | { kind: "ok"; project: Project }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export type ProjectDeleteResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

export interface IProjectRepository {
  list(options: ProjectListOptions): Promise<Project[]>;
  count(options: ProjectListOptions): Promise<number>;
  getById(id: string, includeDeleted?: boolean): Promise<Project | null>;
  create(input: ProjectCreateInput): Promise<Project>;
  update(id: string, input: ProjectUpdateInput): Promise<ProjectUpdateResult>;
  softDelete(id: string, expectedVersion: number): Promise<ProjectDeleteResult>;
  restore(id: string): Promise<Project | null>;
}
