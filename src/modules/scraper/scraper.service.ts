export interface ScrapedMatch {
    externalId: string; // ID матча на сайте-источнике
    homeTeam: string;
    awayTeam: string;
    date: Date;
    league: string;
    sport: 'football' | 'hockey' | 'basketball';
    odds?: {
      homeWin: number;
      draw?: number;
      awayWin: number;
    };
    rawContent: string; // Весь текст со страницы (для RAG)
  }