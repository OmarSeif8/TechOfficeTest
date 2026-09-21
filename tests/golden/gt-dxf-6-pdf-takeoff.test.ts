import { describe, it, expect } from "vitest";
import {
  calibrateScale,
  measurePolylineDistance,
  measurePolygonArea,
  Point2D,
} from "@/domain/drawing/pdf-takeoff";

describe("GT-DXF-6: PDF & Vector Sheet Takeoff (Golden Benchmark)", () => {
  it("calibrates scale accurately from 100-point dimension line representing 5 meters", () => {
    const p1: Point2D = { x: 0, y: 0 };
    const p2: Point2D = { x: 100, y: 0 };

    // 100 points = 5.0 meters -> 0.05 meters per point
    const scale = calibrateScale(p1, p2, 5.0);
    expect(scale.metersPerPoint).toBe("0.05");
  });

  it("measures exact multi-segment polyline distance", () => {
    // Calibrate: 100 screen units = 10 meters (0.1 m/point)
    const scale = calibrateScale({ x: 0, y: 0 }, { x: 100, y: 0 }, "10.0");

    // L-shaped wall: (0,0) -> (30,0) -> (30,40)
    // Screen distance = 30 + 40 = 70 points
    // Real distance = 70 * 0.1 = 7.000 meters
    const wallSegments: Point2D[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ];

    const distanceMeters = measurePolylineDistance(wallSegments, scale);
    expect(distanceMeters).toBe("7.000");
  });

  it("computes exact polygon area using Gauss shoelace formula for rectangular slab", () => {
    // 50 points = 5.0 meters (0.1 m/point)
    const scale = calibrateScale({ x: 0, y: 0 }, { x: 50, y: 0 }, 5.0);

    // Slab: width 40 points (4.0m) x height 60 points (6.0m)
    // Hand calculation: Area = 4.0m * 6.0m = 24.000 m²
    const slab: Point2D[] = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 70 },
      { x: 10, y: 70 },
    ];

    const areaM2 = measurePolygonArea(slab, scale);
    expect(areaM2).toBe("24.000");
  });

  it("computes exact triangular and irregular polygon area", () => {
    // 10 points = 1 meter (0.1 m/point)
    const scale = calibrateScale({ x: 0, y: 0 }, { x: 10, y: 0 }, 1.0);

    // Right-angle triangle: Base = 60 points (6m), Height = 40 points (4m)
    // Hand calculation: Area = 0.5 * 6m * 4m = 12.000 m²
    const triangle: Point2D[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: 40 },
    ];

    const areaM2 = measurePolygonArea(triangle, scale);
    expect(areaM2).toBe("12.000");
  });
});
