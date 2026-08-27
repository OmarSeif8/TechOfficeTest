# ENTITY-RELATIONSHIP DESIGN — v1.1 (Web Adaptation)

**Document**: `docs/planning/ERD_V1.1_WEB.md`
**Product**: TechOffice (working title)
**Status**: Phase 0 artifact, v1.1 (Web Adaptation)
**Governing docs**: `CONSTITUTION_V1.1_WEB.md`, `SPEC_PHASE1_BOQ_WEB.md`
**Source**: Turn 20 of the imported GLM 5.2 conversation (`docs/imported/full-conversation.md`).

> **How to read this document**: v1.0 specified SQLite table DDL for an Electron app (App DB + .toproj Project DB). v1.1 translates the same logical schema into **Prisma models** for a Next.js web app with a single database. **All Phase 1 (BoQ) tables are preserved exactly** — only their physical representation changes (SQLite DDL → Prisma schema). Phase 2-4 tables are reserved additive (concrete enough to prove they fit, finalized in their phase spec).

---

## 1. Storage Architecture

> ▶▶ **AMENDMENT vs v1.0**: v1.0 had two databases — App DB (`app.db`) for global libraries/settings, and Project DB (`.toproj` file) per project. v1.1 has **one Prisma-managed database** with `userId` / `projectId` discriminators on every table. Logical separation is preserved; physical separation is not.

### v1.1 Storage Model

```mermaid
graph TB
    subgraph "Single Prisma DB (SQLite dev → Postgres prod)"
        subgraph "App-level (per-user, no project FK)"
            User["User"]
            Session["Session"]
            UserSettings["UserSettings"]
            CompanyProfile["CompanyProfile"]
            FileUpload["FileUpload"]
            AuditLog["AuditLog"]
            Subscription["Subscription (Phase 5)"]
            Library["ItemLibrary · LibraryCategory"]
            MasterRef["Unit · UnitAlias · RebarDiameter · ShapeCode (master)"]
        end

        subgraph "Project-scoped (projectId FK)"
            Project["Project"]
            ProjectSnapshot["ProjectSnapshot"]
            ProjectRef["ProjectUnit · ProjectRebarDiameter · ProjectShapeCode (frozen snapshots)"]
            BoQDoc["BoQDocument"]
            BoQSec["BoQSection"]
            BoQItem["BoQItem"]
            RateAnalysis["RateAnalysis · RateAnalysisLine"]
            CalcRec["CalculationRecord"]
            ImportBatch["ImportBatch"]
        end

        subgraph "Future: Phase 2-4 (additive, reserved)"
            Planning["WbsNode · Activity · ActivityRelationship · ScheduleRun · ActivityDate · ActivityBoQLink (P2)"]
            Docs["Drawing · DrawingRevision · Submittal · RFI · Correspondence · TransmittalLine (P3)"]
            Payments["PaymentApplication · PaymentLine · PaymentDeduction · Variation · DailyReport · DailyReportManpower · DailyReportEquipment · DailyReportWork · ActivityProgress (P4)"]
        end
    end

    User -- "1:N" Project
    User -- "1:N" Library
    User -- "1:N" FileUpload
    User -- "1:N" AuditLog
    Project -- "1:N" BoQDoc
    BoQDoc -- "1:N" BoQSec
    BoQSec -- "1:N" BoQItem
    BoQItem -- "1:1 RateAnalysis" RateAnalysis
    RateAnalysis -- "1:N" RateAnalysisLine
    BoQItem -- "0:N" CalcRec
    BoQItem -- "0:N" ImportBatch
```

### Why snapshots inside every project (unchanged from v1.0 rationale)

A project opened on a different user's machine, or after the global library has been edited, must produce identical documents. Reference data (Units, RebarDiameter, ShapeCode) is **copied into project-scoped snapshot tables** at project creation (`ProjectUnit`, `ProjectRebarDiameter`, `ProjectShapeCode`); projects never reference the global master. Cross-table foreign keys to the master are forbidden; project rows reference the project-scoped snapshots.

### File format & save model (v1.1 mechanism)

- **Atomic saves**: Prisma `$transaction` — multi-row writes are all-or-nothing at the DB level.
- **Debounced autosave**: 2 s debounce on client; PATCH with full row on commit.
- **Conflict detection**: `version: Int` column on every updatable aggregate; PATCH WHERE clause includes `version: expectedVersion`. 0 rows updated → 409 Conflict.
- **Snapshots**: `ProjectSnapshot` table stores serialized project state (JSON of all rows) + referenced `FileUpload` IDs. Created on interval, before imports, before destructive ops.
- **Attachments**: `FileUpload` table — file blob on disk (or S3-compatible in prod) + metadata in DB. SHA-256 + original filename + MIME type tracked.

---

## 2. Global Conventions (apply to every model)

| Convention | v1.0 (SQLite DDL) | v1.1 (Prisma schema) |
|------------|--------------------|----------------------|
| Primary key | `id` UUID v7 TEXT (time-ordered) | `id String @id @default(cuid())` (CUID is time-ordered; UUID v7 acceptable alternative via `@default(uuid(7))`) |
| Audit columns | `created_at`, `updated_at` TEXT ISO-8601; `deleted_at` nullable | `createdAt DateTime @default(now())`; `updatedAt DateTime @updatedAt`; `deletedAt DateTime?` (soft delete) |
| Money & quantities | TEXT storing decimal strings, validated by zod | `String` (decimal as string); validated by zod in `src/shared/schemas/` |
| Booleans | INTEGER 0/1 | `Boolean @default(false)` |
| Enums | TEXT + CHECK constraint + zod enum | Prisma `enum` (for SQLite: stored as String + zod validation in app layer) |
| Bilingual | `name_en` / `name_ar` pair (never concatenated) | `nameEn String` / `nameAr String?` (Ar optional where Phase 1 spec allows, required where spec demands) |
| Foreign keys | `PRAGMA foreign_keys = ON`; cascades declared | Prisma `relation` + `onDelete: Cascade` / `SetNull` per relationship |
| One zod schema per table | in `src/shared/schemas/<domain>/<table>.ts` | **Unchanged** — zod is the source of truth; Prisma schema mirrors it |
| Schema evolution | `PRAGMA user_version` + ordered migrations | `prisma migrate dev` (Prisma Migrate); migrations are additive-only (Phase 1 tables never get rewritten) |
| Soft delete | `deleted_at` nullable | `deletedAt DateTime?`; queries use `WHERE deletedAt IS NULL` (Prisma middleware enforces) |

---

## 3. Phase 1 Models — App-Level (per-user, no Project FK)

### 3.1 User & Auth

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  emailVerified   DateTime?
  passwordHash    String?  // null if OAuth-only
  name            String?
  image           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  sessions        Session[]
  userSettings    UserSettings?
  companyProfile  CompanyProfile?
  projects        Project[]
  libraryItems    ItemLibrary[]
  fileUploads     FileUpload[]
  auditLogs       AuditLog[]

  @@index([email])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

> **Notes**: This is the standard NextAuth (Auth.js v4) schema. `emailVerified` and `VerificationToken` support email-verify flows. OAuth accounts table omitted in Phase 1 (Phase 5 addition if Google OAuth is added).

### 3.2 User Settings, Company Profile, Subscription

```prisma
model UserSettings {
  id                String   @id @default(cuid())
  userId            String   @unique
  locale            String   @default("en")    // "en" | "ar"
  theme             String   @default("light")  // "light" | "dark" | "system"
  autosaveIntervalMs Int     @default(2000)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model CompanyProfile {
  id           String   @id @default(cuid())
  userId       String   @unique
  nameEn       String
  nameAr       String?
  address      String?
  phone        String?
  email        String?
  logoFileId   String?  // → FileUpload.id
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  logoFile     FileUpload? @relation("CompanyLogo", fields: [logoFileId], references: [id])
}

model Subscription {
  id              String   @id @default(cuid())
  userId          String   @unique
  plan            String   @default("free")  // "free" | "pro" | "enterprise" — Phase 5 tiers
  status          String   @default("active")  // "active" | "past_due" | "canceled"
  stripeCustomerId String?  // Phase 5: merchant of record
  currentPeriodEnd DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 3.3 File Uploads (attachments — logos, future drawings, etc.)

```prisma
model FileUpload {
  id              String   @id @default(cuid())
  userId          String   // owner
  storageKey      String   // path in blob storage (e.g., "uploads/{userId}/{sha256}.bin")
  originalFilename String
  mimeType        String   // validated against allowlist
  sizeBytes       Int      // checked against per-type limit
  sha256          String   // computed server-side
  createdAt       DateTime @default(now())
  deletedAt       DateTime?

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyProfileLogo CompanyProfile? @relation("CompanyLogo")

  @@index([userId, createdAt])
  @@index([sha256])
}
```

### 3.4 Audit Log

```prisma
model AuditLog {
  id          String   @id @default(cuid())
  userId      String
  action      String   // "create" | "update" | "delete" | "restore" | "import" | "export"
  entityType  String   // "Project" | "BoQDocument" | "BoQItem" | ...
  entityId    String
  beforeData  String?  // JSON
  afterData   String?  // JSON
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([entityType, entityId])
}
```

---

## 4. Phase 1 Models — Reference Tables (master copies, app-level)

> These are the **master** copies. At project creation, snapshots are copied into project-scoped tables (§5.1 below).

```prisma
model Unit {
  id                String  @id @default(cuid())
  code              String  @unique  // "m3" | "m2" | "m" | "kg" | "ton" | "no" | "ls" | "hr" | "day"
  kind              String  // "volume" | "area" | "length" | "mass" | "count" | "time" | "lump"
  enAbbr            String
  arAbbr            String
  defaultPrecision  Int     // decimal places per BR-6
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  aliases           UnitAlias[]
  projectSnapshots  ProjectUnit[]
}

model UnitAlias {
  id        String  @id @default(cuid())
  alias     String  @unique  // case-insensitive match in app layer
  unitId    String
  createdAt DateTime @default(now())

  unit      Unit    @relation(fields: [unitId], references: [id], onDelete: Cascade)
}

model RebarDiameter {
  diameterMm  Int      @id   // 6, 8, 10, ..., 40
  unitWeight  String         // kg/m as decimal string (BR-11 values)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  projectSnapshots  ProjectRebarDiameter[]
}

model ShapeCode {
  code          String  @id   // "00" | "01" | "11" | "21" | "31" | "41" | "51" | "99"
  descriptionEn String
  descriptionAr String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  projectSnapshots  ProjectShapeCode[]
}
```

---

## 5. Phase 1 Models — Project-Scoped

### 5.1 Project + Project-scoped snapshots

```prisma
model Project {
  id                    String   @id @default(cuid())
  userId                String   // owner
  projectUuid           String   @unique  // for snapshot folders & provenance
  name                  String
  clientName            String?
  location              String?
  contractNo            String?
  currency              String   @default("EGP")  // ISO 4217
  vatEnabled            Boolean  @default(false)
  vatPercent            String   @default("0")    // decimal string
  numberingPattern      String   @default("S.n")   // BR-7
  overheadPercentDefault String  @default("10")    // feeds S5 defaults
  profitPercentDefault  String   @default("15")
  precisionOverrides    String?  // JSON: per-unit precision overrides per BR-6
  languagePref          String   @default("en")
  appVersionCreated     String
  version               Int      @default(1)  // optimistic concurrency
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?

  user                  User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  boqDocuments          BoQDocument[]
  snapshots            ProjectSnapshot[]
  projectUnits          ProjectUnit[]
  projectRebarDiameters ProjectRebarDiameter[]
  projectShapeCodes     ProjectShapeCode[]
  importBatches         ImportBatch[]

  @@index([userId, deletedAt])
}

// Frozen snapshot of units at project creation
model ProjectUnit {
  id                String  @id @default(cuid())
  projectId         String
  code              String
  kind              String
  enAbbr            String
  arAbbr            String
  defaultPrecision  Int

  project           Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, code])
  @@index([projectId])
}

model ProjectRebarDiameter {
  projectId   String
  diameterMm  Int
  unitWeight  String

  project     Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([projectId, diameterMm])
}

model ProjectShapeCode {
  projectId     String
  code          String
  descriptionEn String
  descriptionAr String?

  project       Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([projectId, code])
}

model ProjectSnapshot {
  id          String   @id @default(cuid())
  projectId   String
  reason      String   // "auto" | "manual" | "pre_import" | "pre_migration" | "pre_restore"
  label       String?
  sizeBytes   Int
  payload     String   // JSON of all project rows at snapshot time
  createdAt   DateTime @default(now())

  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
}
```

### 5.2 BoQ Documents → Sections → Items

```prisma
model BoQDocument {
  id          String   @id @default(cuid())
  projectId   String
  nameEn      String
  nameAr      String?
  docType     String   @default("boq")  // "boq" | "variation" | "other" — Phase 4 variations need no migration
  notes       String?
  sortOrder   Int      @default(0)
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  project     Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sections    BoQSection[]

  @@index([projectId, deletedAt])
}

model BoQSection {
  id          String   @id @default(cuid())
  documentId  String
  code        String
  nameEn      String
  nameAr      String?
  sortOrder   Int      @default(0)
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  document    BoQDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  items       BoQItem[]

  @@index([documentId, deletedAt])
}

model BoQItem {
  id               String   @id @default(cuid())
  sectionId        String
  code             String   // BR-7 numbering
  descriptionEn    String
  descriptionAr    String?
  itemType         String   // "rate" | "lump_sum" | "provisional_sum" | "daywork" | "unit_only"
  unitCode         String   // references ProjectUnit.code (no FK — snapshot table)
  qty              String   // decimal string; LS locked to "1" per BR-5 (service-enforced)
  rate             String   // decimal string
  sortOrder        Int      @default(0)
  notes            String?
  sourceLibraryId  String?  // provenance only — not a FK (informational)
  importBatchId    String?  // → ImportBatch.id
  version          Int      @default(1)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deletedAt        DateTime?

  section          BoQSection          @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  rateAnalysis     RateAnalysis?
  calculationRecords CalculationRecord[]
  importBatch      ImportBatch?        @relation(fields: [importBatchId], references: [id])

  @@index([sectionId, deletedAt])
  @@index([importBatchId])
}
```

### 5.3 Rate Analysis (F4)

```prisma
model RateAnalysis {
  id                String   @id @default(cuid())
  boqItemId         String   @unique  // 1:1 with item per spec S5
  name              String
  outputUnitCode    String   // references ProjectUnit.code
  overheadPercent   String   // decimal string
  profitPercent     String
  lastAppliedRate   String?  // shown in S5 for restore
  version           Int      @default(1)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  boqItem           BoQItem            @relation(fields: [boqItemId], references: [id], onDelete: Cascade)
  lines             RateAnalysisLine[]

  @@index([boqItemId])
}

model RateAnalysisLine {
  id                  String   @id @default(cuid())
  analysisId          String
  sortOrder           Int      @default(0)
  lineGroup           String   // "material" | "labor" | "equipment" | "subcontract"
  nameEn              String
  nameAr              String?
  unitCode            String?  // consumption unit (nullable for crew-mode labor)
  consumption         String?  // decimal string
  unitCost            String?  // decimal string
  wastePercent        String?  // materials only (BR-8); default "0"
  crewCostPerDay      String?  // nullable — S5 crew entry mode
  crewOutputPerDay    String?  // nullable — S5 crew entry mode
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  analysis            RateAnalysis @relation(fields: [analysisId], references: [id], onDelete: Cascade)

  @@index([analysisId, sortOrder])
}
```

> **Mode rule** (carried over from v1.0, zod-refined + service-enforced): materials/equipment/subcontract = `consumption + unitCost` (`wastePercent` optional for materials); labor = either consumption-mode OR crew-mode (`crewCostPerDay ÷ crewOutputPerDay`), never both. BR-8..BR-10 compute in domain layer.

### 5.4 Calculation Records (F5 audit trail)

```prisma
model CalculationRecord {
  id                String   @id @default(cuid())
  projectId         String
  calculatorType    String   // "concrete" | "formwork" | "rebar" | "masonry" | "plaster" | "paint"
  name              String
  inputs            String   // JSON: zod schema per calculator type
  resultValue       String   // decimal string
  resultUnitCode    String
  details           String   // JSON: row-by-row breakdown
  linkedBoqItemId   String?  // nullable — orphan-safe per F5
  appliedAt         DateTime?  // BR-13: applying never silently overwrites
  version           Int      @default(1)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  linkedBoqItem     BoQItem?  @relation(fields: [linkedBoqItemId], references: [id], onDelete: SetNull)

  @@index([projectId, createdAt])
  @@index([linkedBoqItemId])
}
```

### 5.5 Import Batches (F7 provenance)

```prisma
model ImportBatch {
  id              String   @id @default(cuid())
  projectId       String
  sourceFilename  String
  sourceSha256    String
  mapping         String   // JSON: column mapping
  rowsTotal       Int
  rowsImported    Int
  importedAt      DateTime @default(now())

  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  boqItems        BoQItem[]

  @@index([projectId, importedAt])
}
```

---

## 6. Phase 1 Models — Item Library (F6, app-level per-user)

```prisma
model LibraryCategory {
  id          String   @id @default(cuid())
  userId      String?  // null = global seed category
  parentId    String?  // self-tree
  nameEn      String
  nameAr      String?
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parent      LibraryCategory?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: SetNull)
  children    LibraryCategory[] @relation("CategoryTree")
  items       ItemLibrary[]

  @@index([parentId])
}

model ItemLibrary {
  id            String   @id @default(cuid())
  userId        String?  // null = global seed; non-null = user-saved
  categoryId    String?
  descriptionEn String
  descriptionAr String?
  unitCode      String   // references master Unit.code (library is app-level, no project snapshot needed)
  specNotes     String?
  defaultRate   String?  // decimal string; null = blank per F6 seed spec
  source        String   @default("seed")  // "seed" | "user"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  user          User?            @relation(fields: [userId], references: [id], onDelete: Cascade)
  category      LibraryCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([userId, deletedAt])
  @@index([categoryId])
}
```

---

## 7. Phase 2-4 Models — Reserved Additive (concrete shape, finalized in their phase spec)

> These are reserved now so the schema never gets rewritten. Phase 1 tables are untouched by any of them.

### 7.1 Planning (Phase 2)

```prisma
// WBS tree
model WbsNode {
  id          String   @id @default(cuid())
  projectId   String
  parentId    String?
  code        String
  nameEn      String
  nameAr      String?
  sortOrder   Int      @default(0)
  // ... (relation fields)
}

// CPM entities per SPEC_PHASE2A_CPM.md (turn 28)
model Activity {
  id              String   @id @default(cuid())
  projectId       String
  wbsNodeId       String?
  code            String
  nameEn          String
  nameAr          String?
  type            String   // "task" | "milestone"
  durationDays    Int
  calendarId      String?
  percentComplete String   @default("0")
  status          String   @default("not_started")
  notes           String?
  // ...
}

model ActivityRelationship {
  id            String   @id @default(cuid())
  predecessorId String
  successorId   String
  relType       String   // "FS" | "SS" | "FF" | "SF"
  lagDays       Int      // negative allowed per BR-P4
}

model ScheduleRun {
  id         String   @id @default(cuid())
  projectId  String
  dataDate   DateTime
  isBaseline Boolean  @default(false)
  createdAt  DateTime @default(now())
}

model ActivityDate {
  // CPM cache; engine output, never hand-edited per SPEC 2A
  runId             String
  activityId        String
  earlyStart        DateTime
  earlyFinish       DateTime
  lateStart         DateTime
  lateFinish        DateTime
  totalFloatDays    Int
  isCritical        Boolean

  @@id([runId, activityId])
}

model ActivityBoQLink {
  // ★ the differentiator: cost-schedule integration
  activityId      String
  boqItemId       String
  allocationPercent String

  @@id([activityId, boqItemId])
}

model Calendar {
  id          String   @id @default(cuid())
  projectId   String
  name        String
  workdayMask Int      // bitmask, Sun=1...Sat=64
  isDefault   Boolean  @default(false)
}

model CalendarException {
  id          String   @id @default(cuid())
  calendarId  String
  date        DateTime
  isWorking   Boolean
  name        String?
}
```

### 7.2 Documents (Phase 3)

```prisma
model Drawing {
  id              String   @id @default(cuid())
  projectId       String
  code            String
  titleEn         String
  titleAr         String?
  discipline      String
  currentRevision String?
  // ...
}

model DrawingRevision {
  id              String   @id @default(cuid())
  drawingId       String
  revNo           Int
  date            DateTime
  description     String?
  status          String
  fileUploadId    String?  // → FileUpload.id (DXF/DWG-converted)
  sourceFormat    String   // "dxf" | "dwg-converted"
  originalFilename String?
}

model Submittal { /* id, ref_no, type, subject_en/ar, discipline, dates, status, reviewer, notes */ }
model SubmittalEvent { /* submittal_id, date, status, note */ }
model RFI { /* id, ref_no, subject_en/ar, discipline, dates, status, question, answer */ }
model Correspondence { /* id, direction, ref_no, date, type, subject_en/ar, from, to, body */ }
model TransmittalLine { /* correspondence_id, doc_ref, description, copies */ }
```

### 7.3 Payments (Phase 4) — per SPEC_PHASE4A_PAYMENTS.md (turn 30)

```prisma
model PaymentApplication {
  id                String   @id @default(cuid())
  projectId         String
  ipcNo             Int
  periodStart       DateTime
  periodEnd         DateTime
  submissionDate    DateTime
  retentionPercent  String
  advanceAmount     String   @default("0")
  previousCertified String   @default("0")
  status            String   @default("draft")  // "draft" | "submitted" | "certified" | "rejected"
  // ...
}

model PaymentLine {
  id              String   @id @default(cuid())
  applicationId   String
  boqItemId      String
  qtyThisPeriod   String
  qtyCumulative   String
  amountThisPeriod String
  amountCumulative String
}

model PaymentDeduction {
  id           String   @id @default(cuid())
  applicationId String
  kind         String   // "penalty" | "backcharge" | "other"
  description  String
  amount       String
}

model Variation {
  id                  String   @id @default(cuid())
  projectId           String
  refNo               String
  title               String
  boqDocumentId       String?  // → BoQDocument with docType="variation"
  status              String   @default("draft")  // "draft" | "submitted" | "approved" | "rejected"
  linkedApplicationId String?
}

model DailyReport {
  id    String   @id @default(cuid())
  projectId String
  date  DateTime
  weather String?
  temperature String?
  notes String?
}

model DailyReportManpower { /* report_id, trade, count */ }
model DailyReportEquipment { /* report_id, equipment, count, hours */ }
model DailyReportWork { /* report_id, location, description_en/ar, activity_id? */ }
model ActivityProgress { /* activity_id, schedule_run_id, percent_complete, actual_start, actual_finish */ }
```

---

## 8. Seed Data (v1.1 ships with)

> **Unchanged from v1.0 (turn 30 APPENDIX_SEED_DATA)**. Implementation: Prisma `seed.ts` script inserts these on first run.

### 8.1 Rebar diameter table (kg/m) — complete

Ø6→0.222 · Ø8→0.395 · Ø10→0.617 · Ø12→0.888 · Ø16→1.578 · Ø18→2.000 · Ø20→2.466 · Ø22→2.984 · Ø25→3.854 · Ø28→4.834 · Ø32→6.313 · Ø36→7.991 · Ø40→9.865

### 8.2 Unit alias table — complete

| UNIT | ALIASES |
|------|---------|
| m³ | `m3 m³ M3 m^3 م3 م٣ متر مكعب` |
| m² | `m2 m² M2 م2 م٢ متر مربع` |
| m | `m M م متر lm mtr` |
| kg | `kg KG كجم كيلوجرام kgm` |
| ton | `ton Ton TON طن t` |
| no. | `no No NO nos No. ea EA each عدد` |
| LS | `ls LS L.S lump sum مقطوعية` |
| hr | `hr hour hrs ساعة` |
| day | `day days يوم أيام` |

### 8.3 Shape codes (BS 8666 subset)

Seed with: 00 straight · 01 stock length · 11 single-bend (L) · 21 U-bar/stirrup · 31 offset/two-bend · 41 U with end hooks · 51 cranked · 99 special.

> ⚠️ Agent must verify descriptions against BS 8666:2020 during WO-W-12 before seeding. Pilot engineer reviews the final table.

### 8.4 Library taxonomy (10 categories)

Earthworks · Concrete · Formwork · Reinforcement · Masonry · Plastering · Painting · Flooring & Tiling · Waterproofing & Insulation · Miscellaneous

### 8.5 Starter items (~150, seeded verbatim from turn 30 APPENDIX_SEED_DATA)

The full 23-item starter table from turn 30 is reproduced in `docs/imported/full-conversation.md` (turn 30, section E) and will be the seed source for WO-W-12. Agent extends to ~150 within the taxonomy per the content rules in turn 30.

---

## 9. Traceability

| Golden Test | Tables touched | Business rules exercised |
|-------------|-----------------|---------------------------|
| GT-1 (BoQ totals) | `BoQItem`, `BoQSection`, `BoQDocument`, `Project` | BR-2, BR-3, BR-4 |
| GT-2 (rate analysis) | `RateAnalysis`, `RateAnalysisLine`, `BoQItem` | BR-8, BR-9, BR-10 |
| GT-3 (concrete) | `CalculationRecord` (calculatorType="concrete") | (calculator formulas) |
| GT-4 (formwork) | `CalculationRecord` (calculatorType="formwork") | (calculator formulas) |
| GT-5 (rebar) | `CalculationRecord` (calculatorType="rebar"), `RebarDiameter` | BR-11, BR-12 |
| GT-6 (masonry) | `CalculationRecord` (calculatorType="masonry") | (calculator formulas) |
| GT-7 (plaster) | `CalculationRecord` (calculatorType="plaster") | (calculator formulas) |
| GT-8 (paint) | `CalculationRecord` (calculatorType="paint") | (calculator formulas) |

> Zod schema ↔ Prisma model naming is mechanical (`src/shared/schemas/boq/boq-item.ts` ↔ `BoQItem` model) — this is how AI sessions find the right schema without guessing. A round-trip test per table (fixture → zod parse → Prisma create → Prisma findUnique → zod parse) verifies they never drift.

---

## 10. v1.1 vs v1.0 Diff Summary

| Area | v1.0 (Electron) | v1.1 (Next.js web) |
|------|------------------|---------------------|
| Database count | 2 (app.db + .toproj per project) | 1 (Prisma-managed) |
| Project portability | One `.toproj` file per project | DB rows; future export-archive feature |
| Auth | None (single-user desktop) | NextAuth: User, Session, VerificationToken |
| Per-user settings | `app_settings` single-row table in app.db | `UserSettings` table (one row per user) |
| Company profile | `company_profile` single-row in app.db | `CompanyProfile` table (one row per user) |
| Recent projects | `recent_projects` table with file paths | Computed query: `Project WHERE userId=? ORDER BY updatedAt DESC LIMIT 10` |
| License cache | `license_cache` single-row in app.db | `Subscription` table (per user, Phase 5) |
| Reference tables | Master in app.db, snapshot copied per project | Master `Unit`/`RebarDiameter`/`ShapeCode` tables + per-project `ProjectUnit`/`ProjectRebarDiameter`/`ProjectShapeCode` snapshots |
| Library | `library_items` in app.db (global) | `ItemLibrary` table with `userId` discriminator (seed global + user-saved) |
| Attachments | Gzipped BLOBs inside .toproj | `FileUpload` table (blob on disk/S3 + metadata in DB) |
| Audit log | (not in v1.0) | `AuditLog` table — new in v1.1 (web accountability) |
| Snapshot versioning | `<appdata>/snapshots/<project_uuid>/` files | `ProjectSnapshot` table with JSON payload |
| Conflict detection | SHA-256 of .toproj file | `version: Int` column + optimistic concurrency |

**Phase 1 BoQ tables preserved exactly**: `Project`, `BoQDocument`, `BoQSection`, `BoQItem`, `RateAnalysis`, `RateAnalysisLine`, `CalculationRecord`, `ImportBatch` — same fields, same relationships, same business rules. Only their physical representation changed (SQLite DDL → Prisma schema).

**Phase 2-4 tables reserved additive**: All future tables (Planning, Documents, Payments) are listed in §7 with concrete shapes; Phase 1 build creates none of them, but the schema design proves they fit without modifying any Phase 1 table.

---

## 11. Approval & Next Steps

- ✅ v1.0 ERD approved in turn 20 of GLM chat
- ✅ v1.1 (this document) adapts v1.0 for web MVP per user's Path C decision
- ⬜ v1.1 reviewed against `CONSTITUTION_V1.1_WEB.md` §5 (save model matches)
- ⬜ v1.1 reviewed against `SPEC_PHASE1_BOQ_WEB.md` §7 (entity list matches)
- ⬜ v1.1 reviewed against `PLATFORM_PORTABILITY.md` §3 (repository interfaces map to these models)
- ⬜ Prisma schema (`prisma/schema.prisma`) written in WO-W-2 from this document

**End of ERD v1.1 (Web Adaptation).**
