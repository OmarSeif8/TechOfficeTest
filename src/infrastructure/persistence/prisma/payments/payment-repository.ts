/**
 * PrismaPaymentRepository — Prisma implementation of IPaymentRepository.
 *
 * Lives in src/infrastructure/persistence/prisma/payments/ (server-only).
 *
 * Layer purity (mechanically enforced by eslint.config.mjs):
 *   - MAY import: @prisma/client, @/lib/db, @domain/repositories, @shared/entities.
 *   - MUST NOT import: next, react, or any UI code.
 *
 * Optimistic concurrency (BR-WEB-4): PaymentApplication has a `version` column.
 * `update` and `softDelete` include `version: expectedVersion` in the WHERE
 * clause via `updateMany`; re-read on miss to distinguish "not found" from
 * "version mismatch" and return the appropriate tagged-union variant.
 *
 * Lines, deductions, additions are replaced atomically on update via a
 * Prisma nested write (`deleteMany` + `create`). Cascade delete on the
 * PaymentApplication row takes care of children on soft-delete (the soft-delete
 * sets deletedAt but does NOT physically delete — children remain until the
 * application is hard-deleted, which we never do in MVP).
 *
 * The repository does NOT compute IPC math — that lives in the pure domain
 * module @domain/payments/ipc-engine. The API route (W4-8) calls
 * `computeApplications` from the engine and persists the computed values
 * (valueCum, valueThisPeriod, grossCum, etc.) via `update`.
 */

import { db } from "@/lib/db";
import type {
  PaymentAddition,
  PaymentAdditionType,
  PaymentApplication,
  PaymentDeduction,
  PaymentDeductionType,
  PaymentLine,
  PaymentStatus,
} from "@shared/entities";
import type {
  IPaymentRepository,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentUpdateResult,
  PaymentDeleteResult,
  PaymentApplicationDetail,
  PaymentAdditionInput,
  PaymentDeductionInput,
  PaymentLineInput,
} from "@domain/repositories/payments-repositories";

type PrismaPaymentRow = {
  id: string;
  projectId: string;
  ipcNo: number;
  periodStart: string;
  periodEnd: string;
  status: PaymentStatus;
  contractValue: string;
  retentionPercent: string;
  retentionCapAmount: string | null;
  advanceAmount: string;
  advanceEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapApplication(row: PrismaPaymentRow): PaymentApplication {
  return row as unknown as PaymentApplication;
}

function lineCreateData(input: PaymentLineInput, sortOrder: number) {
  return {
    boqItemId: input.boqItemId,
    qtyThisPeriod: input.qtyThisPeriod,
    qtyCum: input.qtyCum,
    valueThisPeriod: input.valueThisPeriod,
    valueCum: input.valueCum,
    rate: input.rate,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

function deductionCreateData(input: PaymentDeductionInput, sortOrder: number) {
  return {
    type: input.type as PaymentDeductionType,
    descriptionEn: input.descriptionEn,
    amount: input.amount,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

function additionCreateData(input: PaymentAdditionInput, sortOrder: number) {
  return {
    type: input.type as PaymentAdditionType,
    descriptionEn: input.descriptionEn,
    amount: input.amount,
    sortOrder: input.sortOrder ?? sortOrder,
  };
}

export class PrismaPaymentRepository implements IPaymentRepository {
  async list(projectId: string, includeDeleted: boolean = false): Promise<PaymentApplication[]> {
    const where: Record<string, unknown> = { projectId };
    if (!includeDeleted) where.deletedAt = null;

    const rows = await db.paymentApplication.findMany({
      where,
      orderBy: [{ ipcNo: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => mapApplication(r as unknown as PrismaPaymentRow));
  }

  async getById(id: string, includeDeleted: boolean = false): Promise<PaymentApplication | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.paymentApplication.findFirst({ where });
    return row ? mapApplication(row as unknown as PrismaPaymentRow) : null;
  }

  async getDetail(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<PaymentApplicationDetail | null> {
    const where: Record<string, unknown> = { id };
    if (!includeDeleted) where.deletedAt = null;

    const row = await db.paymentApplication.findFirst({
      where,
      include: {
        lines: { orderBy: [{ sortOrder: "asc" }] },
        deductions: { orderBy: [{ sortOrder: "asc" }] },
        additions: { orderBy: [{ sortOrder: "asc" }] },
      },
    });
    if (!row) return null;

    const app = mapApplication(row as unknown as PrismaPaymentRow);
    const lines = (row as unknown as { lines: PaymentLine[] }).lines as PaymentLine[];
    const deductions = (row as unknown as { deductions: PaymentDeduction[] })
      .deductions as PaymentDeduction[];
    const additions = (row as unknown as { additions: PaymentAddition[] })
      .additions as PaymentAddition[];

    return { application: app, lines, deductions, additions };
  }

  async create(input: PaymentCreateInput): Promise<PaymentApplication> {
    const row = await db.paymentApplication.create({
      data: {
        projectId: input.projectId,
        ipcNo: input.ipcNo,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? "DRAFT",
        contractValue: input.contractValue,
        retentionPercent: input.retentionPercent,
        retentionCapAmount: input.retentionCapAmount ?? null,
        advanceAmount: input.advanceAmount,
        advanceEnabled: input.advanceEnabled,
        lines: input.lines
          ? {
              create: input.lines.map((l, i) => lineCreateData(l, i)),
            }
          : undefined,
        deductions: input.deductions
          ? {
              create: input.deductions.map((d, i) => deductionCreateData(d, i)),
            }
          : undefined,
        additions: input.additions
          ? {
              create: input.additions.map((a, i) => additionCreateData(a, i)),
            }
          : undefined,
      },
    });
    return mapApplication(row as unknown as PrismaPaymentRow);
  }

  async update(id: string, input: PaymentUpdateInput): Promise<PaymentUpdateResult> {
    const { expectedVersion, lines, deductions, additions, ...fields } = input;

    const data: Record<string, unknown> = {};
    if (fields.periodStart !== undefined) data.periodStart = fields.periodStart;
    if (fields.periodEnd !== undefined) data.periodEnd = fields.periodEnd;
    if (fields.status !== undefined) data.status = fields.status;
    if (fields.contractValue !== undefined) data.contractValue = fields.contractValue;
    if (fields.retentionPercent !== undefined) data.retentionPercent = fields.retentionPercent;
    if (fields.retentionCapAmount !== undefined) {
      data.retentionCapAmount = fields.retentionCapAmount;
    }
    if (fields.advanceAmount !== undefined) data.advanceAmount = fields.advanceAmount;
    if (fields.advanceEnabled !== undefined) data.advanceEnabled = fields.advanceEnabled;

    // Replace child rows atomically (deleteMany + create).
    if (lines !== undefined) {
      data.lines = {
        deleteMany: {},
        create: lines.map((l, i) => lineCreateData(l, i)),
      };
    }
    if (deductions !== undefined) {
      data.deductions = {
        deleteMany: {},
        create: deductions.map((d, i) => deductionCreateData(d, i)),
      };
    }
    if (additions !== undefined) {
      data.additions = {
        deleteMany: {},
        create: additions.map((a, i) => additionCreateData(a, i)),
      };
    }

    const result = await db.paymentApplication.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.paymentApplication.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    const updated = await db.paymentApplication.findUnique({ where: { id } });
    return {
      kind: "ok" as const,
      application: mapApplication(updated as unknown as PrismaPaymentRow),
    };
  }

  async softDelete(id: string, expectedVersion: number): Promise<PaymentDeleteResult> {
    const result = await db.paymentApplication.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count === 0) {
      const existing = await db.paymentApplication.findUnique({ where: { id } });
      if (!existing) return { kind: "not_found" as const };
      return { kind: "conflict" as const, currentVersion: existing.version };
    }

    return { kind: "ok" as const };
  }
}
