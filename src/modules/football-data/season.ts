export function extractSeasonYear(season: unknown): number | null {
  if (typeof season === "number" && Number.isFinite(season)) {
    return season;
  }
  if (typeof season === "object" && season !== null && "startDate" in season) {
    const sd = (season as { startDate?: unknown }).startDate;
    if (typeof sd === "string" && sd.length >= 4) {
      const y = Number.parseInt(sd.slice(0, 4), 10);
      return Number.isFinite(y) ? y : null;
    }
  }
  return null;
}
