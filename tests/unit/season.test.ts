import { describe, expect, it } from "vitest";
import { extractSeasonYear } from "../../src/modules/football-data/season.js";

describe("extractSeasonYear", () => {
  it("parses startDate year", () => {
    expect(extractSeasonYear({ startDate: "2024-08-01" })).toBe(2024);
  });

  it("supports numeric season", () => {
    expect(extractSeasonYear(2023)).toBe(2023);
  });

  it("returns null for unknown shapes", () => {
    expect(extractSeasonYear(null)).toBeNull();
    expect(extractSeasonYear("nope")).toBeNull();
  });
});
