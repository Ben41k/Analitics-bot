import axios from 'axios';
import { Match } from '../../../schemas/match.schema';

export class FootballDataProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor() {
    this.apiKey = process.env.FOOTBALL_DATA_API_KEY || '';
  }

  async getTopLeaguesMatches(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/matches`, {
        headers: { 'X-Auth-Token': this.apiKey },
        // Эти лиги входят в бесплатный пакет (PL = АПЛ, CL = ЛЧ, и т.д.)
        params: { 
          competitions: 'PL,CL,BL1,SA,PD', 
          dateFrom: new Date().toISOString().split('T')[0],
          dateTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] 
        }
      });

      // Лимиты football-data.org v4: X-RequestsAvailable (axios даёт ключи в нижнем регистре)
      const h = response.headers as Record<string, string | undefined>;
      const requestsLeft =
        h['x-requestsavailable'] ??
        h['x-requests-remaining'] ??
        h['x-ratelimit-remaining'];
      console.log(
        `📊 Лимиты API: осталось запросов — ${requestsLeft != null && requestsLeft !== '' ? requestsLeft : 'n/a (заголовок не пришёл)'}`,
      );

      return response.data.matches;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.error('⚠️ Превышен лимит запросов! Ждем минуту...');
      } else {
        console.error('❌ Ошибка Football-Data API:', error.message);
      }
      return [];
    }
  }
}