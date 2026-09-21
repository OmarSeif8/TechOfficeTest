# TechOffice API Reference

## 1. Overview & Conventions

All API routes live under `src/app/api/` and adhere to RESTful standards.

### Authentication & Authorization
* Endpoints require an active NextAuth session (`requireUserId()`) unless explicitly public.
* **Ownership Verification**: All project-scoped resources check that the project is owned by the requesting user. If the resource does not exist or belongs to another user, the API responds with `404 Not Found` (preventing ID enumeration or existence leaks).

### Standard Response Codes
* `200 OK`: Request succeeded, returns JSON payload.
* `201 Created`: Resource successfully created.
* `204 No Content`: Successful deletion or mutation with no return body.
* `400 Bad Request`: Zod validation error or invalid payload format.
* `401 Unauthorized`: Missing or invalid session token.
* `404 Not Found`: Entity does not exist or user lacks access.
* `409 Conflict`: Optimistic locking collision (`expectedVersion` mismatch).
* `429 Too Many Requests`: Rate limit exceeded (standard bucket: 60 req/min per user).

---

## 2. Core API Endpoints

### 2.1 Projects

| Method | Endpoint | Description | Query / Body Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/projects` | List projects owned by user | `search`, `limit`, `offset` |
| `POST` | `/api/projects` | Create a new project | Body: `{ code, nameEn, nameAr?, currency? }` |
| `GET` | `/api/projects/[projectId]` | Retrieve project by ID | |
| `PATCH` | `/api/projects/[projectId]` | Update project metadata | Body: `{ nameEn, clientEn, expectedVersion, ... }` |
| `DELETE` | `/api/projects/[projectId]` | Soft-delete project | Body: `{ expectedVersion }` |

### 2.2 Bill of Quantities (BoQ)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/projects/[projectId]/documents` | Fetch BoQ documents for project |
| `POST` | `/api/projects/[projectId]/documents` | Create BoQ document container |
| `GET` | `/api/documents/[id]` | Fetch single document with sections & items |
| `PATCH` | `/api/documents/[id]` | Update document title & metadata |
| `DELETE` | `/api/documents/[id]` | Cascading soft-delete (document + sections + items) |
| `POST` | `/api/documents/[id]/sections` | Create new section within document |
| `PATCH` | `/api/sections/[id]` | Update section title / code with optimistic lock |
| `DELETE` | `/api/sections/[id]` | Cascading soft-delete section & contained items |
| `POST` | `/api/sections/[id]/items` | Add BoQ item to section |
| `PATCH` | `/api/items/[id]` | Update item quantities, rate, or descriptions |
| `DELETE` | `/api/items/[id]` | Soft-delete individual BoQ item |
| `POST` | `/api/items/[id]/move` | Reorder / reparent item between sections |

### 2.3 Rate Analysis & Item Library

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/library` | Search standard item library (`search`, `categoryId`, `scope`) |
| `POST` | `/api/library` | Add custom item to library |
| `GET` | `/api/items/[id]/rate-analysis` | Get unit rate build-up for BoQ item |
| `PUT` | `/api/items/[id]/rate-analysis` | Save/replace rate analysis breakdown |

### 2.4 CPM Scheduling Engine

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/projects/[projectId]/scheduling/current` | Get current schedule network and critical path |
| `POST` | `/api/projects/[projectId]/scheduling/run` | Execute CPM forward/backward passes on schedule |
| `POST` | `/api/activities` | Create project activity |
| `PATCH` | `/api/activities/[id]` | Update activity duration or status |
| `POST` | `/api/activities/[id]/relationships` | Create dependency link between activities |

### 2.5 Calculations & Takeoff

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/projects/[projectId]/calculations` | Save civil engineering takeoff calculation |
| `POST` | `/api/calculations/[id]/link` | Link takeoff calculation result to a BoQ item |

### 2.6 Document Control & DXF

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/drawings` | List CAD drawings and revision logs |
| `POST` | `/api/file-uploads` | Upload DXF file or project attachments |
| `GET` | `/api/rfis` | Search Request for Information (RFI) records |
| `POST` | `/api/transmittals` | Compile formal document transmittal package |

---

## 3. Optimistic Concurrency Example

When updating any resource, provide the `expectedVersion`:

```json
// PATCH /api/sections/cm12345
{
  "titleEn": "Substructure Works",
  "expectedVersion": 2
}
```

If the record on the server is currently at version `2`, it will successfully update and increment `version` to `3`. If the server is already at `version 3`, the API responds with:

```json
// Status: 409 Conflict
{
  "code": "CONFLICT",
  "message": "Resource has been modified by another user. Please refresh and try again.",
  "currentVersion": 3
}
```
