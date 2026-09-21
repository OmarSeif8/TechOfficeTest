# TechOffice Development Workflow & Recipe Book

This guide provides concrete, copy-paste recipes for common engineering tasks in the TechOffice codebase for both human engineers and AI coding agents.

---

## Recipe 1: Adding a New Takeoff Calculator

Takeoff calculators compute civil quantities (volumes, areas, rebar lengths) from raw geometric parameters.

### Step 1: Write Domain Calculation Function
Create or add to `src/domain/boq/calculators/`:
```ts
// src/domain/boq/calculators/retaining-wall.ts
import Decimal from "decimal.js";

export interface RetainingWallInput {
  lengthMeters: number;
  heightMeters: number;
  stemThicknessMeters: number;
  baseWidthMeters: number;
  baseThicknessMeters: number;
}

export interface RetainingWallOutput {
  concreteVolumeM3: string;
  formworkAreaM2: string;
}

export function calculateRetainingWall(input: RetainingWallInput): RetainingWallOutput {
  const length = new Decimal(input.lengthMeters);
  const height = new Decimal(input.heightMeters);
  const stemThick = new Decimal(input.stemThicknessMeters);
  const baseWidth = new Decimal(input.baseWidthMeters);
  const baseThick = new Decimal(input.baseThicknessMeters);

  // Volume = (Stem + Base) * Length
  const stemVol = stemThick.mul(height.minus(baseThick)).mul(length);
  const baseVol = baseWidth.mul(baseThick).mul(length);
  const totalVol = stemVol.plus(baseVol);

  // Formwork area calculation
  const formwork = height.mul(2).mul(length);

  return {
    concreteVolumeM3: totalVol.toFixed(3),
    formworkAreaM2: formwork.toFixed(2),
  };
}
```

### Step 2: Add Hand-Computed Golden Test
In `tests/golden/gt-calc-retaining-wall.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { calculateRetainingWall } from "@/domain/boq/calculators/retaining-wall";

describe("Retaining Wall Takeoff (Golden Benchmark)", () => {
  it("calculates exact concrete volume and formwork for 10m wall", () => {
    const result = calculateRetainingWall({
      lengthMeters: 10,
      heightMeters: 3,
      stemThicknessMeters: 0.3,
      baseWidthMeters: 2,
      baseThicknessMeters: 0.4,
    });

    // Hand calculation:
    // Stem = 0.3 * (3.0 - 0.4) * 10 = 7.800 m3
    // Base = 2.0 * 0.4 * 10 = 8.000 m3
    // Total = 15.800 m3
    expect(result.concreteVolumeM3).toBe("15.800");
    expect(result.formworkAreaM2).toBe("60.00");
  });
});
```

### Step 3: Verify Domain Isolation
```bash
npm run test:domain
npm test tests/golden/gt-calc-retaining-wall.test.ts
```

---

## Recipe 2: Adding a New API Endpoint with Optimistic Concurrency

All mutating endpoints must adhere to **BR-WEB-4 (Optimistic Locking)** and **BR-WEB-8 (Audit Logging)**.

```ts
// src/app/api/custom-resource/[id]/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  withErrorHandler,
  json,
  notFound,
  conflict,
  writeAuditLog,
} from "@/lib/api-helpers";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";

const UpdateSchema = z.object({
  titleEn: z.string().min(1),
  titleAr: z.string().optional(),
  expectedVersion: z.number().int().positive(),
});

export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateSchema.parse(body);

    // 1. Fetch current record
    const existing = await db.customResource.findUnique({
      where: { id, deletedAt: null },
    });

    if (!existing || existing.ownerId !== userId) {
      return notFound(); // Prevent existence leak
    }

    // 2. Check optimistic lock
    if (existing.version !== parsed.expectedVersion) {
      return conflict({ currentVersion: existing.version });
    }

    // 3. Atomically update and increment version
    const updated = await db.customResource.update({
      where: { id, version: parsed.expectedVersion },
      data: {
        titleEn: parsed.titleEn,
        titleAr: parsed.titleAr,
        version: { increment: 1 },
      },
    });

    // 4. Record audit log
    await writeAuditLog({
      action: "customResource.update",
      entityType: "CustomResource",
      entityId: id,
      beforeJson: existing,
      afterJson: updated,
    });

    return json(updated);
  }
);
```

---

## Recipe 3: Synchronizing Graphify Knowledge Graph

Whenever you modify, add, or refactor files:
```powershell
graphify update .
```
This re-analyzes AST tokens across TypeScript, JSON, and Markdown files without contacting an external LLM.

To inspect the generated architectural report:
```powershell
# In terminal
graphify query "Where is RetainingWall calculated?"

# Or view in browser
Start-Process graphify-out/graph.html
```
