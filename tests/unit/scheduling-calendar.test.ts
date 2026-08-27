/**
 * Scheduling Calendar — unit tests.
 *
 * Covers BR-P5..P8 from SPEC_PHASE2_WEB.md §3:
 *   - BR-P5: isWorking exception precedence (both directions)
 *   - BR-P6: validateCalendar rejects all-off masks
 *   - BR-P7: index↔date round-trip across weekends
 *   - BR-P8: open-start snapping when projectStart is a non-working day
 *
 * These tests supplement the golden tests (GT-P1..P6) — they cover edge cases
 * the golden tests don't reach (exception precedence both ways, holiday
 * clusters, weekday-formula anchors, round-trip determinism).
 */

import { describe, it, expect } from "vitest";
import {
  isWorking,
  getWorkingDayIndex,
  indexToDate,
  validateCalendar,
  parseIsoDate,
  formatIsoDate,
  addDays,
} from "@domain/scheduling/calendar";
import type { Calendar } from "@shared/schemas/scheduling/calendar";

// ─── Test calendars ────────────────────────────────────────────────────────

const monFri: Calendar = {
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  },
  exceptions: [],
};

const sunThu: Calendar = {
  // Egyptian/Gulf default per BR-P9 (Sun-Thu working, Fri-Sat off)
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: false, saturday: false, sunday: true,
  },
  exceptions: [],
};

const allWorking: Calendar = {
  mask: {
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: true, sunday: true,
  },
  exceptions: [],
};

// ─── Pure date arithmetic sanity (anchored to known calendar facts) ────────

describe("Pure date arithmetic (BR-P1 — no JS Date objects)", () => {
  it("Jan 1, 2026 is Thursday (anchor)", () => {
    // Used as a sanity anchor: Jan 1, 2026 is a Thursday per independent calendar lookup.
    // 1970-01-01 was Thursday; weekday(z) = (z + 4) mod 7 with 0=Sunday.
    // parseIsoDate returns days-since-1970-01-01.
    const z = parseIsoDate("2026-01-01");
    // 0=Sun, 1=Mon, ..., 4=Thu
    expect(((z % 7) + 7 + 4) % 7).toBe(4);
  });

  it("Jan 5, 2026 is Monday (anchor — used by all golden tests)", () => {
    const z = parseIsoDate("2026-01-05");
    expect(((z % 7) + 7 + 4) % 7).toBe(1);
  });

  it("Jan 10, 2026 is Saturday (non-working in Mon-Fri)", () => {
    const z = parseIsoDate("2026-01-10");
    expect(((z % 7) + 7 + 4) % 7).toBe(6);
  });

  it("formatIsoDate round-trips a wide range of dates", () => {
    for (const iso of [
      "1970-01-01", "2000-02-29", "2024-12-31", "2026-01-05",
      "2026-01-10", "2026-01-12", "1999-12-31", "2100-03-01",
    ]) {
      expect(formatIsoDate(parseIsoDate(iso))).toBe(iso);
    }
  });

  it("parseIsoDate rejects invalid input", () => {
    expect(() => parseIsoDate("not-a-date")).toThrow();
    expect(() => parseIsoDate("2026-1-5")).toThrow(); // non-zero-padded
    expect(() => parseIsoDate("2026/01/05")).toThrow();
    expect(() => parseIsoDate("2026-13-01")).toThrow(); // month 13
    expect(() => parseIsoDate("2026-02-30")).toThrow(); // Feb 30 doesn't exist
  });

  it("addDays handles year/month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not a leap year
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // 2024 IS a leap year
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

// ─── BR-P5: isWorking precedence ─────────────────────────────────────────────

describe("BR-P5 — isWorking: exception beats mask (both directions)", () => {
  it("mask says working, exception says non-working → non-working", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-07", isWorking: false, nameEn: "Holiday on a Wednesday" },
      ],
    };
    // Wed Jan 7 2026 — Wed is in mask as working, but the exception overrides.
    expect(isWorking(cal, "2026-01-07")).toBe(false);
  });

  it("mask says non-working, exception says working → working", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-10", isWorking: true, nameEn: "Work this Saturday" },
      ],
    };
    // Sat Jan 10 2026 — Saturday is off in mask, exception makes it working.
    expect(isWorking(cal, "2026-01-10")).toBe(true);
  });

  it("dates without exceptions fall through to the mask (Mon-Fri working)", () => {
    expect(isWorking(monFri, "2026-01-05")).toBe(true);  // Mon
    expect(isWorking(monFri, "2026-01-06")).toBe(true);  // Tue
    expect(isWorking(monFri, "2026-01-09")).toBe(true);  // Fri
    expect(isWorking(monFri, "2026-01-10")).toBe(false); // Sat
    expect(isWorking(monFri, "2026-01-11")).toBe(false); // Sun
  });

  it("Sun-Thu calendar (Egyptian/Gulf default per BR-P9)", () => {
    // 2026-01-04 = Sun, 01-09 = Fri, 01-10 = Sat
    expect(isWorking(sunThu, "2026-01-04")).toBe(true);  // Sun working
    expect(isWorking(sunThu, "2026-01-09")).toBe(false); // Fri off
    expect(isWorking(sunThu, "2026-01-10")).toBe(false); // Sat off
  });

  it("holiday cluster: consecutive exceptions all honored", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-05", isWorking: false, nameEn: "Holiday Mon" },
        { date: "2026-01-06", isWorking: false, nameEn: "Holiday Tue" },
        { date: "2026-01-07", isWorking: false, nameEn: "Holiday Wed" },
      ],
    };
    expect(isWorking(cal, "2026-01-05")).toBe(false); // Mon — exception
    expect(isWorking(cal, "2026-01-06")).toBe(false); // Tue — exception
    expect(isWorking(cal, "2026-01-07")).toBe(false); // Wed — exception
    expect(isWorking(cal, "2026-01-08")).toBe(true);  // Thu — mask (no exception)
  });

  it("exception takes precedence on weekend-adjacent dates (work-this-weekend case)", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-10", isWorking: true,  nameEn: "Make-up Saturday" },
        { date: "2026-01-11", isWorking: false,  nameEn: "Comp Sunday off" },
      ],
    };
    expect(isWorking(cal, "2026-01-10")).toBe(true);  // Sat — exception overrides
    expect(isWorking(cal, "2026-01-11")).toBe(false); // Sun — exception confirms off
  });
});

// ─── BR-P7: index↔date conversion ──────────────────────────────────────────

describe("BR-P7 — working-day index↔date round-trips", () => {
  it("index 1 = first working day ≥ project start (Mon-Fri, start Mon 2026-01-05)", () => {
    expect(indexToDate(monFri, "2026-01-05", 1)).toBe("2026-01-05");
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-05")).toBe(1);
  });

  it("index 5 = Jan 9 (Fri); index 6 = Jan 12 (Mon — weekend skipped)", () => {
    expect(indexToDate(monFri, "2026-01-05", 5)).toBe("2026-01-09");
    expect(indexToDate(monFri, "2026-01-05", 6)).toBe("2026-01-12");
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-09")).toBe(5);
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-12")).toBe(6);
  });

  it("non-working dates return null from getWorkingDayIndex", () => {
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-10")).toBeNull(); // Sat
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-11")).toBeNull(); // Sun
  });

  it("date before first working day returns null", () => {
    // Project start Jan 5 (Mon). Jan 4 (Sun) is before — null.
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2026-01-04")).toBeNull();
    expect(getWorkingDayIndex(monFri, "2026-01-05", "2025-12-31")).toBeNull();
  });

  it("round-trip: indexToDate(i) → getWorkingDayIndex → i, for i = 1..20 (crosses 3 weekends)", () => {
    for (let i = 1; i <= 20; i++) {
      const iso = indexToDate(monFri, "2026-01-05", i);
      const back = getWorkingDayIndex(monFri, "2026-01-05", iso);
      expect(back).toBe(i);
    }
  });

  it("round-trip with Egyptian/Gulf Sun-Thu calendar", () => {
    // Sun-Thu working, Fri-Sat off. Project start Sun 2026-01-04.
    for (let i = 1; i <= 14; i++) {
      const iso = indexToDate(sunThu, "2026-01-04", i);
      const back = getWorkingDayIndex(sunThu, "2026-01-04", iso);
      expect(back).toBe(i);
    }
    // Specific anchors: index 1 = Sun Jan 4; index 5 = Thu Jan 8; index 6 = Sun Jan 11 (Fri-Sat skipped).
    expect(indexToDate(sunThu, "2026-01-04", 1)).toBe("2026-01-04");
    expect(indexToDate(sunThu, "2026-01-04", 5)).toBe("2026-01-08");
    expect(indexToDate(sunThu, "2026-01-04", 6)).toBe("2026-01-11");
  });

  it("round-trip with all-working calendar (no skipping)", () => {
    for (let i = 1; i <= 14; i++) {
      const iso = indexToDate(allWorking, "2026-01-05", i);
      const back = getWorkingDayIndex(allWorking, "2026-01-05", iso);
      expect(back).toBe(i);
    }
    expect(indexToDate(allWorking, "2026-01-05", 1)).toBe("2026-01-05");
    expect(indexToDate(allWorking, "2026-01-05", 7)).toBe("2026-01-11"); // straight calendar week
  });

  it("holiday cluster: 3-day holiday is skipped in the index sequence", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-05", isWorking: false, nameEn: "Holiday Mon" },
        { date: "2026-01-06", isWorking: false, nameEn: "Holiday Tue" },
        { date: "2026-01-07", isWorking: false, nameEn: "Holiday Wed" },
      ],
    };
    // Project start Mon Jan 5 (holiday). First working day = Thu Jan 8.
    expect(indexToDate(cal, "2026-01-05", 1)).toBe("2026-01-08");
    expect(indexToDate(cal, "2026-01-05", 2)).toBe("2026-01-09");
    // Then weekend (Jan 10-11 skipped).
    expect(indexToDate(cal, "2026-01-05", 3)).toBe("2026-01-12");
  });
});

// ─── BR-P8: open-start snapping ─────────────────────────────────────────────

describe("BR-P8 — open-start snapping when projectStart is a non-working day", () => {
  it("projectStart on Saturday → first working day = Monday", () => {
    // Sat 2026-01-10 — project start on a non-working day; first working day = Mon Jan 12.
    expect(indexToDate(monFri, "2026-01-10", 1)).toBe("2026-01-12");
  });

  it("projectStart on Sunday → first working day = Monday", () => {
    expect(indexToDate(monFri, "2026-01-11", 1)).toBe("2026-01-12");
  });

  it("projectStart on a holiday → first working day = next working day", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-05", isWorking: false, nameEn: "Holiday Mon" },
      ],
    };
    // Project start Mon Jan 5 = holiday. First working day = Tue Jan 6.
    expect(indexToDate(cal, "2026-01-05", 1)).toBe("2026-01-06");
  });
});

// ─── BR-P6: validateCalendar ─────────────────────────────────────────────────

describe("BR-P6 — validateCalendar", () => {
  it("valid Mon-Fri calendar → no errors", () => {
    expect(validateCalendar(monFri)).toEqual([]);
  });

  it("valid Sun-Thu calendar → no errors", () => {
    expect(validateCalendar(sunThu)).toEqual([]);
  });

  it("all-off mask → validation error", () => {
    const allOff: Calendar = {
      mask: {
        monday: false, tuesday: false, wednesday: false, thursday: false,
        friday: false, saturday: false, sunday: false,
      },
      exceptions: [],
    };
    const errors = validateCalendar(allOff);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("mask must have ≥ 1 working weekday"))).toBe(true);
  });

  it("mask with only Saturday working → valid (≥ 1 working day)", () => {
    const onlySat: Calendar = {
      mask: {
        monday: false, tuesday: false, wednesday: false, thursday: false,
        friday: false, saturday: true, sunday: false,
      },
      exceptions: [],
    };
    expect(validateCalendar(onlySat)).toEqual([]);
  });

  it("duplicate exception dates → validation error", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-01-07", isWorking: false },
        { date: "2026-01-07", isWorking: true },
      ],
    };
    const errors = validateCalendar(cal);
    expect(errors.some((e) => e.includes("duplicate exception date"))).toBe(true);
  });

  it("malformed exception date → validation error", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "not-a-date", isWorking: false },
      ],
    };
    const errors = validateCalendar(cal);
    expect(errors.some((e) => e.includes("not a valid ISO"))).toBe(true);
  });

  it("impossible calendar date (Feb 30) → validation error", () => {
    const cal: Calendar = {
      mask: monFri.mask,
      exceptions: [
        { date: "2026-02-30", isWorking: false },
      ],
    };
    const errors = validateCalendar(cal);
    expect(errors.some((e) => e.includes("not a valid calendar date"))).toBe(true);
  });
});

// ─── Negative-index support (BR-P15) ──────────────────────────────────────

describe("BR-P15 — indexToDate handles non-positive indices (for ES-before-project-start)", () => {
  it("index 0 = the working day immediately before the first working day ≥ start", () => {
    // Mon-Fri calendar, start Mon Jan 5. The working day before is Fri Jan 2.
    expect(indexToDate(monFri, "2026-01-05", 0)).toBe("2026-01-02");
  });

  it("index -1 = the working day before index 0", () => {
    // Before Fri Jan 2 (index 0) is Thu Jan 1 (index -1).
    expect(indexToDate(monFri, "2026-01-05", -1)).toBe("2026-01-01");
  });

  it("index -2 = the working day before index -1 (skips a weekend)", () => {
    // Before Thu Jan 1 (index -1) is Thu Dec 31, 2025 (index -2 — Fri Jan 2, Sat/Sun off, Thu Dec 31).
    expect(indexToDate(monFri, "2026-01-05", -2)).toBe("2025-12-31");
  });
});
