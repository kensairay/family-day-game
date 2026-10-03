import type { ArchiveReason, ArchivedAnswer, BankSource } from '../../../../packages/shared/src/results.ts';
import type { Question } from '../../../../packages/shared/src/protocol.ts';

export interface ArchiveHeader {
 id: string; roomId: string; source: BankSource; createdAt: number; startedAt: number | null; endedAt: number;
 finalVersion: number; reason: ArchiveReason; scoredQuestionCount: number; playerCount: number; questions: Question[];
}
export interface ArchivePlayer {
 playerId: string; nickname: string; rank: number; score: number; round1: number; round2: number; round3: number;
 answered: number; answers: ArchivedAnswer[];
}
export const ARCHIVE_CHUNK = 20;
export const ARCHIVE_BATCHES = 5;
export const retryDelay = (attempts: number) => Math.min(3600000, 30000 * 2 ** Math.min(7, Math.max(0, attempts - 1)));
export async function writeArchiveChunk(db: D1Database, header: ArchiveHeader, players: ArchivePlayer[], final: boolean): Promise<boolean> {
 const result = await db.batch([
  db.prepare(`INSERT INTO archived_games (id,room_id,title,bank_id,bank_revision,created_at,started_at,ended_at,final_version,reason,question_count,scored_question_count,player_count,questions)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(header.id, header.roomId, header.source.title, header.source.bankId, header.source.revision,
    header.createdAt, header.startedAt, header.endedAt, header.finalVersion, header.reason, header.questions.length, header.scoredQuestionCount, header.playerCount, JSON.stringify(header.questions)),
  // One JSON parameter avoids thousands of SQL placeholders and per-player D1 requests.
  db.prepare(`INSERT INTO archived_players (game_id,player_id,nickname,rank,score,round1,round2,round3,answered,answers)
   SELECT ?,json_extract(value,'$.playerId'),json_extract(value,'$.nickname'),json_extract(value,'$.rank'),json_extract(value,'$.score'),
    json_extract(value,'$.round1'),json_extract(value,'$.round2'),json_extract(value,'$.round3'),json_extract(value,'$.answered'),json_extract(value,'$.answers')
   FROM json_each(?) WHERE 1 ON CONFLICT(game_id,player_id) DO NOTHING`).bind(header.id, JSON.stringify(players)),
  db.prepare(`UPDATE archived_games SET status='ready',archived_at=? WHERE id=? AND status='writing' AND ?=1
   AND (SELECT COUNT(*) FROM archived_players WHERE game_id=?)=player_count`).bind(Date.now(), header.id, final ? 1 : 0, header.id),
  db.prepare('SELECT status FROM archived_games WHERE id=?').bind(header.id),
 ]);
 return (result[3].results[0] as { status?: string } | undefined)?.status === 'ready';
}
