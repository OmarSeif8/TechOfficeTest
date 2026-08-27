# PHASE 3 SPEC — Document Control + Drawing Viewer (Web Adaptation)

**Document**: `docs/planning/SPEC_PHASE3_WEB.md`
**Product**: TechOffice
**Phase**: 3 · **Status**: Draft v1.0 (Web Adaptation)
**Governing document**: `CONSTITUTION_V1.1_WEB.md`
**Source**: Turn 34 of the imported GLM 5.2 conversation (SPEC 3A + SPEC 3B), adapted for web.

> Phase 3 is split into two parts per the original plan:
> - **3A — Document Control Logs** (drawings, submittals, RFIs, correspondence, transmittals)
> - **3B — Drawing Viewer** (DXF parsing + SVG rendering + measurement + markup)
>
> 3A executes first (higher value, lower risk). 3B follows (highest risk component).

---

## Part 3A — Document Control Logs

### 1. Scope (UNCHANGED)

**In**: drawing register (metadata + revisions + attachments), submittals log (status workflow + history), RFI log (Q&A), correspondence register + transmittal builder, overdue tracking, log exports (Excel), transmittal PDF form, documents dashboard widgets.

**Out (3B)**: DXF/DWG viewing, measurement, markup.
**Out (later)**: email integration, approval signatures, review links.

### 2. New Domain Law — Constitution Amendment #2 (UNCHANGED)

**BR-DC1**: Clocks are injected. Every date-dependent domain function receives the current date as an `asOf` parameter. `Date.now()` and `new Date()` are forbidden in `src/domain/`. The UI supplies "today" from one single source. This makes overdue logic testable.

### 3. Business Rules (UNCHANGED)

| ID | RULE |
|----|------|
| BR-DC2 | Numbering: submittals SUB-###, RFIs RFI-###, correspondence IN-### / OUT-###. Sequential, monotonic, never reused. Drawing codes are engineer-assigned, unique per project. |
| BR-DC3 | Revisions: default series A, B, C…; new revision requires an attached file; adding rev N+1 auto-supersedes the current revision. Revision events are logged. |
| BR-DC4 | Drawing statuses: preliminary → issued → approved-for-construction; superseded / obsolete are terminal. |
| BR-DC5 | Submittal statuses: draft → submitted → under-review → approved / approved-with-comments / rejected / revise-resubmit. Final = approved / approved-with-comments / rejected. |
| BR-DC6 | Due date = submitted date + review period (submittals default 14d, RFIs default 7d). Overdue ⇔ asOf > due AND status is non-final and not draft. daysOverdue = asOf − due in calendar days. |
| BR-DC7 | RFI statuses: open → answered → closed; cancelled terminal. Answering sets answer text (EN/AR) + answer date. |
| BR-DC8 | Every status change writes an append-only event row (date, from, to, note). Events are never edited or deleted. |
| BR-DC9 | Attachments: file upload via FileUpload table (Phase 1). Single file: soft warning 50MB, hard error 200MB. |
| BR-DC10 | Transmittal = correspondence (type transmittal) + N lines (doc ref, description, copies). PDF form footer shows total copies. |

### ▶▶ WEB ADAPTATION — new business rules:

| ID | RULE |
|----|------|
| BR-WEB-DC1 | Transmittal PDF: Phase 3 uses printable HTML (same as Phase 1 export — Puppeteer deferred to Phase 5). |
| BR-WEB-DC2 | File attachments stored via FileUpload table (Phase 1 infrastructure — blob on disk + metadata in DB + sha256). |
| BR-WEB-DC3 | DWG conversion via ODA File Converter is a DESKTOP-ONLY feature. Web app detects DWG files and shows "DWG conversion requires the desktop app" message. |

### 4. Golden Tests (UNCHANGED — hand-computed, the law)

| ID | CASE | EXPECTED |
|----|------|----------|
| GT-DC1 | Drawing D-100, current rev A (issued); add revision B with file | Rev A → superseded; current = B with status issued; events include revision-added: B |
| GT-DC2 | SUB-001 submitted 2026-01-05, period 14d, status under-review | Due 2026-01-19. asOf 2026-01-19 → not overdue. asOf 2026-01-20 → overdue, 1 day. Approve on 2026-01-21 → final, never overdue again |
| GT-DC3 | Create SUB-001..003; soft-delete SUB-002; create next | Next ref = SUB-004 (002 retired) |
| GT-DC4 | SUB-001 revise-resubmit, resubmitted 2026-02-01, period 14d | resubmission_no = 1; due = 2026-02-15 |
| GT-DC5 | RFI sent 2026-03-01, period 7d, still open, asOf 2026-03-10 | Overdue, 2 days. Same RFI answered 2026-03-09 → not overdue, status answered |
| GT-DC6 | Transmittal, 3 lines with copies 2/3/1 | Total copies = 6 on form |

### 5. Data Model (Web Adaptation)

New Prisma models (additive — reserved in Phase 1 schema as RESERVED Phase 3):

- `Drawing` — id, projectId, code (unique per project), titleEn, titleAr?, discipline (enum), currentRevisionId?, deletedAt?, version, createdAt, updatedAt
- `DrawingRevision` — id, drawingId, revision (String: "A", "B", "C"...), status (enum: PRELIMINARY|ISSUED|APPROVED_FOR_CONSTRUCTION|SUPERSEDED|OBSOLETE), revisionDate (String ISO), fileUploadId?, notes?, createdByUserId, createdAt
- `DrawingRevisionEvent` — id, drawingId, revisionId, eventType (enum: REVISION_ADDED|STATUS_CHANGED|SUPERSEDED), fromStatus?, toStatus?, note?, eventDate (String ISO), createdByUserId, createdAt
- `Submittal` — id, projectId, ref (String: "SUB-001"), subjectEn, subjectAr?, type (enum: MATERIAL|TECHNICAL), discipline, submittedDate? (String ISO), reviewPeriodDays (Int default 14), resubmissionNo (Int default 0), status (enum), deletedAt?, version, createdAt, updatedAt
- `SubmittalEvent` — id, submittalId, fromStatus?, toStatus, note?, eventDate (String ISO), createdByUserId, createdAt
- `Rfi` — id, projectId, ref (String: "RFI-001"), questionEn, questionAr?, linkedDrawingId?, sentDate? (String ISO), reviewPeriodDays (Int default 7), answerEn?, answerAr?, answerDate? (String ISO), status (enum: OPEN|ANSWERED|CLOSED|CANCELLED), deletedAt?, version, createdAt, updatedAt
- `RfiEvent` — id, rfiId, fromStatus?, toStatus, note?, eventDate (String ISO), createdByUserId, createdAt
- `Correspondence` — id, projectId, ref (String: "IN-001" or "OUT-001"), direction (enum: INCOMING|OUTGOING), type (enum: LETTER|MEMO|TRANSMITTAL|EMAIL|OTHER), date (String ISO), subjectEn, subjectAr?, fromParty, toParty, bodyEn?, bodyAr?, deletedAt?, version, createdAt, updatedAt
- `TransmittalLine` — id, transmittalId (FK to Correspondence where type=TRANSMITTAL), docRef, descriptionEn, descriptionAr?, copies (Int), sortOrder

### 6. Screens (Web Adaptation — SPA views)

| Screen | View name | Description |
|--------|-----------|-------------|
| S17 Drawing register | `"drawings"` | Table with filters + revision drawer + add-revision flow |
| S18 Submittals log | `"submittals"` | Table + status timeline + status-change actions |
| S19 RFI log | `"rfis"` | Table + question/answer detail |
| S20 Correspondence | `"correspondence"` | Table + transmittal builder with live preview |
| S21 Documents dashboard | `"documents-dashboard"` | Widget cards linking to filtered lists |

---

## Part 3B — Drawing Viewer (DXF/DWG)

### 1. Library & Licensing (UNCHANGED)

- **DXF parse + render**: `dxf` npm package (bjnortier, MIT) → SVG output
- **Forbidden**: LibreDWG and any GPL/AGPL viewer component
- **DWG**: No library. Detect by file magic → prompt user to use desktop app for conversion (BR-WEB-DC3)

### 2. Entity Support Matrix (UNCHANGED)

- **Must render**: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE, TEXT, POINT, INSERT + BLOCK definitions
- **Best-effort**: MTEXT, DIMENSION, SPLINE
- **Graceful skip**: HATCH, 3DSOLID, custom/proxy entities

### 3. Web Adaptation for DXF Viewer

| Original (Desktop) | Adapted (Web) |
|--------------------|---------------|
| DXF parse in-process | Server-side parse in API route → return SVG to client |
| SVG in Electron window | SVG rendered as React component (client-side) |
| Zoom/pan via native canvas | Zoom/pan via CSS transforms on the SVG element |
| ODA File Converter shell-out | DESKTOP-ONLY — web shows "DWG requires desktop app" (BR-WEB-DC3) |
| Markup overlay on canvas | Markup overlay on SVG (stored in DB, rendered as SVG elements) |

### 4. Business Rules (UNCHANGED)

| ID | RULE |
|----|------|
| BR-DW1 | Units from $INSUNITS header |
| BR-DW2 | Screen↔model transforms are pure functions (no DOM in domain) |
| BR-DW3 | Layer visibility filtering is a pure function |
| BR-DW4 | DXF cache is regeneratable disk data; original file BLOB is source of truth |
| BR-DW5 | OA integration: desktop-only for web MVP (BR-WEB-DC3) |

### 5. Golden Tests (UNCHANGED — synthetic fixtures, zero binary files)

| ID | CASE | EXPECTED |
|----|------|----------|
| GT-DXF-1 | Parse Fixture A (4 LINEs, rectangle) | 4 LINE entities; extents min (0,0), max (1000,750) |
| GT-DXF-2 | Measurements on Fixture A | Distance (0,0)→(1000,0) = 1000.000; polygon area = 750,000.00; perimeter = 3500.000 |
| GT-DXF-3 | Transform round-trip | 5 (zoom, pan, point) tuples: screen(model(·)) and model(screen(·)) return original |
| GT-DXF-4 | Layer toggle on Fixture B | Filter with layer B hidden → excludes B's entities |
| GT-DXF-5 | $INSUNITS=4 → mm; absent → null | unitFromHeader() contract |

---

## Implementation Work Orders

### Group N — Domain Core (3A) — sequential
| WO | Name | Files | Test |
|----|------|-------|------|
| **W3-1** | Document control domain (numbering, overdue, status workflows) | `src/shared/schemas/doccontrol/*.ts`; `src/domain/doccontrol/*.ts` | GT-DC1..GT-DC6 all green |
| **W3-2** | Transmittal domain (line items, total copies) | `src/domain/doccontrol/transmittal.ts` | GT-DC6 |

### Group O — Prisma Schema + Repositories (3A) — sequential after N
| WO | Name | Files | Test |
|----|------|-------|------|
| **W3-3** | Prisma schema: Drawing, DrawingRevision, DrawingRevisionEvent, Submittal, SubmittalEvent, Rfi, RfiEvent, Correspondence, TransmittalLine | `prisma/schema.prisma` (additive) | `db:generate` + `db:push` |
| **W3-4** | Repository interfaces + Prisma impls | `src/domain/repositories/doccontrol-repositories.ts`; `src/infrastructure/persistence/prisma/doccontrol/*.ts` | Integration tests |
| **W3-5** | Seed disciplines (8 rows) | `prisma/seed.ts` (update) | Verify 8 disciplines seeded |

### Group P — API Routes (3A) — sequential after O
| WO | Name | Files |
|----|------|-------|
| **W3-6** | Drawings API (CRUD + revisions + events) | `src/app/api/projects/[projectId]/drawings/route.ts`; `drawings/[id]/route.ts`; `drawings/[id]/revisions/route.ts` |
| **W3-7** | Submittals API (CRUD + status workflow + events) | `src/app/api/projects/[projectId]/submittals/route.ts`; `submittals/[id]/route.ts`; `submittals/[id]/status/route.ts` |
| **W3-8** | RFIs API (CRUD + answer + events) | `src/app/api/projects/[projectId]/rfis/route.ts`; `rfis/[id]/route.ts`; `rfis/[id]/answer/route.ts` |
| **W3-9** | Correspondence API (CRUD + transmittal lines) | `src/app/api/projects/[projectId]/correspondence/route.ts`; `correspondence/[id]/route.ts`; `correspondence/[id]/transmittal-lines/route.ts` |
| **W3-10** | Documents dashboard API (aggregate stats) | `src/app/api/projects/[projectId]/documents-dashboard/route.ts` |

### Group Q — UI Views (3A) — parallel after P
| WO | Name | Files |
|----|------|-------|
| **W3-11** | Drawing register view (S17) | `src/components/views/drawings-view.tsx` |
| **W3-12** | Submittals log view (S18) | `src/components/views/submittals-view.tsx` |
| **W3-13** | RFI log view (S19) | `src/components/views/rfis-view.tsx` |
| **W3-14** | Correspondence view (S20) | `src/components/views/correspondence-view.tsx` |
| **W3-15** | Documents dashboard view (S21) | `src/components/views/documents-dashboard-view.tsx` |

### Group R — DXF Domain Core (3B) — sequential after 3A
| WO | Name | Files | Test |
|----|------|-------|------|
| **W3-16** | DXF parser domain (parse + entity extraction + extents) | `src/domain/drawing/dxf-parser.ts` | GT-DXF-1 |
| **W3-17** | Transform domain (screen↔model, zoom, pan) | `src/domain/drawing/transforms.ts` | GT-DXF-3 |
| **W3-18** | Measurement domain (distance, area, perimeter) | `src/domain/drawing/measurement.ts` | GT-DXF-2 |
| **W3-19** | Layer filter domain + unit parsing | `src/domain/drawing/layers.ts`; `src/domain/drawing/units.ts` | GT-DXF-4, GT-DXF-5 |

### Group S — DXF Viewer UI (3B) — sequential after R
| WO | Name | Files |
|----|------|-------|
| **W3-20** | DXF viewer view (SVG rendering + zoom/pan + layers) | `src/components/views/dxf-viewer-view.tsx` |
| **W3-21** | DXF API route (parse on server, return SVG) | `src/app/api/drawings/[id]/view/route.ts` |
| **W3-22** | Markup overlay (cloud, arrow, text) | `src/components/drawing/markup-overlay.tsx` |

---

## Exit Criteria

1. GT-DC1..GT-DC6 all green (document control law)
2. GT-DXF-1..GT-DXF-5 all green (drawing viewer law)
3. All 5 screens (S17-S21) accessible and functional
4. DXF viewer renders basic entities (LINE, CIRCLE, TEXT, etc.)
5. Measurement tools work (distance, area)
6. Layer visibility toggles work
7. Transmittal builder produces printable PDF (HTML)
8. Domain layer purity maintained (no Date.now() in domain — BR-DC1)
