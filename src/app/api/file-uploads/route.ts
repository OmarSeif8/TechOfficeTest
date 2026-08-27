/**
 * POST /api/file-uploads
 *
 * Multipart form upload. Accepts a single file under the form key `file`,
 * validates MIME type and size (BR-WEB-2 — 10 MB hard limit; BR-WEB-3 —
 * MIME allowlist), computes the SHA-256, stores the blob on disk at
 * `./uploads/<sha256>`, and creates a `FileUpload` row with the metadata.
 *
 * Returns 201 with the FileUpload record.
 *
 * Allowlist (BR-WEB-3):
 *   - image/png
 *   - image/jpeg
 *   - image/webp
 *   - application/pdf
 *   - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *
 * Per BR-WEB-5: requires an authenticated session.
 * Per BR-WEB-8: writes an AuditLog entry on success.
 *
 * Layer purity: top of the stack — App Router route handler. Uses Node.js
 * built-ins (`fs`, `path`, `crypto`) which is allowed at this layer.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { withErrorHandler, created, badRequest, writeAuditLog } from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";

const ALLOWED_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (BR-WEB-2)

export const POST = withErrorHandler(async (req: NextRequest) => {
  const userId = await requireUserId();

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return badRequest("No file provided");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File too large", maxBytes: MAX_FILE_SIZE_BYTES },
      { status: 413 },
    );
  }

  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    return badRequest("Unsupported file type", { mimeType: file.type });
  }

  // ─── Read bytes + compute SHA-256 ───────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // ─── Persist blob to disk (./uploads/<sha256>) ──────────────────────────
  // The `uploads/` directory is created lazily here so the project works
  // out-of-the-box on a fresh clone. It is gitignored (see .gitignore).
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });

  const storageFilename = sha256; // per WO-W-12a spec: blob path is ./uploads/<sha256>
  const diskPath = path.join(uploadsDir, storageFilename);
  await fs.writeFile(diskPath, buffer);

  // Relative storagePath kept portable across environments — `uploads/<sha256>`
  const storagePath = path.join("uploads", storageFilename);

  // ─── Create FileUpload row ─────────────────────────────────────────────
  const fileUpload = await db.fileUpload.create({
    data: {
      uploaderUserId: userId,
      filename: storageFilename,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storagePath,
      sha256,
    },
  });

  await writeAuditLog({
    action: "create",
    entityType: "FileUpload",
    entityId: fileUpload.id,
    afterJson: fileUpload,
  });

  return created(fileUpload);
});
