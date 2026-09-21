/**
 * Pure Domain: Vector PDF & CAD Scale Calibration & Takeoff Engine
 *
 * Implements high-precision metric calibration and geometric measurement
 * for 2D engineering drawings and vector sheets.
 *
 * Law of Layers:
 *   - PURE DOMAIN: Zero platform imports (no React, Next.js, or Node.js).
 *   - All arithmetic uses decimal.js for financial/survey precision.
 */

import Decimal from "decimal.js";

export interface Point2D {
  x: number;
  y: number;
}

export interface CalibrationScale {
  metersPerPoint: string; // Stored as decimal string to prevent rounding drift
  referenceName?: string;
}

/**
 * Calibrates scale from a measured on-screen line segment and its known physical length.
 *
 * @param p1 First reference point (screen/canvas coordinates)
 * @param p2 Second reference point (screen/canvas coordinates)
 * @param knownRealWorldMeters Real-world dimension indicated on drawing (e.g. 5.0 meters)
 */
export function calibrateScale(
  p1: Point2D,
  p2: Point2D,
  knownRealWorldMeters: number | string
): CalibrationScale {
  const dx = new Decimal(p2.x).minus(p1.x);
  const dy = new Decimal(p2.y).minus(p1.y);
  const screenDist = dx.pow(2).plus(dy.pow(2)).sqrt();

  if (screenDist.isZero()) {
    throw new Error("Reference points cannot be identical (distance is zero)");
  }

  const known = new Decimal(knownRealWorldMeters);
  if (known.isNegative() || known.isZero()) {
    throw new Error("Known length must be strictly positive");
  }

  const metersPerPoint = known.div(screenDist);

  return {
    metersPerPoint: metersPerPoint.toString(),
  };
}

/**
 * Measures the true physical length of a polyline in meters given a calibrated scale.
 */
export function measurePolylineDistance(
  points: Point2D[],
  scale: CalibrationScale
): string {
  if (points.length < 2) return "0.000";

  const mpp = new Decimal(scale.metersPerPoint);
  let totalScreenDist = new Decimal(0);

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = new Decimal(p2.x).minus(p1.x);
    const dy = new Decimal(p2.y).minus(p1.y);
    const dist = dx.pow(2).plus(dy.pow(2)).sqrt();
    totalScreenDist = totalScreenDist.plus(dist);
  }

  const realMeters = totalScreenDist.mul(mpp);
  return realMeters.toFixed(3);
}

/**
 * Calculates the exact enclosed real-world area (in square meters) of a closed polygon
 * using the shoelace algorithm (Gauss's area formula).
 */
export function measurePolygonArea(
  polygon: Point2D[],
  scale: CalibrationScale
): string {
  if (polygon.length < 3) return "0.000";

  const n = polygon.length;
  let sum1 = new Decimal(0);
  let sum2 = new Decimal(0);

  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const x_i = new Decimal(polygon[i].x);
    const y_i = new Decimal(polygon[i].y);
    const x_next = new Decimal(polygon[nextIdx].x);
    const y_next = new Decimal(polygon[nextIdx].y);

    sum1 = sum1.plus(x_i.mul(y_next));
    sum2 = sum2.plus(x_next.mul(y_i));
  }

  // Screen area in point^2 = 0.5 * |sum1 - sum2|
  const screenArea = sum1.minus(sum2).abs().mul(0.5);

  // Real world area in m^2 = screenArea * (metersPerPoint)^2
  const mpp = new Decimal(scale.metersPerPoint);
  const realAreaM2 = screenArea.mul(mpp.pow(2));

  return realAreaM2.toFixed(3);
}
