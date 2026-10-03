import type { QuestionBank, BankSummary } from '../../../../packages/shared/src/question-bank.ts';
import type { Question } from '../../../../packages/shared/src/protocol.ts';
import { validateQuestions } from '../room/engine.ts';
import { HttpError, json, readJSON } from '../security.ts';

interface Row {
 id: string; title: string; description: string; questions: string; revision: number;
 published_revision: number | null; published_title: string | null; published_questions: string | null;
 created_at: number; updated_at: number; archived_at: number | null;
}
export const bankId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const revision = (value: unknown) => {
 if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, '請提供有效的題庫版本');
 return value as number;
};
function summary(row: Row): BankSummary {
 return { id: row.id, title: row.title, description: row.description, revision: row.revision,
  publishedRevision: row.published_revision, publishedTitle: row.published_title,
  questionCount: (JSON.parse(row.questions) as Question[]).length,
  publishedCount: row.published_questions ? (JSON.parse(row.published_questions) as Question[]).length : 0, updatedAt: row.updated_at };
}
function detail(row: Row): QuestionBank { return { ...summary(row), questions: JSON.parse(row.questions) }; }
async function get(db: D1Database, id: string): Promise<Row> {
 const row = await db.prepare('SELECT * FROM question_banks WHERE id=? AND archived_at IS NULL').bind(id).first<Row>();
 if (!row) throw new HttpError(404, '題庫不存在或已封存');
 return row;
}
function draft(data: Record<string, unknown>) {
 if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 80) throw new HttpError(400, '題庫名稱須為1～80字');
 if (typeof data.description !== 'string' || data.description.length > 500) throw new HttpError(400, '說明不可超過500字');
 if (!Array.isArray(data.questions) || data.questions.length > 60) throw new HttpError(400, '草稿最多60題');
 const ids = new Set<string>();
 // Drafts may contain blank text/options or an unset answer. Full game validation happens only at publish.
 const questions = data.questions.map((raw: unknown): Question => {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, '題目格式錯誤');
  const q = raw as Question;
  if (typeof q.id !== 'string' || !/^[\w-]{1,80}$/.test(q.id) || ids.has(q.id)) throw new HttpError(400, '題目ID不可重複');
  ids.add(q.id);
  if (!Number.isInteger(q.round) || q.round < 1 || q.round > 3) throw new HttpError(400, '回合須為1～3');
  if (typeof q.text !== 'string' || q.text.length > 300) throw new HttpError(400, '題目不可超過300字');
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 || q.options.some(o => typeof o !== 'string' || o.length > 100)) throw new HttpError(400, '每題須有2～4個選項，各不超過100字');
  if (!Number.isInteger(q.correct) || q.correct < -1 || q.correct >= q.options.length) throw new HttpError(400, '正確答案格式錯誤');
  if (!Number.isInteger(q.seconds) || q.seconds < 3 || q.seconds > 120) throw new HttpError(400, '答題時間須為3～120秒');
  if (!Number.isInteger(q.points) || q.points < 0 || q.points > 10000) throw new HttpError(400, '配分須為0～10000');
  return { id: q.id, round: q.round, text: q.text.trim(), options: q.options.map(o => o.trim()), correct: q.correct, seconds: q.seconds, points: q.points };
 });
 return { title: data.title.trim(), description: data.description.trim(), questions: JSON.stringify(questions) };
}
export async function publishedQuestions(db: D1Database | undefined, id: unknown, version: unknown): Promise<Question[]> {
 if (!db) throw new HttpError(503, '尚未設定題庫資料庫');
 if (!bankId(id)) throw new HttpError(400, '題庫識別碼錯誤');
 const row = await get(db, id);
 if (!row.published_questions || row.published_revision === null) throw new HttpError(409, '題庫尚未發布');
 if (row.published_revision !== revision(version)) throw new HttpError(409, '已發布題庫版本已變更，請重新載入後再建立房間');
 return validateQuestions(JSON.parse(row.published_questions));
}
export async function bankRoute(req: Request, db: D1Database | undefined): Promise<Response> {
 if (!db) throw new HttpError(503, '尚未設定題庫資料庫');
 const path = new URL(req.url).pathname;
 if (path === '/api/admin/banks') {
  if (req.method === 'GET') {
   const rows = await db.prepare('SELECT * FROM question_banks WHERE archived_at IS NULL ORDER BY updated_at DESC, id LIMIT 100').all<Row>();
   return json({ banks: rows.results.map(summary) });
  }
  if (req.method === 'POST') {
   const data = draft(await readJSON(req, 262144)); const id = crypto.randomUUID(), now = Date.now();
   const result = await db.prepare(`INSERT INTO question_banks (id,title,description,questions,created_at,updated_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM question_banks WHERE archived_at IS NULL)<100`).bind(id, data.title, data.description, data.questions, now, now).run();
   if (result.meta.changes !== 1) throw new HttpError(409, '最多可保留100份使用中的題庫，請先封存不需要的題庫');
   return json(detail(await get(db, id)), 201);
  }
  throw new HttpError(405, '不支援的操作');
 }
 const match = path.match(/^\/api\/admin\/banks\/([^/]+)(\/publish)?$/);
 if (!match || !bankId(match[1])) throw new HttpError(404, '找不到題庫');
 const [, id, publish] = match;
 if (!publish && req.method === 'GET') return json(detail(await get(db, id)));
 if ((!publish && ['PUT', 'DELETE'].includes(req.method)) || (publish && req.method === 'POST')) {
  const data = await readJSON(req, 262144); const expected = revision(data.revision); const now = Date.now();
  let result: D1Result;
  if (publish) {
   const row = await get(db, id);
   if (row.revision !== expected) throw new HttpError(409, '題庫已被其他分頁修改，請重新載入');
   let questions: Question[];
   try { questions = validateQuestions(JSON.parse(row.questions)); } catch (e) { throw new HttpError(400, (e as Error).message); }
   if (questions.at(-1)?.round !== 3) throw new HttpError(400, '正式題庫須包含第1、2、3回合，每回合至少一題');
   // One conditional statement atomically copies the draft. Publishing consumes a revision too.
   result = await db.prepare(`UPDATE question_banks SET published_questions=questions,published_title=title,
    published_revision=revision+1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived_at IS NULL`).bind(now, id, expected).run();
  } else if (req.method === 'PUT') {
   const value = draft(data);
   result = await db.prepare('UPDATE question_banks SET title=?,description=?,questions=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived_at IS NULL')
    .bind(value.title, value.description, value.questions, now, id, expected).run();
  } else {
   result = await db.prepare('UPDATE question_banks SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND archived_at IS NULL').bind(now, now, id, expected).run();
  }
  if (result.meta.changes !== 1) {
   await get(db, id); throw new HttpError(409, '題庫已被其他分頁修改，請重新載入；目前內容未被覆蓋');
  }
  return req.method === 'DELETE' ? json({ archived: true }) : json(detail(await get(db, id)));
 }
 throw new HttpError(405, '不支援的操作');
}
