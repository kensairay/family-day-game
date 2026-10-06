import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../index.ts';
import { consumeBucket, credential, digest, failure, HttpError, json, readJSON } from '../security.ts';
import { nickname, validId, type HostAction, type Player, type Question, type Snapshot } from '../../../../packages/shared/src/protocol.ts';
import { canAnswer, initialState, settleDeadline, standings, transition, type GameState } from './engine.ts';
import { fixtureDisplayQuestions } from './legacy-test-fixture.ts';
import type { ArchiveStatus, ArchiveReason, BankSource } from '../../../../packages/shared/src/results.ts';
import type { RoomStatus } from '../../../../packages/shared/src/rooms.ts';
import { ARCHIVE_CHUNK, ARCHIVE_BATCHES, retryDelay, writeArchiveChunk, type ArchiveHeader, type ArchivePlayer } from '../results/writer.ts';

type Attachment = { role: 'host' | 'player'; id: string; closed?: boolean; lease: number };
type Row = { id: string; nickname: string; activated: number; pendingUntil: number; hash: string };
type Answer = { player: string; questionIndex: number; option: number; earned: number; requestId: string; received: number };
const CAPACITY = 350;
const PENDING_MS = 60_000;
const LEASE_MS = 90_000;

export class GameRoom extends DurableObject<Env> {
  private broadcastTimer?: ReturnType<typeof setTimeout>;
  private archiveInFlight = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, hash TEXT UNIQUE NOT NULL)');
    const cols = new Set(ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(players)').toArray().map(c => c.name));
    if (!cols.has('activated')) ctx.storage.sql.exec('ALTER TABLE players ADD COLUMN activated INTEGER NOT NULL DEFAULT 0');
    if (!cols.has('pendingUntil')) ctx.storage.sql.exec('ALTER TABLE players ADD COLUMN pendingUntil INTEGER NOT NULL DEFAULT 0');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS answers (player TEXT NOT NULL, questionIndex INTEGER NOT NULL, option INTEGER NOT NULL, earned INTEGER NOT NULL, requestId TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(player,questionIndex), UNIQUE(player,requestId))');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, received INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');
  }
  private get(key: string): string | undefined { return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key=?', key).toArray()[0]?.value; }
  private set(key: string, value: string) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta VALUES (?,?)', key, value); }
  private state(): GameState { return JSON.parse(this.get('state') ?? JSON.stringify(initialState())); }
  private save(state: GameState) { this.set('state', JSON.stringify(state)); }
  private questions(): Question[] { return JSON.parse(this.get('questions') ?? '[]'); }
  private archiveJob(): (ArchiveStatus & { cutoff: number }) | undefined {
    const raw = this.get('archive'); return raw ? JSON.parse(raw) : undefined;
  }
  archiveStatus(): ArchiveStatus | null {
    if (!this.get('id')) throw new HttpError(404, '房間不存在');
    const job = this.archiveJob(); if (!job) return null;
    const { cutoff: _, ...status } = job; return status;
  }
  archiveInfo(): { exists: boolean; archive: ArchiveStatus | null } {
    return { exists: !!this.get('id'), archive: this.get('id') ? this.archiveStatus() : null };
  }
  roomStatus(): RoomStatus | null {
    const roomId = this.get('id'); if (!roomId) return null;
    const now = Date.now(), expires = Number(this.get('expires') ?? 0);
    const state = settleDeadline(this.state(), now), questions = this.questions();
    const lifecycle = expires <= now ? 'expired' : state.phase === 'CLOSED' ? 'closed' : state.phase === 'FINISHED' ? 'finished' : 'open';
    const sockets = this.activeSockets().map(ws => ws.deserializeAttachment() as Attachment);
    const terminal = lifecycle === 'closed' || lifecycle === 'expired';
    return {
      roomId, source: JSON.parse(this.get('source') ?? '{"bankId":null,"revision":null,"title":"舊版／本機題庫"}'),
      phase: terminal ? 'CLOSED' : state.phase, lifecycle, version: state.version,
      createdAt: Number(this.get('createdAt') ?? expires - 86400000), startedAt: this.get('startedAt') ? Number(this.get('startedAt')) : null,
      expires, checkedAt: now, online: terminal ? 0 : new Set(sockets.filter(a => a.role === 'player').map(a => a.id)).size,
      hostOnline: !terminal && sockets.some(a => a.role === 'host'),
      joined: this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE activated=1').one().n,
      questionIndex: state.index, questionCount: questions.length, round: questions[state.index]?.round ?? null,
      deadline: terminal ? null : state.deadline, revealedCount: Math.max(0, state.revealedThrough + 1), archive: this.archiveStatus(),
    };
  }
  private queueArchive(state: GameState, reason: ArchiveReason) {
    if (this.archiveJob()) return;
    const playerCount = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE activated=1').one().n;
    this.set('archive', JSON.stringify({ id: crypto.randomUUID(), status: 'pending', attempts: 0, nextRetryAt: Date.now() + 25,
      cursor: 0, playerCount, finalVersion: state.version, endedAt: Date.now(), reason, cutoff: state.revealedThrough }));
  }
  private archiveHeader(job: ArchiveStatus & { cutoff: number }): ArchiveHeader {
    const questions = this.questions();
    return { id: job.id, roomId: this.get('id')!, source: JSON.parse(this.get('source') ?? '{"bankId":null,"revision":null,"title":"舊版／本機題庫"}') as BankSource,
      createdAt: Number(this.get('createdAt') ?? 0), startedAt: this.get('startedAt') ? Number(this.get('startedAt')) : null,
      endedAt: job.endedAt, finalVersion: job.finalVersion, reason: job.reason,
      scoredQuestionCount: Math.max(0, Math.min(questions.length, job.cutoff + 1)), playerCount: job.playerCount, questions };
  }
  private archivePlayers(job: ArchiveStatus & { cutoff: number }): ArchivePlayer[] {
    const questions = this.questions();
    const scores = this.ctx.storage.sql.exec<Player & Record<string, SqlStorageValue>>('SELECT p.id,p.nickname,COALESCE(SUM(a.earned),0) AS score FROM players p LEFT JOIN answers a ON a.player=p.id AND a.questionIndex<=? WHERE p.activated=1 GROUP BY p.id', job.cutoff).toArray();
    return standings(scores).slice(job.cursor, job.cursor + ARCHIVE_CHUNK).map(p => {
      const answers = this.ctx.storage.sql.exec<Answer>('SELECT * FROM answers WHERE player=? ORDER BY questionIndex', p.id).toArray();
      const rounds = [0, 0, 0];
      for (const answer of answers) if (answer.questionIndex <= job.cutoff) rounds[questions[answer.questionIndex].round - 1] += answer.earned;
      return { playerId: p.id, nickname: p.nickname, rank: p.rank, score: p.score, round1: rounds[0], round2: rounds[1], round3: rounds[2], answered: answers.length,
        answers: answers.map(a => ({ questionIndex: a.questionIndex, option: a.option, earned: a.earned, counted: a.questionIndex <= job.cutoff, received: a.received })) };
    });
  }
  private async flushArchive() {
    const queued = this.archiveJob();
    if (this.archiveInFlight || !queued || queued.status !== 'pending' || (queued.nextRetryAt ?? 0) > Date.now()) return;
    this.archiveInFlight = true;
    try {
      // Persist a safety wake-up before external I/O. A crash after a D1 commit must not strand the outbox.
      queued.nextRetryAt = Date.now() + 60000; this.set('archive', JSON.stringify(queued)); await this.scheduleAlarm();
      if (!this.env.DB) throw new Error('D1 unavailable');
      for (let n = 0; n < ARCHIVE_BATCHES; n++) {
        const job = this.archiveJob()!; const chunk = this.archivePlayers(job); const final = job.cursor + chunk.length >= job.playerCount;
        if (chunk.length === 0 && job.cursor < job.playerCount) throw new Error('Archive source missing');
        const ready = await writeArchiveChunk(this.env.DB, this.archiveHeader(job), chunk, final);
        if (final && !ready) throw new Error('Incomplete archive');
        job.cursor = ready ? job.playerCount : job.cursor + chunk.length; job.status = ready ? 'complete' : 'pending'; job.nextRetryAt = ready ? null : Date.now() + 1000;
        this.set('archive', JSON.stringify(job));
        if (ready) break;
      }
    } catch {
      // Do not expose/log database errors, questions, credentials, or personal data.
      const job = this.archiveJob()!; job.attempts++; job.nextRetryAt = Date.now() + retryDelay(job.attempts); this.set('archive', JSON.stringify(job));
    } finally { this.archiveInFlight = false; }
  }
  async retryArchive(): Promise<ArchiveStatus | null> {
    this.archiveStatus(); const job = this.archiveJob();
    if (job?.status === 'pending' && !this.archiveInFlight) {
      this.allow('archive:retry', 3, 60000); job.nextRetryAt = Date.now(); this.set('archive', JSON.stringify(job));
      await this.flushArchive(); await this.scheduleAlarm();
    }
    return this.archiveStatus();
  }
  private player(id: string): Row | undefined { return this.ctx.storage.sql.exec<Row>('SELECT * FROM players WHERE id=?', id).toArray()[0]; }
  private alive() {
    if (!this.get('id')) throw new HttpError(404, '房間不存在');
    if (Date.now() >= Number(this.get('expires') ?? 0) || this.state().phase === 'CLOSED') throw new HttpError(410, '房間已關閉或到期');
  }
  private allow(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM limits WHERE start<?', now - 60_000);
    const old = this.ctx.storage.sql.exec<{ start: number; count: number }>('SELECT start,count FROM limits WHERE key=?', key).toArray()[0];
    const { allowed, bucket } = consumeBucket(old, now, limit, windowMs);
    if (!allowed) throw new HttpError(429, '操作太頻繁，請稍後再試');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO limits VALUES (?,?,?)', key, bucket.start, bucket.count);
  }
  private activeSockets() {
    const now = Date.now();
    return this.ctx.getWebSockets().filter(ws => { const a = ws.deserializeAttachment() as Attachment; return ws.readyState === 1 && !a.closed && a.lease > now; });
  }
  private invalidate(ws: WebSocket, type: string, code = 4003) {
    const a = ws.deserializeAttachment() as Attachment;
    ws.serializeAttachment({ ...a, closed: true });
    try { ws.send(JSON.stringify({ protocol: 1, type })); ws.close(code, '工作階段結束'); } catch { /* already disconnected */ }
  }
  private prune() {
    this.ctx.storage.sql.exec('DELETE FROM players WHERE activated=0 AND pendingUntil<=?', Date.now());
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.closed && a.lease <= Date.now()) this.invalidate(ws, 'session.expired');
    }
  }
  private settle(): boolean {
    const state = this.state(), next = settleDeadline(state, Date.now());
    if (state !== next) { this.save(next); return true; }
    return false;
  }
  private async scheduleAlarm() {
    const state = this.state();
    const job = this.archiveJob();
    const terminal = state.phase === 'CLOSED' || Date.now() >= Number(this.get('expires') ?? 0);
    if (terminal && job?.status !== 'pending') { await this.ctx.storage.deleteAlarm(); return; }
    const pending = this.ctx.storage.sql.exec<{ due: number | null }>('SELECT MIN(pendingUntil) AS due FROM players WHERE activated=0').one().due;
    const leases = this.ctx.getWebSockets().map(ws => ws.deserializeAttachment() as Attachment).filter(a => !a.closed).map(a => a.lease);
    const candidates: number[] = [];
    if (job?.status === 'pending') candidates.push(job.nextRetryAt ?? Date.now() + 1000);
    if (!terminal) candidates.push(Number(this.get('expires') ?? Date.now() + 86400000));
    if (!terminal && pending) candidates.push(pending);
    if (!terminal && state.phase === 'QUESTION_OPEN' && state.deadline) candidates.push(state.deadline);
    if (!terminal && leases.length) candidates.push(Math.min(...leases));
    const due = Math.max(Date.now() + 25, Math.min(...candidates));
    // Keep an earlier scheduled alarm; it will reconsider all persisted deadlines.
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || due < existing) await this.ctx.storage.setAlarm(due);
  }
  private commonSnapshot() {
    const state = this.state();
    const source = this.get('source');
    const q = fixtureDisplayQuestions(this.env.DEPLOYMENT_ENV, source ? JSON.parse(source) as BankSource : undefined, this.questions())[state.index];
    const players = this.ctx.storage.sql.exec<Player & Record<string, SqlStorageValue>>(
      'SELECT p.id,p.nickname,COALESCE(SUM(a.earned),0) AS score FROM players p LEFT JOIN answers a ON a.player=p.id AND a.questionIndex<=? WHERE p.activated=1 GROUP BY p.id ORDER BY p.rowid', state.revealedThrough,
    ).toArray();
    const answers = new Map(this.ctx.storage.sql.exec<Answer>('SELECT * FROM answers WHERE questionIndex=?', state.index).toArray().map(a => [a.player, a]));
    const online = new Set(this.activeSockets().map(ws => ws.deserializeAttachment() as Attachment).filter(a => a.role === 'player').map(a => a.id)).size;
    const common = {
      protocol: 1 as const, type: 'state.snapshot' as const, roomId: this.get('id')!, phase: state.phase, version: state.version,
      serverTime: Date.now(), online, joined: players.length, questionIndex: state.index, questionCount: this.questions().length,
      deadline: state.deadline, leaderboard: standings(players).slice(0, 10),
      ...(q ? { question: { id: q.id, round: q.round, text: q.text, options: q.options, seconds: q.seconds, points: q.points,
        ...(state.revealedThrough >= state.index ? { correct: q.correct } : {}) } } : {}),
    };
    return { common, players, playerMap: new Map(players.map(p => [p.id, p])), answers, state };
  }
  private snapshot(a: Attachment, bundle = this.commonSnapshot()): Snapshot {
    if (a.role === 'host') return { ...bundle.common, players: bundle.players, ...(this.archiveStatus() ? { archive: this.archiveStatus()! } : {}) };
    const p = bundle.playerMap.get(a.id), answer = bundle.answers.get(a.id);
    return { ...bundle.common, ...(p ? { self: { ...p, ...(answer ? { answer: answer.option,
      ...(bundle.state.revealedThrough >= bundle.state.index ? { earned: answer.earned } : {}) } : {}) } } : {}) };
  }
  private send(ws: WebSocket, data: unknown) { try { ws.send(JSON.stringify(data)); } catch { /* recovery on next reconnect */ } }
  private broadcast() {
    // Compute SQL totals, answers and online count once, not once per recipient.
    const bundle = this.commonSnapshot();
    for (const ws of this.activeSockets()) this.send(ws, this.snapshot(ws.deserializeAttachment(), bundle));
  }
  private broadcastPresence() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => { this.broadcastTimer = undefined; this.broadcast(); }, 250);
  }
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname === '/init') {
        const data = await req.json() as { id: string; hostHash: string; expires: number; questions: Question[]; source?: BankSource; createdAt?: number };
        const created = this.ctx.storage.transactionSync(() => {
          if (this.get('id')) return false;
          this.set('id', data.id); this.set('host', data.hostHash); this.set('expires', String(data.expires));
          this.set('createdAt', String(data.createdAt ?? Date.now()));
          this.set('source', JSON.stringify(data.source ?? { bankId: null, revision: null, title: '本機題庫' }));
          this.set('questions', JSON.stringify(data.questions)); this.save(initialState()); return true;
        });
        if (!created) throw new HttpError(409, '房間已存在');
        await this.scheduleAlarm(); return json({ ok: true });
      }
      this.alive(); this.prune();
      if (this.settle()) this.broadcast();
      if (url.pathname === '/join') {
        if (this.state().phase !== 'LOBBY') throw new HttpError(409, '遊戲已開始，停止新玩家加入');
        let name;
        try { name = nickname((await readJSON(req, 4096)).nickname); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, (e as Error).message); }
        const id = crypto.randomUUID(), token = credential(), hash = await digest(token);
        this.ctx.storage.transactionSync(() => {
          // Recheck lifecycle after asynchronous credential hashing.
          this.alive(); this.prune();
          if (this.state().phase !== 'LOBBY') throw new HttpError(409, '遊戲已開始');
          if (this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM players').one().n >= CAPACITY) throw new HttpError(409, '房間人數已滿');
          this.ctx.storage.sql.exec('INSERT INTO players(id,nickname,hash,activated,pendingUntil) VALUES (?,?,?,0,?)', id, name, hash, Date.now() + PENDING_MS);
        });
        await this.scheduleAlarm(); return json({ playerId: id, playerToken: token, nickname: name, pendingSeconds: 60 }, 201);
      }
      const protocols = req.headers.get('Sec-WebSocket-Protocol')?.split(',').map(p => p.trim()) ?? [];
      const diagnostic = url.pathname.endsWith('/connection');
      const token = diagnostic ? req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1] : protocols.find(p => p.startsWith('auth.'))?.slice(5);
      if (!token || !/^[a-f0-9-]{72}$/.test(token) || (!diagnostic && !protocols.includes('family.v1'))) throw new HttpError(401, '需要有效連線憑證');
      const hash = await digest(token); this.alive(); this.prune();
      let a: Attachment;
      if (hash === this.get('host')) a = { role: 'host', id: 'host', lease: Date.now() + LEASE_MS };
      else {
        const p = this.ctx.storage.sql.exec<Row>('SELECT * FROM players WHERE hash=?', hash).toArray()[0];
        if (!p) throw new HttpError(401, '憑證失效或已撤銷');
        if (!p.activated && this.state().phase !== 'LOBBY') throw new HttpError(409, '遊戲已開始，名額尚未完成確認');
        a = { role: 'player', id: p.id, lease: Date.now() + LEASE_MS };
      }
      // Diagnose failed upgrades over HTTPS without replacing a session,
      // activating a player, renewing a lease, or exposing room contents.
      if (diagnostic) return json({ ok: true, role: a.role });
      this.allow('reconnect:' + a.id, 6, 60_000);
      for (const ws of this.ctx.getWebSockets()) {
        const old = ws.deserializeAttachment() as Attachment;
        if (!old.closed && old.role === a.role && old.id === a.id) this.invalidate(ws, 'session.replaced', 4001);
      }
      const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(a);
      if (a.role === 'player') this.ctx.storage.sql.exec('UPDATE players SET activated=1 WHERE id=?', a.id);
      this.send(pair[1], this.snapshot(a)); this.broadcastPresence();
      await this.scheduleAlarm();
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'family.v1' } });
    } catch (error) { return failure(error); }
  }
  private answer(ws: WebSocket, a: Attachment, msg: Record<string, unknown>) {
    if (a.role !== 'player') throw new HttpError(403, '只有玩家可以提交答案');
    if (!validId(msg.requestId)) throw new HttpError(400, '答案請求ID格式錯誤');
    this.allow('answer:' + a.id, 10, 10_000);
    let accepted: Answer;
    accepted = this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<Answer>('SELECT * FROM answers WHERE player=? AND requestId=?', a.id, msg.requestId as string).toArray()[0];
      const state = this.state(), questions = this.questions();
      if (previous) {
        if (questions[previous.questionIndex]?.id !== msg.questionId || previous.option !== msg.option) throw new HttpError(409, '請求ID已被其他答案使用');
        return previous;
      }
      if (!canAnswer(state, msg.questionId, msg.option, questions, Date.now())) throw new HttpError(409, '題目已截止或答案格式錯誤');
      if (this.ctx.storage.sql.exec('SELECT player FROM answers WHERE player=? AND questionIndex=?', a.id, state.index).toArray().length) throw new HttpError(409, '這題已經提交答案');
      const q = questions[state.index];
      const row: Answer = { player: a.id, questionIndex: state.index, option: msg.option as number, earned: q.correct === msg.option ? q.points : 0, requestId: msg.requestId as string, received: Date.now() };
      this.ctx.storage.sql.exec('INSERT INTO answers VALUES (?,?,?,?,?,?)', row.player, row.questionIndex, row.option, row.earned, row.requestId, row.received);
      return row;
    });
    // No correct flag or earned points before host reveals the answer.
    this.send(ws, { protocol: 1, type: 'answer.ack', requestId: accepted.requestId, questionId: msg.questionId, option: accepted.option });
  }
  private command(ws: WebSocket, a: Attachment, msg: Record<string, unknown>) {
    if (a.role !== 'host') throw new HttpError(403, '只有主持人可以控制遊戲');
    if (!validId(msg.commandId) || !Number.isInteger(msg.expectedVersion)) throw new HttpError(400, '指令格式錯誤');
    const fingerprint = JSON.stringify([msg.action, msg.expectedVersion, msg.playerId ?? null]);
    this.allow('command:host', 30, 60_000);
    let removed: string | undefined;
    const version = this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<{ fingerprint: string; version: number }>('SELECT fingerprint,version FROM commands WHERE id=?', msg.commandId as string).toArray()[0];
      if (previous) { if (previous.fingerprint !== fingerprint) throw new HttpError(409, '指令ID已被使用'); return previous.version; }
      const state = this.state();
      if (state.version !== msg.expectedVersion) throw new HttpError(409, '房間狀態已更新，請重新操作');
      let next: GameState;
      if (msg.action === 'removePlayer') {
        if (state.phase !== 'LOBBY' || !validId(msg.playerId) || !this.player(msg.playerId)) throw new HttpError(409, '只能在等待階段移除現有玩家');
        removed = msg.playerId;
        this.ctx.storage.sql.exec('DELETE FROM players WHERE id=?', removed); next = { ...state, version: state.version + 1 };
      } else {
        try { next = transition(state, msg.action as HostAction, this.questions(), Date.now()); } catch (e) { throw new HttpError(409, (e as Error).message); }
      }
      this.save(next);
      if (msg.action === 'start' && state.phase === 'LOBBY') this.set('startedAt', String(Date.now()));
      if (next.phase === 'FINISHED') this.queueArchive(next, msg.action === 'end' ? 'ended' : 'completed');
      if (next.phase === 'CLOSED') this.queueArchive(next, 'closed');
      this.ctx.storage.sql.exec('INSERT INTO commands VALUES (?,?,?,?)', msg.commandId as string, fingerprint, next.version, Date.now());
      return next.version;
    });
    if (removed) for (const other of this.ctx.getWebSockets()) { const who = other.deserializeAttachment() as Attachment; if (who.id === removed && who.role === 'player') this.invalidate(other, 'session.revoked'); }
    this.send(ws, { protocol: 1, type: 'command.ack', commandId: msg.commandId, version });
    this.broadcast();
    if (this.state().phase === 'CLOSED') for (const other of this.ctx.getWebSockets()) this.invalidate(other, 'room.closed');
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment;
    if (a.closed) return;
    let requestId: unknown, commandId: unknown;
    try {
      this.alive();
      if (a.lease <= Date.now()) throw new HttpError(401, '連線已到期');
      if (a.role === 'player' && !this.player(a.id)) throw new HttpError(401, '憑證已撤銷');
      this.allow('messages:' + a.id, 90, 60_000);
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 2048) throw new HttpError(413, '訊息過大');
      let msg;
      try { msg = JSON.parse(raw); } catch { throw new HttpError(400, '訊息格式錯誤'); }
      if (!msg || typeof msg !== 'object' || msg.protocol !== 1) throw new HttpError(400, '協定版本錯誤');
      requestId = msg.requestId; commandId = msg.commandId;
      if (this.settle()) this.broadcast();
      a.lease = Date.now() + LEASE_MS; ws.serializeAttachment(a);
      if (msg.type === 'session.leave') { this.invalidate(ws, 'session.left', 1000); this.broadcastPresence(); }
      else if (msg.type === 'ping') this.send(ws, { protocol: 1, type: 'pong', serverTime: Date.now() });
      else if (msg.type === 'state.sync') { this.allow('sync:' + a.id, 6, 10_000); this.send(ws, this.snapshot(a)); }
      else if (msg.type === 'answer.submit') this.answer(ws, a, msg);
      else if (msg.type === 'host.command') this.command(ws, a, msg);
      else throw new HttpError(400, '未知的訊息類型');
      await this.scheduleAlarm();
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      this.send(ws, { protocol: 1, type: 'error', status, error: error instanceof HttpError ? error.message : '操作失敗',
        ...(validId(requestId) ? { requestId } : {}), ...(validId(commandId) ? { commandId } : {}) });
      if ([401, 410, 413, 429].includes(status)) { this.invalidate(ws, status === 429 ? 'session.throttled' : 'session.expired'); this.broadcastPresence(); }
      // A stale command/deadline rejection is followed by a current snapshot for UI recovery.
      else this.send(ws, this.snapshot(a));
    }
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    const a = ws.deserializeAttachment() as Attachment; ws.serializeAttachment({ ...a, closed: true });
    try { ws.close(code, reason); } catch { /* already closed */ } this.broadcastPresence();
  }
  webSocketError(ws: WebSocket) { this.invalidate(ws, 'session.expired'); this.broadcastPresence(); }
  async alarm() {
    if (Date.now() >= Number(this.get('expires') ?? 0)) {
      this.ctx.storage.transactionSync(() => {
        const state = this.state();
        const next = state.phase === 'CLOSED' ? state : { ...state, phase: 'CLOSED' as const, deadline: null, version: state.version + 1 };
        this.save(next); this.queueArchive(next, state.phase === 'FINISHED' ? 'completed' : 'expired');
      });
      for (const ws of this.ctx.getWebSockets()) this.invalidate(ws, 'room.closed');
    } else {
      this.prune(); this.settle();
    }
    await this.flushArchive();
    if (this.state().phase !== 'CLOSED') this.broadcast();
    await this.scheduleAlarm();
  }
}
