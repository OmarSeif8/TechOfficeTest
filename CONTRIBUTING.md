# Contributing to TechOffice

Thank you for your interest in contributing to TechOffice! This document outlines our development process, standards, and workflow.

---

## 1. Development Philosophy

TechOffice is built for civil engineers who depend on mathematical accuracy and reliability. Our code prioritizes:
1. **Mathematical correctness over cleverness** (`decimal.js` for financial computations).
2. **Domain layer isolation** (`src/domain/` has zero external dependencies).
3. **Optimistic locking** to prevent lost updates in multi-engineer teams.
4. **Bilingual first-class support** (English and Arabic with RTL).

---

## 2. Setting Up Your Environment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/OmarSeif8/TechOfficeTest.git
   cd TechOfficeTest
   ```
2. **Install dependencies**:
   ```bash
   npm install
   # or: bun install
   ```
3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Provide valid Supabase connection strings (`DATABASE_URL`, `DIRECT_URL`) and `NEXTAUTH_SECRET`.
4. **Seed reference data**:
   ```bash
   npx prisma db push
   npx tsx prisma/seed.ts
   ```
5. **Start dev server**:
   ```bash
   npm run dev
   ```

---

## 3. Git Workflow & Branching Strategy

* **`main`**: Production-ready code. Direct pushes are protected.
* **`feat/<feature-name>`**: New features.
* **`fix/<bug-name>`**: Bug fixes and patches.
* **`debug/<investigation-name>`**: Experimental spikes or diagnostic investigations.

### Making Changes
1. Create a descriptive branch:
   ```bash
   git switch -c feat/boq-inline-calculations
   ```
2. Make your commits adhering to [Conventional Commits](https://www.conventionalcommits.org/):
   * `feat: add formula evaluation to BoQ items`
   * `fix: correct negative lag calculation in CPM engine`
   * `test: add golden test for circular dependency rejection`
   * `docs: update API reference for scheduling endpoints`

---

## 4. Code Standards & Quality Gates

Before opening a Pull Request, you must verify all 4 quality gates pass:

```bash
# 1. Typecheck
npm run typecheck

# 2. Domain purity compilation check
npm run test:domain

# 3. Unit and golden test suites
npm test

# 4. ESLint checks
npm run lint
```

---

## 5. Adding New Features: Step-by-Step

When adding a new capability, follow our Hexagonal architecture flow:

1. **Domain Logic (`src/domain/`)**:
   Implement pure mathematical functions and algorithms. Add corresponding golden tests in `tests/golden/`.
2. **Repository Contract (`src/domain/repositories/`)**:
   Define the repository interface and data transfer options.
3. **Persistence Implementation (`src/infrastructure/persistence/prisma/`)**:
   Implement the interface using Prisma. Use `mode: 'insensitive'` for text searches and `version` checks for mutations.
4. **Registry Registration (`src/infrastructure/registry.ts`)**:
   Wire the repository into the dependency injection container.
5. **API Route Handler (`src/app/api/`)**:
   Create the route using `withErrorHandler`, `requireUserId()`, and Zod request validation.
6. **Frontend Component & Store (`src/components/`, `src/lib/`)**:
   Integrate with Zustand store and TanStack React Query.

---

## 6. Pull Request Checklist

When submitting a PR:
* [ ] Does the domain layer compile without external imports? (`npm run test:domain`)
* [ ] Are all golden tests intact and passing? (`npm run test:golden`)
* [ ] Are mutations protected with `expectedVersion` and audit logging?
* [ ] Are Arabic/English bilingual strings supported where applicable?
* [ ] Did you update documentation or schemas if new endpoints were added?
