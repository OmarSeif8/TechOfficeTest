# TechOffice Database & Persistence Guide

## 1. Overview

TechOffice uses **Prisma ORM** backed by **Supabase PostgreSQL**. The schema enforces strict audit trails, bilingual data models (English and Arabic), soft-delete semantics, and optimistic locking across all primary business entities.

---

## 2. Datasource & Connection Pooling

### Connection String Setup
In production and local environments connecting to Supabase:
* `DATABASE_URL`: Session/Transaction connection pooler (port `6543`) with `pgbouncer=true`.
* `DIRECT_URL`: Direct PostgreSQL connection (port `5432`) used for schema migrations and introspection.

```env
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-[REGION].pooler.supabase.com:5432/postgres"
```

### Auto-Sanitization (`src/lib/db.ts`)
The database connection client includes automated URL sanitation:
1. Rewrites legacy `aws-0` cluster hostnames to `aws-1` for applicable AWS regions.
2. Strips accidental square brackets in passwords (e.g. `[mypassword]` $\rightarrow$ `mypassword`).
3. Automatically URL-encodes special characters in passwords (such as `@` $\rightarrow$ `%40`).

---

## 3. Core Database Entities

### 3.1 Authentication & Tenancy
* **`User`**: System user with `role` (`ADMIN`, `ENGINEER`, `VIEWER`), email, hashed password, and relation to owned projects.
* **`CompanyProfile`**: Organization branding, tax registration numbers, and currency settings.
* **`UserSettings`**: Per-user preferences (active theme, default language `en`/`ar`, notification flags).

### 3.2 Projects & Bill of Quantities
* **`Project`**: Root engineering project entity (`code`, `nameEn`, `nameAr`, `clientEn`, `clientAr`, `status`, `version`, `deletedAt`).
* **`BoQDocument`**: Bill of Quantities document container (`projectId`, `titleEn`, `titleAr`, `version`).
* **`BoQSection`**: Hierarchical grouping of items within a document (hierarchical code, title, sort order).
* **`BoQItem`**: Individual line item (`itemNo`, `descriptionEn`, `descriptionAr`, `unit`, `quantity`, `unitRate`, `totalAmount`).
* **`RateAnalysis`**: Detailed cost breakdown (`materialCost`, `laborCost`, `equipmentCost`, `subcontractorCost`, `overheadPercent`, `profitPercent`).

### 3.3 Reference Catalog & Takeoff
* **`Unit` & `UnitAlias`**: Master measurement units (`m`, `m2`, `m3`, `ton`, `kg`, etc.) and fuzzy synonym mapping.
* **`ItemLibrary` & `LibraryCategory`**: Standardized item repository with global (`APP_GLOBAL`) and private (`USER_PRIVATE`) scopes.
* **`RebarDiameter` & `ShapeCode`**: Structural reinforcement definitions for bar bending schedules.
* **`CalculationRecord`**: Saved takeoff runs linked to BoQ items.

### 3.4 CPM Scheduling
* **`WbsNode`**: Work Breakdown Structure hierarchy.
* **`Activity`**: CPM activity with planned/actual dates, durations, early/late dates, and float values.
* **`ActivityRelationship`**: Predecessor/successor links with dependency types (`FS`, `SS`, `FF`, `SF`) and lag.

### 3.5 Governance & Audit
* **`AuditLog`**: Append-only compliance log recording `actorUserId`, `action`, `entityType`, `entityId`, `beforeJson`, `afterJson`, and `createdAt`.

---

## 4. Key Schema Conventions

1. **Primary Keys**: `String @id @default(cuid())` — collision-resistant and chronologically sortable.
2. **Numeric Precision**: Stored as strings or validated decimals, calculated with `decimal.js` at runtime.
3. **Optimistic Locking**: Every editable entity contains `version Int @default(1)`. Updates increment this value atomically.
4. **Soft Deletion**: `deletedAt DateTime?`. Soft-delete cascades to child items within a single database transaction.
5. **Case-Insensitive Searching**: For text searching on PostgreSQL, always pass `mode: 'insensitive'` to Prisma `contains` filters:
   ```ts
   where: {
     OR: [
       { nameEn: { contains: query, mode: 'insensitive' } },
       { nameAr: { contains: query, mode: 'insensitive' } },
     ]
   }
   ```

---

## 5. Seed Data & Migrations

### Running Migrations
To push schema changes to the remote database:
```bash
npx prisma db push
```

### Seeding Reference Data
To populate the database with required reference tables (Units, Categories, and Item Library):
```bash
npx tsx prisma/seed.ts
```
*(The seed script is idempotent; re-running it will update existing entries without creating duplicate rows)*.
