"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Box,
  Layers,
  Ruler,
  BrickWall,
  PaintRoller,
  Paintbrush,
  Plus,
  Trash2,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import { apiPost } from "@/lib/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Pure domain calculators — imported from src/domain and run client-side
// for the live preview. This is the architecture proof: the same code that
// powers the API also runs in the browser without modification.
import { computeConcrete, type ConcreteResult } from "@domain/calculators/concrete";
import { computeFormwork, type FormworkResult } from "@domain/calculators/formwork";
import { computeRebar, type RebarResult } from "@domain/calculators/rebar";
import { computeMasonry, type MasonryResult } from "@domain/calculators/masonry";
import { computePlaster, type PlasterResult } from "@domain/calculators/plaster";
import { computePaint, type PaintResult } from "@domain/calculators/paint";

// Rebar diameter table — pure shared module, safe to import from client.
import { ALL_REBAR_DIAMETERS } from "@shared/rebar-weights";
import type { CalculatorType } from "@shared/schemas/calculator";

/**
 * CalculatorsView — Calculators hub (S6).
 *
 * WO-W-4e: 6 calculators (concrete, formwork, rebar, masonry, plaster, paint).
 *
 * Architecture:
 *   - The user picks a calculator type from a 3×2 card grid.
 *   - A dynamic input form renders below, specific to the chosen calculator.
 *   - A `useMemo` runs the matching pure domain function on every keystroke,
 *     producing a live result (no API call needed for preview — the domain
 *     code is isomorphic and runs in the browser).
 *   - "Save record" POSTs `{ calculatorType, inputs }` to
 *     `/api/projects/[projectId]/calculations` which re-computes server-side
 *     via the same domain function and persists the audit trail.
 *   - "Apply to BoQ item" is a Phase-1 stub: shows a toast asking the user
 *     to select a BoQ item first (real linking lands in Phase 2 / WO-W-4f).
 */

// ─── Calculator catalog ────────────────────────────────────────────────────

type CalcKey =
  | "concrete"
  | "formwork"
  | "rebar"
  | "masonry"
  | "plaster"
  | "paint";

interface CalculatorDef {
  key: CalcKey;
  type: CalculatorType;
  icon: React.ComponentType<{ className?: string }>;
}

const CALCULATORS: CalculatorDef[] = [
  { key: "concrete", type: "CONCRETE", icon: Box },
  { key: "formwork", type: "FORMWORK", icon: Layers },
  { key: "rebar",    type: "REBAR",    icon: Ruler },
  { key: "masonry",  type: "MASONRY",  icon: BrickWall },
  { key: "plaster",  type: "PLASTER",  icon: PaintRoller },
  { key: "paint",    type: "PAINT",    icon: Paintbrush },
];

// ─── Per-calculator input shapes (all strings — decimal.js friendly) ──────

interface OpeningInput {
  width: string;
  height: string;
}

interface ConcreteInputs {
  length: string;
  width: string;
  height: string;
  count: string;
}
interface FormworkInputs {
  length: string;
  width: string;
  height: string;
  count: string;
  faces: string;
}
interface RebarInputs {
  diameterMm: string; // discrete value from the seeded table; parsed to number for compute
  cuttingLength: string;
  count: string;
}
interface MasonryInputs {
  wallLength: string;
  wallHeight: string;
  wallThickness: string;
  openings: OpeningInput[];
}
interface PlasterInputs {
  wallLength: string;
  wallHeight: string;
  faces: string;
  openings: OpeningInput[];
  deductThreshold: string;
}
interface PaintInputs {
  surfaceArea: string;
  coats: string;
}

// Sensible defaults — match the GT golden test inputs so the very first
// preview the user sees reproduces the spec example.
const DEFAULT_CONCRETE: ConcreteInputs = {
  length: "0.30",
  width: "0.30",
  height: "3.00",
  count: "12",
};
const DEFAULT_FORMWORK: FormworkInputs = {
  length: "0.30",
  width: "0.30",
  height: "3.00",
  count: "12",
  faces: "4",
};
const DEFAULT_REBAR: RebarInputs = {
  diameterMm: "12",
  cuttingLength: "11.25",
  count: "85",
};
const DEFAULT_MASONRY: MasonryInputs = {
  wallLength: "6.00",
  wallHeight: "3.00",
  wallThickness: "0.25",
  openings: [
    { width: "1.20", height: "1.50" },
    { width: "1.20", height: "1.50" },
  ],
};
const DEFAULT_PLASTER: PlasterInputs = {
  wallLength: "20.00",
  wallHeight: "3.00",
  faces: "2",
  openings: [{ width: "2.00", height: "1.50" }],
  deductThreshold: "1",
};
const DEFAULT_PAINT: PaintInputs = {
  surfaceArea: "114.00",
  coats: "2",
};

// ─── View ──────────────────────────────────────────────────────────────────

export function CalculatorsView() {
  const t = useTranslations("calculators");
  const currentProjectId = useUIStore((s) => s.currentProjectId);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const [selectedKey, setSelectedKey] = useState<CalcKey>("concrete");

  if (!currentProjectId) {
    return (
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No project selected. Create or select a project to start computing quantities.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setCurrentView("projects")}
            >
              <Plus className="w-3.5 h-3.5" />
              Go to Projects
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentView("dashboard")}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const current = CALCULATORS.find((c) => c.key === selectedKey)!;

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a calculator, type dimensions, see live results, save the record.
        </p>
      </div>

      {/* Calculator type selector — 3×2 card grid */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CALCULATORS.map((c) => {
          const Icon = c.icon;
          const isActive = c.key === selectedKey;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelectedKey(c.key)}
              className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/30"
              }`}
            >
              <Icon
                className={`w-5 h-5 shrink-0 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div>
                <div className="text-sm font-medium">{t(c.key)}</div>
                <div className="text-xs text-muted-foreground">
                  {c.type.toLowerCase()}
                </div>
              </div>
            </button>
          );
        })}
      </section>

      {/* Active calculator workspace */}
      <CalculatorWorkspace
        calcKey={selectedKey}
        calcType={current.type}
        currentProjectId={currentProjectId}
        t={t}
      />
    </div>
  );
}

// ─── Calculator workspace (form + live result + actions) ──────────────────

interface WorkspaceProps {
  calcKey: CalcKey;
  calcType: CalculatorType;
  currentProjectId: string;
  t: ReturnType<typeof useTranslations>;
}

function CalculatorWorkspace({
  calcKey,
  calcType,
  currentProjectId,
  t,
}: WorkspaceProps) {
  switch (calcKey) {
    case "concrete":
      return (
        <ConcreteCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    case "formwork":
      return (
        <FormworkCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    case "rebar":
      return (
        <RebarCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    case "masonry":
      return (
        <MasonryCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    case "plaster":
      return (
        <PlasterCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    case "paint":
      return (
        <PaintCalculator
          calcType={calcType}
          currentProjectId={currentProjectId}
          t={t}
        />
      );
    default: {
      const _exhaustive: never = calcKey;
      void _exhaustive;
      return null;
    }
  }
}

// ─── Concrete ──────────────────────────────────────────────────────────────

interface ConcreteProps {
  calcType: CalculatorType;
  currentProjectId: string;
  t: ReturnType<typeof useTranslations>;
}

function ConcreteCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<ConcreteInputs>(DEFAULT_CONCRETE);
  const [saving, setSaving] = useState(false);

  const result = useMemo<ConcreteResult | null>(() => {
    try {
      return computeConcrete(inputs);
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label={t("length")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.length}
              onChange={(e) =>
                setInputs((p) => ({ ...p, length: e.target.value }))
              }
            />
          </Field>
          <Field label={t("width")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.width}
              onChange={(e) =>
                setInputs((p) => ({ ...p, width: e.target.value }))
              }
            />
          </Field>
          <Field label={t("height")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.height}
              onChange={(e) =>
                setInputs((p) => ({ ...p, height: e.target.value }))
              }
            />
          </Field>
          <Field label={t("count")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.count}
              onChange={(e) =>
                setInputs((p) => ({ ...p, count: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Total volume"
        headlineValue={result?.totalVolume ?? "—"}
        unit={result?.unit ?? "m3"}
        rows={
          result
            ? [
                { label: "Volume per item", value: result.volumePerItem, unit: "m3" },
                { label: "Total volume",     value: result.totalVolume,   unit: "m3" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs,
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Formwork ──────────────────────────────────────────────────────────────

function FormworkCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<FormworkInputs>(DEFAULT_FORMWORK);
  const [saving, setSaving] = useState(false);

  const result = useMemo<FormworkResult | null>(() => {
    try {
      return computeFormwork(inputs);
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label={t("length")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.length}
              onChange={(e) =>
                setInputs((p) => ({ ...p, length: e.target.value }))
              }
            />
          </Field>
          <Field label={t("width")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.width}
              onChange={(e) =>
                setInputs((p) => ({ ...p, width: e.target.value }))
              }
            />
          </Field>
          <Field label={t("height")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.height}
              onChange={(e) =>
                setInputs((p) => ({ ...p, height: e.target.value }))
              }
            />
          </Field>
          <Field label={t("count")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.count}
              onChange={(e) =>
                setInputs((p) => ({ ...p, count: e.target.value }))
              }
            />
          </Field>
          <Field label="Faces">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.faces}
              onChange={(e) =>
                setInputs((p) => ({ ...p, faces: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Total area"
        headlineValue={result?.totalArea ?? "—"}
        unit={result?.unit ?? "m2"}
        rows={
          result
            ? [
                { label: "Area per item", value: result.areaPerItem, unit: "m2" },
                { label: "Total area",    value: result.totalArea,   unit: "m2" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs,
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Rebar ──────────────────────────────────────────────────────────────────

function RebarCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<RebarInputs>(DEFAULT_REBAR);
  const [saving, setSaving] = useState(false);

  // `diameterMm` and `count` are numbers per the schema; we keep them as
  // strings in the input fields (decimal.js-friendly) and parse here.
  const result = useMemo<RebarResult | null>(() => {
    try {
      const diameterMm = Number(inputs.diameterMm);
      const count = Number(inputs.count);
      if (!Number.isFinite(diameterMm) || !Number.isFinite(count)) return null;
      return computeRebar({
        diameterMm,
        cuttingLength: inputs.cuttingLength,
        count,
      });
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label={t("diameter")}>
            <Select
              value={inputs.diameterMm}
              onValueChange={(v) =>
                setInputs((p) => ({ ...p, diameterMm: v }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Ø mm" />
              </SelectTrigger>
              <SelectContent>
                {ALL_REBAR_DIAMETERS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    Ø{d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cutting length (m)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.cuttingLength}
              onChange={(e) =>
                setInputs((p) => ({ ...p, cuttingLength: e.target.value }))
              }
            />
          </Field>
          <Field label={t("count")}>
            <Input
              type="text"
              inputMode="numeric"
              value={inputs.count}
              onChange={(e) =>
                setInputs((p) => ({ ...p, count: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Total weight"
        headlineValue={result?.totalWeightKg ?? "—"}
        unit={result?.unit ?? "kg"}
        rows={
          result
            ? [
                { label: "Total length",   value: result.totalLength,   unit: "m" },
                { label: "Total weight",   value: result.totalWeightKg, unit: "kg" },
                { label: "Total tonnage",  value: result.totalWeightTon, unit: "ton" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            const diameterMm = Number(inputs.diameterMm);
            const count = Number(inputs.count);
            if (!Number.isFinite(diameterMm) || !Number.isFinite(count)) {
              throw new Error("Invalid diameter or count");
            }
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs: {
                diameterMm,
                cuttingLength: inputs.cuttingLength,
                count,
              },
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Masonry ────────────────────────────────────────────────────────────────

function MasonryCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<MasonryInputs>(DEFAULT_MASONRY);
  const [saving, setSaving] = useState(false);

  const result = useMemo<MasonryResult | null>(() => {
    try {
      return computeMasonry(inputs);
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label="Wall length (m)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.wallLength}
              onChange={(e) =>
                setInputs((p) => ({ ...p, wallLength: e.target.value }))
              }
            />
          </Field>
          <Field label="Wall height (m)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.wallHeight}
              onChange={(e) =>
                setInputs((p) => ({ ...p, wallHeight: e.target.value }))
              }
            />
          </Field>
          <Field label={t("thickness")}>
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.wallThickness}
              onChange={(e) =>
                setInputs((p) => ({ ...p, wallThickness: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>

        <OpeningListEditor
          label="Openings (doors / windows)"
          openings={inputs.openings}
          onChange={(openings) => setInputs((p) => ({ ...p, openings }))}
        />
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Wall volume"
        headlineValue={result?.volume ?? "—"}
        unit={result?.unit ?? "m3"}
        rows={
          result
            ? [
                { label: "Gross area",        value: result.grossArea,     unit: "m2" },
                { label: "Openings area",     value: result.openingsArea, unit: "m2" },
                { label: "Net area",          value: result.netArea,       unit: "m2" },
                { label: "Wall volume",       value: result.volume,        unit: "m3" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs,
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Plaster ───────────────────────────────────────────────────────────────

function PlasterCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<PlasterInputs>(DEFAULT_PLASTER);
  const [saving, setSaving] = useState(false);

  const result = useMemo<PlasterResult | null>(() => {
    try {
      return computePlaster(inputs);
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label="Wall length (m)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.wallLength}
              onChange={(e) =>
                setInputs((p) => ({ ...p, wallLength: e.target.value }))
              }
            />
          </Field>
          <Field label="Wall height (m)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.wallHeight}
              onChange={(e) =>
                setInputs((p) => ({ ...p, wallHeight: e.target.value }))
              }
            />
          </Field>
          <Field label="Faces">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.faces}
              onChange={(e) =>
                setInputs((p) => ({ ...p, faces: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>

        <OpeningListEditor
          label="Openings (doors / windows)"
          openings={inputs.openings}
          onChange={(openings) => setInputs((p) => ({ ...p, openings }))}
        />
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Net plaster area"
        headlineValue={result?.netArea ?? "—"}
        unit={result?.unit ?? "m2"}
        rows={
          result
            ? [
                { label: "Gross area (per face)", value: result.grossArea,       unit: "m2" },
                { label: "Deductions (per face)", value: result.deductionsArea, unit: "m2" },
                { label: "Net area (total)",      value: result.netArea,         unit: "m2" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs,
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Paint ──────────────────────────────────────────────────────────────────

function PaintCalculator({ calcType, currentProjectId, t }: ConcreteProps) {
  const [inputs, setInputs] = useState<PaintInputs>(DEFAULT_PAINT);
  const [saving, setSaving] = useState(false);

  const result = useMemo<PaintResult | null>(() => {
    try {
      const coats = Number(inputs.coats);
      if (!Number.isFinite(coats)) return null;
      return computePaint({ surfaceArea: inputs.surfaceArea, coats });
    } catch {
      return null;
    }
  }, [inputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <FormCard>
        <FieldGrid>
          <Field label="Surface area (m²)">
            <Input
              type="text"
              inputMode="decimal"
              value={inputs.surfaceArea}
              onChange={(e) =>
                setInputs((p) => ({ ...p, surfaceArea: e.target.value }))
              }
            />
          </Field>
          <Field label="Coats">
            <Input
              type="text"
              inputMode="numeric"
              value={inputs.coats}
              onChange={(e) =>
                setInputs((p) => ({ ...p, coats: e.target.value }))
              }
            />
          </Field>
        </FieldGrid>
      </FormCard>

      <ResultPanel
        t={t}
        saving={saving}
        result={result}
        headlineLabel="Total coat area"
        headlineValue={result?.totalCoatArea ?? "—"}
        unit={result?.unit ?? "m2"}
        rows={
          result
            ? [
                { label: "Surface area",   value: result.area,         unit: "m2" },
                { label: "Coats",          value: String(result.coats), unit: "" },
                { label: "Total coat area", value: result.totalCoatArea, unit: "m2" },
              ]
            : []
        }
        onSave={async () => {
          setSaving(true);
          try {
            const coats = Number(inputs.coats);
            if (!Number.isFinite(coats)) {
              throw new Error("Invalid coats value");
            }
            await apiPost(`/api/projects/${currentProjectId}/calculations`, {
              calculatorType: calcType,
              inputs: {
                surfaceArea: inputs.surfaceArea,
                coats,
              },
            });
            toast.success("Calculation saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
          } finally {
            setSaving(false);
          }
        }}
        onApply={() =>
          toast.info("Select a BoQ item first to apply this calculation.")
        }
      />
    </div>
  );
}

// ─── Shared form primitives ───────────────────────────────────────────────

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        Inputs
      </h2>
      {children}
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function OpeningListEditor({
  label,
  openings,
  onChange,
}: {
  label: string;
  openings: OpeningInput[];
  onChange: (openings: OpeningInput[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...openings, { width: "", height: "" }])
          }
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
      </div>
      {openings.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No openings.</p>
      ) : (
        <ul className="space-y-2">
          {openings.map((op, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="W (m)"
                value={op.width}
                onChange={(e) => {
                  const next = [...openings];
                  next[i] = { ...next[i], width: e.target.value };
                  onChange(next);
                }}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs">×</span>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="H (m)"
                value={op.height}
                onChange={(e) => {
                  const next = [...openings];
                  next[i] = { ...next[i], height: e.target.value };
                  onChange(next);
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(openings.filter((_, j) => j !== i))}
                aria-label="Remove opening"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultRow {
  label: string;
  value: string;
  unit: string;
}

interface ResultPanelProps {
  t: ReturnType<typeof useTranslations>;
  saving: boolean;
  result: unknown;
  headlineLabel: string;
  headlineValue: string;
  unit: string;
  rows: ResultRow[];
  onSave: () => Promise<void>;
  onApply: () => void;
}

function ResultPanel({
  t,
  saving,
  result,
  headlineLabel,
  headlineValue,
  unit,
  rows,
  onSave,
  onApply,
}: ResultPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        {t("result")}
      </h2>

      {/* Headline value */}
      <div className="rounded-md bg-muted/40 p-4 border border-border">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {headlineLabel}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight font-mono tabular-nums">
            {headlineValue}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
      </div>

      {/* Detail rows */}
      {rows.length > 0 && (
        <dl className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between border-b border-border/40 last:border-0 py-1"
            >
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-mono tabular-nums">
                {r.value}
                {r.unit ? (
                  <span className="text-muted-foreground text-xs ml-1">
                    {r.unit}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!result && (
        <p className="text-xs text-muted-foreground italic">
          Enter valid numbers to see the live result.
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || !result}
          onClick={onSave}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          {t("saveRecord")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!result}
          onClick={onApply}
        >
          {t("applyToItem")}
        </Button>
      </div>
    </div>
  );
}
