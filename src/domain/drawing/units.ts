/**
 * Drawing Units — BR-DW1 unit resolution from the DXF $INSUNITS header.
 *
 * Pure function — no DOM, no I/O. Per CONSTITUTION_V1.1_WEB §3.3 this file
 * is isomorphic: imports only stdlib. MUST NOT import next, react, prisma,
 * fs, path, electron, etc.
 *
 * Per BR-DW1: $INSUNITS → unit label (4=mm, 6=m, etc.); absent → null.
 * When the header is absent (older DXF files omit $INSUNITS), the function
 * returns `null` — the UI must prompt the user to select a unit manually
 * (rather than silently defaulting to mm/in/whatever, which is how drawings
 * get scaled wrong on the construction site).
 *
 * The mapping table comes from the AutoCAD DXF Reference, $INSUNITS values
 * (group code 70 inside $INSUNITS):
 *
 *   0  = Unspecified (no units) — treated as absent → null
 *   1  = Inches
 *   2  = Feet
 *   3  = Miles
 *   4  = Millimeters  ← most common for civil/structural drawings
 *   5  = Centimeters
 *   6  = Meters       ← most common for site plans / survey
 *   7  = Kilometers
 *   8  = Microinches
 *   9  = Mils
 *   10 = Inches (again)
 *   11 = Yards
 *   12 = Angstroms
 *   13 = Nanometers
 *   14 = Microns
 *   15 = Decimeters
 *   16 = Decameters
 *   17 = Hectometers
 *   18 = Gigameters
 *   19 = AU (astronomical units)
 *   20 = Light-years
 *   21 = Parsecs
 *   22 = US Survey Feet
 *   23 = US Survey Inches
 *   24 = US Survey Yards
 *   25 = US Survey Miles
 *
 * For the TechOffice MVP we expose the common engineering units. Unknown /
 * unspecified values fall back to `null` (UI prompts the user) — never a
 * silent default.
 *
 * Law (golden tests are authoritative — tests/golden/gt-dxf-5-units.test.ts):
 *   - $INSUNITS = 4 → "mm"
 *   - $INSUNITS = 6 → "m"
 *   - $INSUNITS absent (null) → null (UI prompts)
 */

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Map a $INSUNITS integer to a short unit label suitable for UI display.
 *
 *   - 4 → "mm"   (millimeters)
 *   - 5 → "cm"   (centimeters)
 *   - 6 → "m"    (meters)
 *   - 7 → "km"   (kilometers)
 *   - 1 → "in"   (inches)
 *   - 2 → "ft"   (feet)
 *   - 3 → "mi"   (miles)
 *   - 11 → "yd"  (yards)
 *   - 22 → "ft-us"  (US survey feet — distinct from international feet)
 *   - 0 → null (DXF "Unspecified" — caller should prompt the user)
 *   - null / undefined → null (absent header — caller should prompt)
 *   - any other value → null (unknown — caller should prompt)
 *
 * @param insUnits The raw $INSUNITS value, or null if absent.
 * @returns Short unit label, or `null` if the unit is unknown / unspecified.
 */
export function unitFromInsUnits(insUnits: number | null | undefined): string | null {
  if (insUnits === null || insUnits === undefined) return null;
  if (!Number.isFinite(insUnits)) return null;
  switch (insUnits) {
    case 0:
      // DXF "Unspecified" — same as absent header.
      return null;
    case 1:
      return "in"; // inches
    case 2:
      return "ft"; // feet (international)
    case 3:
      return "mi"; // miles
    case 4:
      return "mm"; // millimeters — civil/structural default
    case 5:
      return "cm"; // centimeters
    case 6:
      return "m"; // meters — site plans / survey default
    case 7:
      return "km"; // kilometers
    case 11:
      return "yd"; // yards
    case 22:
      return "ft-us"; // US survey feet (distinct from international feet)
    default:
      // Unknown code — fall back to null so the UI prompts the user, rather
      // than silently rendering an unknown unit as something plausible.
      return null;
  }
}
