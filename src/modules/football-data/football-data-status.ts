import { MatchStatus } from "@prisma/client";

/**
 * Maps Football-Data.org `match.status` to Prisma `MatchStatus`.
 * Unknown values default to SCHEDULED to avoid crashing sync.
 */
export function mapFootballDataStatus(status: string): MatchStatus {
  const s = status.toUpperCase();
  switch (s) {
    case "SCHEDULED":
    case "TIMED":
      return MatchStatus.SCHEDULED;
    case "IN_PLAY":
    case "PAUSED":
    case "INTERRUPTED":
      return MatchStatus.LIVE;
    case "FINISHED":
    case "AWARDED":
      return MatchStatus.FINISHED;
    case "POSTPONED":
      return MatchStatus.POSTPONED;
    case "CANCELLED":
      return MatchStatus.CANCELLED;
    case "SUSPENDED":
      return MatchStatus.SUSPENDED;
    default:
      return MatchStatus.SCHEDULED;
  }
}
