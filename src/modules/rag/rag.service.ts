import type { Match, PrismaClient } from '@prisma/client';
import { logger } from '../../core/logger';
import type { VectorService } from './vector.service';

const RAG_PEER_LIMIT = 4;
const RAG_SNIPPET_CHARS = 900;

export type MatchForRagContext = Pick<
  Match,
  'id' | 'homeTeam' | 'awayTeam' | 'league' | 'date' | 'sport' | 'rawContent'
>;

type PeerRow = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: Date;
  rawContent: string | null;
};

function buildRagQueryText(match: MatchForRagContext, ownExcerpt: string | null): string {
  return [match.league, match.sport, `${match.homeTeam} — ${match.awayTeam}`, ownExcerpt ?? '']
    .filter((s) => s.length > 0)
    .join('\n');
}

function vectorToPgLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/**
 * Контекст для промпта: превью матча + выдержки по лиге.
 * При наличии ключа/VectorService: эмбеддинг той же Gemini API, модель `GEMINI_EMBEDDING_MODEL`,
 * соседи ранжируются по косинусной близости (pgvector), иначе — последние N матчей лиги.
 */
export class RagService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vector?: VectorService,
  ) {}

  private peerRowToBlock(p: { homeTeam: string; awayTeam: string; date: Date; rawContent: string | null }): string | null {
    const text = p.rawContent?.slice(0, RAG_SNIPPET_CHARS) ?? '';
    if (!text) {
      return null;
    }
    return `[${p.homeTeam} — ${p.awayTeam}, ${p.date.toISOString()}]\n${text}`;
  }

  /** Запасной вариант: последние матчи той же лиги, исключая id. */
  private async fetchPeersByRecency(
    match: MatchForRagContext,
    excludeIds: string[],
    limit: number,
  ): Promise<string[]> {
    const peers = await this.prisma.match.findMany({
      where: {
        league: match.league,
        id: { not: match.id, notIn: excludeIds },
        rawContent: { not: null },
      },
      orderBy: { date: 'desc' },
      take: limit,
      select: { homeTeam: true, awayTeam: true, date: true, rawContent: true },
    });
    return peers
      .map((p) => this.peerRowToBlock(p))
      .filter((b): b is string => b !== null);
  }

  /**
   * Собирает текстовый блок RAG: превью матча + краткие выдержки из других записей той же лиги.
   */
  async buildContextForMatch(match: MatchForRagContext): Promise<string> {
    logger.info({ matchId: match.id, stage: 'rag' }, 'RAG: сбор контекста для матча');

    const ownExcerpt =
      match.rawContent && match.rawContent !== 'No preview available'
        ? match.rawContent.slice(0, RAG_SNIPPET_CHARS)
        : null;

    let peerBlocks: string[] = [];

    if (this.vector) {
      try {
        const queryText = buildRagQueryText(match, ownExcerpt);
        const queryEmbedding = await this.vector.embedText(queryText);
        const vec = vectorToPgLiteral(queryEmbedding);

        await this.prisma.$executeRawUnsafe(
          `UPDATE "Match" SET embedding = $1::vector WHERE id = $2`,
          vec,
          match.id,
        );

        const semantic = await this.prisma.$queryRawUnsafe<PeerRow[]>(
          `SELECT id, "homeTeam", "awayTeam", date, "rawContent"
           FROM "Match"
           WHERE league = $1 AND id <> $2 AND embedding IS NOT NULL
           ORDER BY embedding <=> $3::vector
           LIMIT $4`,
          match.league,
          match.id,
          vec,
          RAG_PEER_LIMIT,
        );

        const semanticIds = semantic.map((r) => r.id);
        peerBlocks = semantic
          .map((p) => this.peerRowToBlock(p))
          .filter((b): b is string => b !== null);

        if (peerBlocks.length < RAG_PEER_LIMIT) {
          const more = await this.fetchPeersByRecency(match, [match.id, ...semanticIds], RAG_PEER_LIMIT - peerBlocks.length);
          peerBlocks = [...peerBlocks, ...more];
        }

        logger.info(
          { matchId: match.id, stage: 'rag_semantic', usedSemantic: semantic.length, peerCount: peerBlocks.length },
          'RAG: использованы эмбеддинги для отбора соседей',
        );
      } catch (e) {
        logger.warn(
          { matchId: match.id, stage: 'rag_embed_fallback', err: e },
          'RAG: эмбеддинг недоступен, соседи по дате',
        );
        peerBlocks = await this.fetchPeersByRecency(match, [match.id], RAG_PEER_LIMIT);
      }
    } else {
      peerBlocks = await this.fetchPeersByRecency(match, [match.id], RAG_PEER_LIMIT);
    }

    const parts: string[] = [];
    if (ownExcerpt) {
      parts.push('=== Текущий матч (источник) ===', ownExcerpt);
    } else {
      parts.push('=== Текущий матч ===', 'Полного превью нет — опирайся на общие знания и блок лиги ниже.');
    }

    if (peerBlocks.length > 0) {
      parts.push('', '=== Другие матчи лиги (релевантный контент из БД) ===', peerBlocks.join('\n\n---\n\n'));
    } else {
      parts.push('', '=== Другие матчи лиги ===', 'Дополнительных текстов в БД для этой лиги нет.');
    }

    return parts.join('\n');
  }
}
