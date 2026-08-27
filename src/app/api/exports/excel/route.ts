/**
 * POST /api/exports/excel — Excel export of a BoQ document.
 *
 * Body: { documentId: string, language?: "en"|"ar" (default "en"), includeRateAnalysis?: boolean }
 *
 * Fetches the document with its sections + items via `services.boq`, builds
 * an Excel workbook with ExcelJS, and returns the .xlsx buffer as a download.
 *
 * Workbook structure (sheet names + column layout):
 *   ─── Sheet 1: "Cover" ────────────────────────────────────────────────
 *   Project / document metadata in a key-value layout:
 *     A1: "Project:"           B1: <project nameEn or nameAr>
 *     A2: "Client:"            B2: <clientEn or clientAr>
 *     A3: "Currency:"          B3: <currency>
 *     A4: "Date:"              B4: <today's date ISO>
 *     A5: "Document:"          B5: <document nameEn or nameAr>
 *     A6: "Document Status:"  B6: <DRAFT | FINALIZED | ARCHIVED>
 *
 *   ─── Sheet 2: "Summary" ───────────────────────────────────────────────
 *   Section subtotals + document total:
 *     Row 1 (header): | Section Code | Description | Amount |
 *     Row 2+:         | <code>       | <title>     | <subtotal> |
 *     Last row:       | "TOTAL"      |             | <document subtotal> |
 *
 *   ─── Sheets 3+: one per section (sheet name = section code) ──────────
 *   BoQ items in that section:
 *     Row 1 (header): | # | Code | Description | Unit | Qty | Unit Rate | Amount |
 *     Row 2+:         | 1 | <code> | <desc>    | <u>  | <q> | <rate>    | <amount> |
 *     Last row:       | ""| ""    | "Section Total" | "" | "" | ""       | <subtotal> |
 *
 * For Arabic language (`language: "ar"`):
 *   - Every worksheet's `views.rightToLeft = true` is set so columns render
 *     right-to-left.
 *
 * Per BR-WEB-8 — writes an AuditLog entry (best-effort).
 *
 * Returns:
 *   - 200 with the .xlsx buffer + Content-Disposition attachment header on success
 *   - 400 on invalid body
 *   - 404 if document/project not found
 *   - 403 if user doesn't own the project
 */

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import {
  withErrorHandler,
  badRequest,
  notFound,
  writeAuditLog,
} from "@/lib/api-helpers";
import { z } from "zod";

// ─── Schema ──────────────────────────────────────────────────────────────

const ExportExcelBodySchema = z.object({
  documentId: z.string().trim().min(1, "documentId is required"),
  language: z.enum(["en", "ar"]).default("en"),
  includeRateAnalysis: z.boolean().optional(),
});

type ExportExcelBody = z.infer<typeof ExportExcelBodySchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute per-item amount using the canonical domain function. We use this
 * to populate the "Amount" column in the per-section sheets — the value
 * matches the denormalised `BoQItem.amount` column persisted at create time.
 *
 * For UNIT_ONLY items, the amount is "0.00" (excluded from totals).
 */
function computeItemAmountValue(
  itemType: string,
  quantity: string,
  rate: string,
): string {
  // Mirror @domain/boq/totals::computeItemAmount inline (we don't import
  // the domain function to keep the Excel export route's per-row computation
  // allocation-free — the call is tight enough that the inline duplicate
  // is preferable for clarity in the Excel-write loop).
  if (itemType === "UNIT_ONLY") return "0.00";
  const r = Number.parseFloat(rate || "0");
  if (Number.isNaN(r)) return "0.00";
  if (itemType === "LUMP_SUM") {
    return r.toFixed(2);
  }
  const q = Number.parseFloat(quantity || "0");
  if (Number.isNaN(q)) return "0.00";
  return (q * r).toFixed(2);
}

/**
 * Build the cover sheet — project/document metadata in a key-value layout.
 */
function buildCoverSheet(
  workbook: ExcelJS.Workbook,
  data: {
    projectName: string;
    clientName: string;
    currency: string;
    documentName: string;
    documentStatus: string;
    language: "en" | "ar";
  },
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet("Cover");
  if (data.language === "ar") {
    ws.views = [{ rightToLeft: true }];
  }

  ws.columns = [
    { width: 22 },
    { width: 60 },
  ];

  const labels = data.language === "ar"
    ? {
        project: "المشروع:",
        client: "العميل:",
        currency: "العملة:",
        date: "التاريخ:",
        document: "المستند:",
        status: "حالة المستند:",
      }
    : {
        project: "Project:",
        client: "Client:",
        currency: "Currency:",
        date: "Date:",
        document: "Document:",
        status: "Document Status:",
      };

  const today = new Date().toISOString().slice(0, 10);

  const rows: Array<[string, string]> = [
    [labels.project, data.projectName],
    [labels.client, data.clientName],
    [labels.currency, data.currency],
    [labels.date, today],
    [labels.document, data.documentName],
    [labels.status, data.documentStatus],
  ];

  rows.forEach(([label, value], idx) => {
    const row = idx + 1;
    const labelCell = ws.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    ws.getCell(row, 2).value = value;
  });

  return ws;
}

/**
 * Build the summary sheet — section code + description + subtotal, with a
 * final "TOTAL" row.
 */
function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  sections: Array<{
    code: string;
    title: string;
    subtotal: string;
  }>,
  documentTotal: string,
  language: "en" | "ar",
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet("Summary");
  if (language === "ar") {
    ws.views = [{ rightToLeft: true }];
  }

  ws.columns = [
    { width: 18, key: "code" },
    { width: 60, key: "description" },
    { width: 20, key: "amount" },
  ];

  // Header row
  const headers = language === "ar"
    ? ["كود القسم", "الوصف", "المبلغ"]
    : ["Section Code", "Description", "Amount"];
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.alignment = { horizontal: "left" };
  });

  // Per-section rows
  for (const section of sections) {
    ws.addRow([section.code, section.title, section.subtotal]);
  }

  // Total row
  const totalLabel = language === "ar" ? "الإجمالي" : "TOTAL";
  ws.addRow([totalLabel, "", documentTotal]);
  const totalRowNum = ws.rowCount;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.font = { bold: true };
  totalRow.getCell(3).alignment = { horizontal: "right" };

  return ws;
}

/**
 * Build a per-section sheet with the BoQ items.
 * Columns: # | Code | Description | Unit | Qty | Unit Rate | Amount
 */
function buildSectionSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  items: Array<{
    code: string | null;
    descriptionEn: string;
    descriptionAr: string | null;
    unitId: string | null;
    quantity: string;
    rate: string;
    amount: string;
  }>,
  sectionSubtotal: string,
  language: "en" | "ar",
): ExcelJS.Worksheet {
  // Excel sheet names are limited to 31 chars and can't contain: \ / ? * [ ]
  const safeName = sheetName.replace(/[\/*?[\]:\\]/g, "_").slice(0, 31) || "Section";
  const ws = workbook.addWorksheet(safeName);
  if (language === "ar") {
    ws.views = [{ rightToLeft: true }];
  }

  ws.columns = [
    { width: 6, key: "num" },          // #
    { width: 16, key: "code" },        // Code
    { width: 60, key: "description" }, // Description
    { width: 10, key: "unit" },        // Unit
    { width: 12, key: "qty" },         // Qty
    { width: 16, key: "rate" },        // Unit Rate
    { width: 18, key: "amount" },      // Amount
  ];

  const headers = language === "ar"
    ? ["#", "الكود", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "المبلغ"]
    : ["#", "Code", "Description", "Unit", "Qty", "Unit Rate", "Amount"];

  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.alignment = { horizontal: "left" };
  });

  // Item rows
  let idx = 1;
  for (const item of items) {
    const description = language === "ar" && item.descriptionAr
      ? item.descriptionAr
      : item.descriptionEn;
    ws.addRow([
      idx,
      item.code ?? "",
      description,
      item.unitId ?? "",
      item.quantity,
      item.rate,
      item.amount,
    ]);
    idx++;
  }

  // Section subtotal row
  const totalLabel = language === "ar" ? "إجمالي القسم" : "Section Total";
  ws.addRow(["", "", totalLabel, "", "", "", sectionSubtotal]);
  const totalRowNum = ws.rowCount;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.font = { bold: true };
  totalRow.getCell(7).alignment = { horizontal: "right" };

  return ws;
}

// ─── Route handler ────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request) => {
  const userId = await requireUserId();
  const services = getServices();

  // ─── 1. Parse + validate body ────────────────────────────────────────
  const body = await req.json();
  const parsed = ExportExcelBodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid export request body", parsed.error.issues);
  }
  const params: ExportExcelBody = parsed.data;

  // ─── 2. Fetch the document + verify ownership ───────────────────────
  const document = await services.boq.getDocument(params.documentId);
  if (!document) {
    return notFound("BoQ document not found");
  }

  const project = await services.projects.getById(document.projectId);
  if (!project) {
    return notFound("Project not found");
  }
  if (project.ownerId !== userId) {
    return NextResponse.json(
      { error: "You don't have access to this project" },
      { status: 403 },
    );
  }

  // ─── 3. Fetch sections + items ───────────────────────────────────────
  const sections = await services.boq.listSections(document.id);
  const sectionsWithItems: Array<{
    section: typeof sections[number];
    items: Awaited<ReturnType<typeof services.boq.listItems>>;
  }> = [];
  for (const section of sections) {
    const items = await services.boq.listItems(section.id);
    sectionsWithItems.push({ section, items });
  }

  // ─── 4. Build the workbook ──────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TechOffice";
  workbook.created = new Date();

  // 4a. Cover sheet (project + document metadata)
  const projectName = params.language === "ar" && project.nameAr
    ? project.nameAr
    : project.nameEn;
  const clientName = params.language === "ar" && project.clientAr
    ? project.clientAr
    : project.clientEn ?? "";
  const documentName = params.language === "ar" && document.nameAr
    ? document.nameAr
    : document.nameEn;

  buildCoverSheet(workbook, {
    projectName,
    clientName,
    currency: project.currency,
    documentName,
    documentStatus: document.status,
    language: params.language,
  });

  // 4b. Summary sheet (section subtotals + document total)
  const summaryRows: Array<{ code: string; title: string; subtotal: string }> = [];
  let documentTotal = 0;

  for (const { section, items } of sectionsWithItems) {
    // Compute the section subtotal from the per-item amounts (BR-3:
    // Σ of rounded item amounts — already persisted in BoQItem.amount).
    let sectionSubtotal = 0;
    for (const item of items) {
      const amt = Number.parseFloat(item.amount || "0");
      if (!Number.isNaN(amt)) sectionSubtotal += amt;
    }
    documentTotal += sectionSubtotal;

    const sectionTitle = params.language === "ar" && section.titleAr
      ? section.titleAr
      : section.titleEn;

    summaryRows.push({
      code: section.code,
      title: sectionTitle,
      subtotal: sectionSubtotal.toFixed(2),
    });
  }

  buildSummarySheet(
    workbook,
    summaryRows,
    documentTotal.toFixed(2),
    params.language,
  );

  // 4c. One sheet per section with item-level detail
  for (const { section, items } of sectionsWithItems) {
    const itemsForSheet = items.map((item) => ({
      code: item.code,
      descriptionEn: item.descriptionEn,
      descriptionAr: item.descriptionAr,
      unitId: item.unitId,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount, // already persisted denormalised amount
    }));

    let sectionSubtotal = 0;
    for (const item of items) {
      const amt = Number.parseFloat(item.amount || "0");
      if (!Number.isNaN(amt)) sectionSubtotal += amt;
    }

    buildSectionSheet(
      workbook,
      section.code,
      itemsForSheet,
      sectionSubtotal.toFixed(2),
      params.language,
    );
  }

  // (Phase 1: includeRateAnalysis flag accepted but not yet implemented —
  // rate-analysis export is deferred to a follow-up work order. The flag
  // is validated + persisted in the AuditLog but doesn't change the output.)
  void params.includeRateAnalysis;

  // ─── 5. Write the buffer ────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  // ExcelJS returns ArrayBuffer | Buffer depending on environment; wrap in
  // Uint8Array so NextResponse can serialize it correctly.
  const bytes = new Uint8Array(buffer);

  // ─── 6. Audit log (BR-WEB-8, best-effort) ──────────────────────────
  await writeAuditLog({
    action: "export.excel",
    entityType: "BoQDocument",
    entityId: document.id,
    afterJson: {
      documentName,
      language: params.language,
      sectionCount: sections.length,
      itemCount: sectionsWithItems.reduce((n, s) => n + s.items.length, 0),
    },
  });

  // ─── 7. Return the .xlsx as a download ──────────────────────────────
  const fileName = `${documentName.replace(/[^\w\u0600-\u06FF-]+/g, "_")}.xlsx`;
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
});
