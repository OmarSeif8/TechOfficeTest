/**
 * Drawing Layers — pure layer visibility filter (BR-DW3).
 *
 * Per CONSTITUTION_V1.1_WEB §3.3 — this file is isomorphic:
 *   - Imports only @shared/* (pure TypeScript, no platform code).
 *   - MUST NOT import next, react, prisma, fs, path, electron, etc.
 *
 * The viewer keeps a `Set<string>` of visible layer names (driven by the
 * layers-panel checkboxes in the UI). On every state change, this filter
 * is called to produce the visible subset of entities. The renderer then
 * draws only those — the SVG is regenerated on each toggle (cheap: < 1ms
 * for a 10k-entity drawing).
 *
 *   - `filterEntities(entities, visibleLayers)`  — entities on a visible layer.
 *   - `getLayerNames(entities)`                  — unique layer names in use.
 *
 * Layer visibility vs. layer existence:
 *   - If an entity's layer is NOT in `visibleLayers`, it is hidden.
 *   - If an entity has no layer (shouldn't happen — the parser always
 *     assigns "0"), it is treated as being on layer "0".
 *   - `visibleLayers` containing a layer that no entity uses is harmless.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dxf-4-layers.test.ts):
 *   - Fixture B: CIRCLE + LINE on layer A; LINE on layer B
 *     Filter with layer B hidden → excludes B's LINE, includes A's entities.
 */

import type { DxfEntity } from "@shared/schemas/drawing/dxf";

// ─── Pure layer filter ──────────────────────────────────────────────────

/**
 * Filter entities to only those whose layer is in `visibleLayers`.
 *
 * Per BR-DW3 — pure function. Same input → byte-identical output. No I/O,
 * no DOM, no Date.now(), no Math.random(). The viewer calls this on every
 * layer-toggle action and re-renders.
 *
 * @param entities      All parsed entities.
 * @param visibleLayers Set of layer names that are currently visible.
 *                      Empty set → no entities visible (everything filtered).
 * @returns A NEW array containing only entities on a visible layer.
 *          Order preserved from the input.
 */
export function filterEntities(
  entities: DxfEntity[],
  visibleLayers: Set<string>,
): DxfEntity[] {
  return entities.filter((e) => visibleLayers.has(e.layer));
}

/**
 * Get the unique layer names that appear in the entity list.
 *
 * Useful for the layers panel: the panel lists every layer declared in the
 * TABLES section (from `extractLayers`) PLUS every layer actually used by
 * an entity (from this function). Layers used by entities but missing from
 * the TABLES are synthesized with a default color (7) and visible = true.
 *
 * The returned array is deduplicated and sorted alphabetically — a stable
 * order makes the layers panel deterministic across renders.
 *
 * @param entities Parsed entities.
 * @returns Unique, alphabetically-sorted layer names in use.
 */
export function getLayerNames(entities: DxfEntity[]): string[] {
  const names = new Set<string>();
  for (const e of entities) {
    names.add(e.layer);
  }
  return Array.from(names).sort();
}
