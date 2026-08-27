/**
 * POST /api/exports/pdf — PDF export of a BoQ document.
 *
 * Body: { documentId: string, language?: "en"|"ar" (default "en"), includeRateAnalysis?: boolean }
 *
 * Phase 1: returns printable HTML (the user uses the browser's print dialog
 * Ctrl+P / Cmd+P to "Save as PDF"). This is a pragmatic Phase 1 approach
 * because Puppeteer is not installed (heavy native dependency).
 *
 * Phase 2 (deferred): integrate Puppeteer (or a server-side HTML-to-PDF
 * service like DocRaptor / wkhtmltopdf) for server-side PDF generation
 * that can be emailed / archived without a browser.
 *
 * The HTML is a print-optimized layout:
 *   - Cover page: project + document metadata
 *   - Summary table: section subtotals + document total
 *   - Per-section tables: items with columns # | Code | Description | Unit | Qty | Unit Rate | Amount
 *   - Page breaks between sections (`<div style="page-break-after: always">`)
 *   - Arabic RTL support when `language: "ar"` (`<html dir="rtl" lang="ar">`)
 *
 * Returns:
 *   - 200 with Content-Type: text/html
 *   - 400 on invalid body
 *   - 404 if document/project not found
 *   - 403 if user doesn't own the project
 *
 * Per BR-WEB-8 — writes an AuditLog entry (best-effort).
 *
 * Phase 1 deferral note (per spec):
 *   "Phase 1: returns printable HTML. Phase 2: integrate Puppeteer for
 *   server-side PDF generation."
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/lib/auth";
import { getServices } from "@/lib/services";
import {
  withErrorHandler,
  badRequest,
  notFound,
  writeAuditLog,
} from "@/lib/api-helpers";

// ─── Schema ──────────────────────────────────────────────────────────────

const ExportPdfBodySchema = z.object({
  documentId: z.string().trim().min(1, "documentId is required"),
  language: z.enum(["en", "ar"]).default("en"),
  includeRateAnalysis: z.boolean().optional(),
});

type ExportPdfBody = z.infer<typeof ExportPdfBodySchema>;

// ─── HTML escape helper ──────────────────────────────────────────────────

/**
 * Escape a user-supplied string for safe interpolation into HTML.
 * Defends against XSS in case any field contains `<`, `>`, `&`, or quotes.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── HTML builders ─────────────────────────────────────────────────────

interface CoverData {
  projectName: string;
  clientName: string;
  currency: string;
  documentName: string;
  documentStatus: string;
  date: string;
}

interface SummaryRow {
  code: string;
  title: string;
  subtotal: string;
}

interface SectionBlock {
  code: string;
  title: string;
  items: Array<{
    index: number;
    code: string;
    description: string;
    unit: string;
    quantity: string;
    rate: string;
    amount: string;
  }>;
  subtotal: string;
}

interface TemplateData {
  language: "en" | "ar";
  cover: CoverData;
  summary: SummaryRow[];
  sections: SectionBlock[];
  documentTotal: string;
}

/**
 * Build the HTML page that the browser will render and the user will print
 * to PDF. The HTML is self-contained — inline CSS for print-optimization,
 * no external assets (so it works offline and renders consistently).
 *
 * Print CSS:
 *   - `@page { size: A4; margin: 18mm; }` — standard A4 with comfortable margins
 *   - `.page-break { page-break-after: always; }` — forced page breaks between sections
 *   - `table { width: 100%; border-collapse: collapse; }` — full-width tables
 *   - `th, td { border: 1px solid #333; padding: 6px 8px; font-size: 11px; }` — compact cells
 *   - The last section block has no `.page-break` div so the document ends cleanly.
 */
function buildHtml(data: TemplateData): string {
  const isArabic = data.language === "ar";
  const dir = isArabic ? "rtl" : "ltr";
  const lang = isArabic ? "ar" : "en";

  const t = isArabic
    ? {
        titlePrefix: "Bill of Quantities —", // English label even in Arabic mode (project names often English)
        project: "المشروع",
        client: "العميل",
        currency: "العملة",
        date: "التاريخ",
        document: "المستند",
        status: "حالة المستند",
        summaryHeading: "ملخص الأقسام",
        sectionCode: "كود القسم",
        description: "الوصف",
        amount: "المبلغ",
        total: "الإجمالي",
        sectionTotal: "إجمالي القسم",
        columns: ["#", "الكود", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "المبلغ"],
        printHint: "للحصول على ملف PDF: اضغط Ctrl+P (أو Cmd+P على ماك) ثم اختر \"حفظ كـ PDF\".",
      }
    : {
        titlePrefix: "Bill of Quantities —",
        project: "Project",
        client: "Client",
        currency: "Currency",
        date: "Date",
        document: "Document",
        status: "Document Status",
        summaryHeading: "Section Summary",
        sectionCode: "Section Code",
        description: "Description",
        amount: "Amount",
        total: "TOTAL",
        sectionTotal: "Section Total",
        columns: ["#", "Code", "Description", "Unit", "Qty", "Unit Rate", "Amount"],
        printHint: "To save as PDF: press Ctrl+P (or Cmd+P on Mac) then choose \"Save as PDF\".",
      };

  // ─── Cover page ──────────────────────────────────────────────────────
  const cover = `
    <section class="cover">
      <h1>${escapeHtml(t.titlePrefix)} ${escapeHtml(data.cover.documentName)}</h1>
      <table class="cover-table">
        <tr><th>${escapeHtml(t.project)}</th><td>${escapeHtml(data.cover.projectName)}</td></tr>
        <tr><th>${escapeHtml(t.client)}</th><td>${escapeHtml(data.cover.clientName)}</td></tr>
        <tr><th>${escapeHtml(t.currency)}</th><td>${escapeHtml(data.cover.currency)}</td></tr>
        <tr><th>${escapeHtml(t.date)}</th><td>${escapeHtml(data.cover.date)}</td></tr>
        <tr><th>${escapeHtml(t.document)}</th><td>${escapeHtml(data.cover.documentName)}</td></tr>
        <tr><th>${escapeHtml(t.status)}</th><td>${escapeHtml(data.cover.documentStatus)}</td></tr>
      </table>
    </section>`;

  // ─── Summary table ───────────────────────────────────────────────────
  const summaryRows = data.summary
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.code)}</td>
          <td>${escapeHtml(row.title)}</td>
          <td class="num">${escapeHtml(row.subtotal)}</td>
        </tr>`,
    )
    .join("");

  const summary = `
    <section class="page-break">
      <h2>${escapeHtml(t.summaryHeading)}</h2>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(t.sectionCode)}</th>
            <th>${escapeHtml(t.description)}</th>
            <th class="num">${escapeHtml(t.amount)}</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
          <tr class="total-row">
            <td colspan="2">${escapeHtml(t.total)}</td>
            <td class="num">${escapeHtml(data.documentTotal)}</td>
          </tr>
        </tbody>
      </table>
    </section>`;

  // ─── Per-section tables ─────────────────────────────────────────────
  const sectionBlocks = data.sections
    .map((section) => {
      const headerCells = t.columns
        .map((col) => `<th>${escapeHtml(col)}</th>`)
        .join("");
      const itemRows = section.items
        .map(
          (item) => `
            <tr>
              <td class="num">${item.index}</td>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td class="num">${escapeHtml(item.quantity)}</td>
              <td class="num">${escapeHtml(item.rate)}</td>
              <td class="num">${escapeHtml(item.amount)}</td>
            </tr>`,
        )
        .join("");
      return `
        <section class="page-break">
          <h2>${escapeHtml(section.code)} — ${escapeHtml(section.title)}</h2>
          <table>
            <thead><tr>${headerCells}</tr></thead>
            <tbody>
              ${itemRows}
              <tr class="total-row">
                <td colspan="6">${escapeHtml(t.sectionTotal)}</td>
                <td class="num">${escapeHtml(section.subtotal)}</td>
              </tr>
            </tbody>
          </table>
        </section>`;
    })
    .join("");

  // ─── Full HTML document ─────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(data.cover.documentName)} — BoQ Export</title>
  <style>
    /* Print-optimized layout — A4, comfortable margins. */
    @page {
      size: A4;
      margin: 18mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
        Arial, "Noto Sans Arabic", "Segoe UI Arabic", sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #111;
      margin: 0;
      padding: 0;
    }
    /* Cover page — vertically centered metadata table. */
    .cover {
      page-break-after: always;
      min-height: 80vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .cover h1 {
      font-size: 26px;
      margin-bottom: 32px;
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 12px;
    }
    .cover-table {
      width: 80%;
      margin: 0 auto;
      border-collapse: collapse;
    }
    .cover-table th {
      text-align: ${isArabic ? "right" : "left"};
      width: 35%;
      padding: 8px 12px;
      background: #f5f5f5;
      border: 1px solid #999;
      font-weight: 600;
    }
    .cover-table td {
      padding: 8px 12px;
      border: 1px solid #999;
    }
    /* Summary + section tables. */
    h2 {
      font-size: 16px;
      margin-top: 0;
      margin-bottom: 12px;
      padding-bottom: 4px;
      border-bottom: 1px solid #999;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th, td {
      border: 1px solid #333;
      padding: 6px 8px;
      font-size: 11px;
      text-align: ${isArabic ? "right" : "left"};
      vertical-align: top;
    }
    th {
      background: #eee;
      font-weight: 600;
    }
    .num {
      text-align: ${isArabic ? "left" : "right"};
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .total-row td {
      font-weight: 700;
      background: #f5f5f5;
    }
    /* Page breaks between sections. */
    .page-break {
      page-break-before: always;
    }
    /* Print hint shown on screen but hidden in print. */
    .print-hint {
      position: fixed;
      bottom: 8px;
      right: 8px;
      background: #ffd;
      padding: 6px 10px;
      border: 1px solid #cc9;
      font-size: 11px;
      color: #553;
    }
    @media print {
      .print-hint { display: none; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  ${cover}
  ${summary}
  ${sectionBlocks}
  <div class="print-hint">${escapeHtml(t.printHint)}</div>
</body>
</html>`;
}

// ─── Route handler ────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request) => {
  const userId = await requireUserId();
  const services = getServices();

  // ─── 1. Parse + validate body ────────────────────────────────────────
  const body = await req.json();
  const parsed = ExportPdfBodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid export request body", parsed.error.issues);
  }
  const params: ExportPdfBody = parsed.data;

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
  const sectionBlocks: SectionBlock[] = [];
  const summaryRows: SummaryRow[] = [];
  let documentTotal = 0;

  for (const section of sections) {
    const items = await services.boq.listItems(section.id);

    let sectionSubtotal = 0;
    const itemBlocks: SectionBlock["items"] = items.map((item, idx) => {
      const amt = Number.parseFloat(item.amount || "0");
      if (!Number.isNaN(amt)) sectionSubtotal += amt;
      const description = params.language === "ar" && item.descriptionAr
        ? item.descriptionAr
        : item.descriptionEn;
      return {
        index: idx + 1,
        code: item.code ?? "",
        description,
        unit: item.unitId ?? "",
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      };
    });

    documentTotal += sectionSubtotal;
    const sectionTitle = params.language === "ar" && section.titleAr
      ? section.titleAr
      : section.titleEn;

    sectionBlocks.push({
      code: section.code,
      title: sectionTitle,
      items: itemBlocks,
      subtotal: sectionSubtotal.toFixed(2),
    });

    summaryRows.push({
      code: section.code,
      title: sectionTitle,
      subtotal: sectionSubtotal.toFixed(2),
    });
  }

  // ─── 4. Build the cover data ────────────────────────────────────────
  const projectName = params.language === "ar" && project.nameAr
    ? project.nameAr
    : project.nameEn;
  const clientName = params.language === "ar" && project.clientAr
    ? project.clientAr
    : project.clientEn ?? "";
  const documentName = params.language === "ar" && document.nameAr
    ? document.nameAr
    : document.nameEn;

  const cover: CoverData = {
    projectName,
    clientName,
    currency: project.currency,
    documentName,
    documentStatus: document.status,
    date: new Date().toISOString().slice(0, 10),
  };

  // ─── 5. Build the HTML ──────────────────────────────────────────────
  const html = buildHtml({
    language: params.language,
    cover,
    summary: summaryRows,
    sections: sectionBlocks,
    documentTotal: documentTotal.toFixed(2),
  });

  // (Phase 1: includeRateAnalysis flag accepted but not yet implemented.)
  void params.includeRateAnalysis;

  // ─── 6. Audit log (BR-WEB-8, best-effort) ──────────────────────────
  await writeAuditLog({
    action: "export.pdf",
    entityType: "BoQDocument",
    entityId: document.id,
    afterJson: {
      documentName,
      language: params.language,
      sectionCount: sections.length,
      itemCount: sectionBlocks.reduce((n, s) => n + s.items.length, 0),
    },
  });

  // ─── 7. Return the HTML ─────────────────────────────────────────────
  // Phase 1: returns printable HTML. Phase 2: integrate Puppeteer for
  // server-side PDF generation (would return Content-Type: application/pdf
  // + Content-Disposition: attachment; filename="boq.pdf").
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${encodeURIComponent(documentName)}.html"`,
    },
  });
});
