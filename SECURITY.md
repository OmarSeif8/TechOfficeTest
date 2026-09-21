# Security Policy — TechOffice

## 1. Reporting Security Vulnerabilities

We take the security of engineering project data, financial Bill of Quantities records, and contractual correspondence seriously.

If you believe you have discovered a security vulnerability in TechOffice, please **do not open a public issue**. Instead, report it privately to the project maintainers via GitHub Security Advisories or by emailing `security@techoffice.local`.

---

## 2. Security Architecture & Protections

### 2.1 Multi-Tenant Data Isolation
* All project queries and mutations verify that the requesting session (`requireUserId()`) owns the project.
* **Anti-Enumeration**: If a requested project does not belong to the user, the server responds with `404 Not Found` rather than `403 Forbidden`, preventing malicious actors from determining whether specific project IDs exist.

### 2.2 Optimistic Concurrency Control (OCC)
* To prevent lost updates or race conditions when multiple engineers edit the same BoQ or CPM schedule simultaneously, all mutating routes require an `expectedVersion` parameter.
* Out-of-date mutations fail with `409 Conflict`.

### 2.3 Rate Limiting (BR-WEB-10)
* Built-in per-user token bucket rate limiter (`src/lib/api-helpers.ts`).
* Enforces a standard limit of **60 requests per minute** per authenticated user.
* Exceeded limits return `429 Too Many Requests` with a standard `Retry-After` header.

### 2.4 Audit Logging (BR-WEB-8)
* All critical mutating operations (`POST`, `PATCH`, `DELETE`) write an append-only row to the `AuditLog` table.
* Audit entries capture user ID, action, entity identifier, and snapshots of before/after states for compliance and tracking.

### 2.5 Input Sanitization & Validation
* All incoming API request bodies are parsed and strictly validated using **Zod** schemas before reaching domain logic or Prisma queries.
* Database queries are parameterized by Prisma, preventing SQL injection vulnerabilities.
