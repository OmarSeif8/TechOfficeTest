/**
 * GET /api/drawings/[id]/dxf — server-side DXF parse → typed JSON for the viewer.
 *
 * Per SPEC_PHASE3_WEB.md Part 3B §3 (W3-21) + §4 (BR-DW1..DW5):
 *   - Server-side parse: the upstream `dxf` package is imported ONLY here (server)
 *     — the client never imports it. The API returns the typed `{ entities,
 *     layers, extents, unit }` aggregate so the viewer can render SVG directly.
 *   - The pure `parseDrawing` domain function does the actual parsing — this
 *     route is just the I/O adapter (DB lookup + file read + parse + JSON).
 *
 * Flow:
 *   1. Fetch the Drawing by `id`. 404 if missing or not owned by the session.
 *   2. If `currentRevisionId` is set, fetch that revision + its FileUpload row.
 *   3. If the FileUpload's MIME type is a DXF (image/vnd.dxf or application/dxf),
 *      read the blob from disk (`./uploads/<sha256>`) and call `parseDrawing`.
 *   4. Otherwise (no revision, no file, or non-DXF file), return the TEST FIXTURE
 *      — Fixture A from GT-DXF-1 (1000×750 rectangle) — so the viewer can be
 *      demonstrated end-to-end during Phase 3B MVP. The response carries a
 *      `source: "fixture"` flag so the UI can display a notice.
 *
 * Per BR-WEB-5: verifies the drawing's project is owned by the session user.
 * Per BR-DW2: the heavy lifting is in the pure domain function — this route
 *           has zero SVG/DOM knowledge.
 * Per BR-DW4: the original FileUpload BLOB is the source of truth; the parsed
 *           result is regeneratable on every GET (no caching layer in MVP).
 *
 * Response shape:
 *   {
 *     entities: DxfEntity[],     // typed discriminated union (12 entity types)
 *     layers:   DxfLayer[],      // declared in TABLES or synthesized "0"
 *     extents:  Extents,         // bounding box computed from entity geometry
 *     unit:     string | null,   // BR-DW1 — null if $INSUNITS absent
 *     source:   "file" | "fixture",
 *     drawing:  { id, code, titleEn, currentRevisionId, currentRevision? }
 *   }
 *
 * Layer purity: top of the stack — App Router route handler. Uses Node.js
 * built-ins (`fs`, `path`) which is allowed at this layer. The pure parse
 * function lives in `@domain/drawing/dxf-parser`.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  withErrorHandler,
  json,
  notFound,
  badRequest,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServices } from "@/lib/services";
import { verifyProjectOwnership } from "@/app/api/_lib/boq-helpers";
import { parseDrawing, unitFromHeader } from "@domain/drawing/dxf-parser";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// MIME types we accept as DXF on the FileUpload record. The current
// file-upload allowlist (BR-WEB-3) does NOT include DXF, so in practice
// the fixture fallback is used until the allowlist is extended — the
// route stays defensive so a future allowlist update needs no code change.
const DXF_MIME_TYPES = new Set<string>([
  "image/vnd.dxf",
  "application/dxf",
  "application/acad",
  "drawing/x-dxf",
  "text/plain", // DXF is ASCII — many tools upload it as text/plain
]);

const DXF_FILENAME_EXTENSIONS = [".dxf"];

function looksLikeDxfFile(originalName: string, mimeType: string): boolean {
  if (DXF_MIME_TYPES.has(mimeType)) return true;
  const lower = originalName.toLowerCase();
  return DXF_FILENAME_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ─── Test fixture (Fixture A from GT-DXF-1: 1000×750 rectangle) ────────────
//
// Generated in-code as an ASCII string so the fixture is byte-deterministic
// and matches the golden test's expectations exactly. The viewer's empty-
// state "no drawing selected" can be exercised even when no DXF is uploaded.
function generateFixtureDxf(): string {
  const lines = [
    { start: [0, 0], end: [1000, 0] },
    { start: [1000, 0], end: [1000, 750] },
    { start: [1000, 750], end: [0, 750] },
    { start: [0, 750], end: [0, 0] },
  ];

  let dxf = "";
  dxf += "0\nSECTION\n2\nENTITIES\n";
  for (const line of lines) {
    dxf += "0\nLINE\n8\n0\n";
    dxf += `10\n${line.start[0]}\n20\n${line.start[1]}\n`;
    dxf += `11\n${line.end[0]}\n21\n${line.end[1]}\n`;
  }
  dxf += "0\nENDSEC\n0\nEOF\n";
  return dxf;
}

// ─── GET parsed DXF ─────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const services = getServices();

  // 1. Fetch the drawing + verify ownership (BR-WEB-5).
  const drawing = await services.drawings.getById(id);
  if (!drawing) return notFound("Drawing not found");

  const project = await verifyProjectOwnership(drawing.projectId, userId);
  if (!project) return notFound("Drawing not found");

  // 2. Try to find an attached DXF file via the current revision.
  let dxfText: string | null = null;
  let source: "file" | "fixture" = "fixture";
  let revisionInfo: {
    id: string;
    revision: string;
    fileUploadId: string | null;
    originalName: string | null;
    mimeType: string | null;
  } | null = null;

  if (drawing.currentRevisionId) {
    const revision = await db.drawingRevision.findUnique({
      where: { id: drawing.currentRevisionId },
      include: { fileUpload: true },
    });
    if (revision) {
      revisionInfo = {
        id: revision.id,
        revision: revision.revision,
        fileUploadId: revision.fileUploadId,
        originalName: revision.fileUpload?.originalName ?? null,
        mimeType: revision.fileUpload?.mimeType ?? null,
      };

      if (revision.fileUpload) {
        const fu = revision.fileUpload;
        if (looksLikeDxfFile(fu.originalName, fu.mimeType)) {
          // 3. Read the blob from disk and parse it.
          const diskPath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), fu.storagePath);
          try {
            const buf = await fs.readFile(diskPath);
            dxfText = buf.toString("utf8");
            source = "file";
          } catch (err) {
            // File vanished from disk (e.g. uploads/ was cleared). Fall back
            // to the fixture with a clear log — don't 500 the request.
            console.error(
              `[dxf/route] File ${fu.storagePath} not found on disk — falling back to fixture.`,
              err,
            );
          }
        } else {
          // A file is attached but it isn't a DXF (e.g. PDF, image). Return
          // a 422 so the UI can prompt the user to upload a DXF instead.
          return badRequest(
            "Attached file is not a DXF (BR-WEB-DC3: DWG/DXF web preview requires a DXF attachment)",
            {
              mimeType: fu.mimeType,
              originalName: fu.originalName,
            },
          );
        }
      }
    }
  }

  // 4. No usable DXF file → use the test fixture (Phase 3B MVP simplification).
  if (dxfText === null) {
    dxfText = generateFixtureDxf();
    source = "fixture";
  }

  // 5. Parse → typed DxfDrawing.
  const parsed = parseDrawing(dxfText);
  const unit = unitFromHeader(parsed.header);

  return json({
    entities: parsed.entities,
    layers: parsed.layers,
    extents: parsed.header.extents,
    unit,
    source,
    drawing: {
      id: drawing.id,
      code: drawing.code,
      titleEn: drawing.titleEn,
      titleAr: drawing.titleAr,
      discipline: drawing.discipline,
      currentRevisionId: drawing.currentRevisionId,
      currentRevision: revisionInfo,
    },
  });
});
