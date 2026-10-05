import type { Env } from '../index.ts';
import type { ResultSummary, ResultPlayer, ResultDetail, PlayerResultDetail } from '../../../../packages/shared/src/results.ts';
import { resultReasons } from '../../../../packages/shared/src/results.ts';
import { validId, validRoom } from '../../../../packages/shared/src/protocol.ts';
import { bankId } from './banks.ts';
import { HttpError, json, readJSON } from '../security.ts';
import { csvRows } from '../results/csv.ts';

type GameRow = { id: string; room_id: string; title: string; bank_id: string | null; bank_revision: number | null; created_at: number; started_at: number | null; ended_at: number; final_version: number;
 reason: ResultSummary['reason']; question_count: number; scored_question_count: number; player_count: number; status: ResultSummary['status']; archived_at: number | null; questions: string };
type PlayerRow = { player_id: string; nickname: string; rank: number; score: number; round1: number; round2: number; round3: number; answered: number; answers?: string };
const summary = (r: GameRow): ResultSummary => ({ id: r.id, roomId: r.room_id, title: r.title, bankId: r.bank_id, bankRevision: r.bank_revision,
 createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at, finalVersion: r.final_version, reason: r.reason,
 questionCount: r.question_count, scoredQuestionCount: r.scored_question_count, playerCount: r.player_count, status: r.status, archivedAt: r.archived_at });
const player = (r: PlayerRow): ResultPlayer => ({ playerId: r.player_id, nickname: r.nickname, rank: r.rank, score: r.score, round1: r.round1, round2: r.round2, round3: r.round3, answered: r.answered });
async function game(db: D1Database, id: string): Promise<GameRow> {
 const row = await db.prepare('SELECT * FROM archived_games WHERE id=?').bind(id).first<GameRow>();
 if (!row) throw new HttpError(404, '找不到歸檔成績');
 if (row.status !== 'ready') throw new HttpError(409, '歸檔尚未完成，不能查閱或匯出部分成績');
 return row;
}
export async function resultsRoute(req: Request, env: Env): Promise<Response> {
 const url = new URL(req.url);
 const roomMatch = url.pathname.match(/^\/api\/admin\/results\/rooms\/([^/]+)\/(status|retry)$/);
 if (roomMatch) {
  const [, room, action] = roomMatch;
  if (!validRoom(room)) throw new HttpError(400, '請輸入8碼房間代碼');
  if (req.method !== (action === 'status' ? 'GET' : 'POST')) throw new HttpError(405, '不支援的操作');
  if (action === 'retry') await readJSON(req, 4096);
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory-v1'));
  if (!await directory.hasRoom(room)) throw new HttpError(404, '房間不存在');
  const object = env.ROOMS.get(env.ROOMS.idFromName(room)); const info = await object.archiveInfo();
  if (!info.exists) throw new HttpError(404, '房間不存在');
  if (action === 'retry') {
   try { return json({ archive: await object.retryArchive() }); }
   catch { throw new HttpError(429, '重試操作太頻繁或房間暫時無法回應，請稍後再試'); }
  }
  return json({ archive: info.archive });
 }
 if (!env.DB) throw new HttpError(503, '尚未設定成績資料庫');
 const db = env.DB;
 if (url.pathname === '/api/admin/results' && req.method === 'GET') {
  const raw = url.searchParams.get('offset') ?? '0'; if (!/^\d{1,7}$/.test(raw)) throw new HttpError(400, '分頁格式錯誤');
  const offset = Number(raw);
  const rows = await db.prepare(`SELECT id,room_id,title,bank_id,bank_revision,created_at,started_at,ended_at,final_version,reason,question_count,scored_question_count,player_count,status,archived_at
   FROM archived_games ORDER BY ended_at DESC,id DESC LIMIT 21 OFFSET ?`).bind(offset).all<GameRow>();
  return json({ games: rows.results.slice(0, 20).map(summary), nextOffset: rows.results.length > 20 ? offset + 20 : null });
 }
 const match = url.pathname.match(/^\/api\/admin\/results\/([^/]+)(?:\/(csv|players)\/?([^/]+)?)?$/);
 if (!match || !bankId(match[1])) throw new HttpError(404, '找不到成績');
 if (req.method !== 'GET') throw new HttpError(405, '不支援的操作');
 const [, id, action, playerId] = match; const row = await game(db, id);
 if (action === 'players') {
  if (!validId(playerId)) throw new HttpError(400, '玩家識別碼錯誤');
  const p = await db.prepare('SELECT * FROM archived_players WHERE game_id=? AND player_id=?').bind(id, playerId).first<PlayerRow>();
  if (!p) throw new HttpError(404, '找不到玩家成績');
  return json({ player: player(p), answers: JSON.parse(p.answers!), questions: JSON.parse(row.questions) } satisfies PlayerResultDetail);
 }
 if (playerId) throw new HttpError(404, '找不到成績');
 const players = (await db.prepare('SELECT player_id,nickname,rank,score,round1,round2,round3,answered FROM archived_players WHERE game_id=? ORDER BY rank,player_id LIMIT 350').bind(id).all<PlayerRow>()).results.map(player);
 if (action === 'csv') {
  const rows: (string | number)[][] = [['房間代碼', '題庫名稱', '發布版本', '結算時間（台北）', '結束方式', '名次', '玩家識別碼', '暱稱', '總分', '第1回合', '第2回合', '第3回合', '已作答題數', '計分題數']];
  const ended = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(row.ended_at);
  for (const p of players) rows.push([row.room_id, row.title, row.bank_revision ?? '本機／舊版', ended, resultReasons[row.reason], p.rank, p.playerId, p.nickname, p.score, p.round1, p.round2, p.round3, p.answered, row.scored_question_count]);
  return new Response(csvRows(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="results-${row.room_id}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
 }
 return json({ game: summary(row), players } satisfies ResultDetail);
}
