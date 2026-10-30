import {DurableObject} from 'cloudflare:workers';
import {freshGame, join, answer, command, claimPrize, snapshot, getPlayer, GameError, questionsFor, sessionFor} from './game.js';

import {validateBank,BankValidationError} from '../shared/question-bank.js';

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const bearer = req => req.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
const validHost = (env, key) => typeof env.HOST_KEY === 'string' && env.HOST_KEY.length >= 16 && key === env.HOST_KEY;
async function readBody(request,limit=4096) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new GameError('請使用 JSON 請求',415);
  if(Number(request.headers.get('Content-Length'))>limit)throw new GameError('請求內容過大',413);
  const reader=request.body?.getReader(),chunks=[];let size=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new GameError('請求內容過大',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}
  catch{throw new GameError('無效的請求內容');}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/') url.pathname = '/index.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return json({error:'不接受跨網站請求'}, 403);
    if (url.pathname === '/api/config' && request.method === 'GET') return env.ROOMS.get(env.ROOMS.idFromName(env.ROOM_CODE || 'family-day')).fetch(new Request(new URL('/info',url),request));
    const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9-]{1,40})\/(join|state|answer|claim|host|export|sessions|ws)$/);
    if (!match || match[1] !== (env.ROOM_CODE || 'family-day')) return json({error:'找不到活動房間'}, 404);
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx; this.env = env; this.tail = Promise.resolve();
    this.archivePending = 0; this.archiveError = false; this.progressTimer = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const values = await ctx.storage.get(['meta','players','answers','bank']);
      this.state = values.has('meta') ? {...values.get('meta'), players:values.get('players'), answers:values.get('answers'),bank:values.get('bank') || undefined} : freshGame();
      this.archivePending = (await ctx.storage.list({prefix:'outbox:'})).size;
      if (this.archivePending) await ctx.storage.setAlarm(Date.now()+1000);
    });
  }
  serial(fn) {
    const task = this.tail.then(fn); this.tail = task.catch(() => {}); return task;
  }
  async fetch(request) {
    return this.serial(async () => {
      try { return await this.handle(request); }
      catch (error) {
        if (error instanceof GameError || error instanceof BankValidationError) return json({error:error.message,...(error.details?{details:error.details}:{}),...(error.status===401?{sessionId:sessionFor(this.state),sessionTitle:this.state.sessionTitle || '初始場次'}:{})},error.status);
        console.error('Room request failed'); return json({error:'服務暫時無法處理，請稍後重試'}, 503);
      }
    });
  }
  view(role, player = null) {
    const value = snapshot(this.state, role, player);
    if (role === 'host') {
      const currentIds=new Set(this.state.players.map(p=>p.id));
      const connected = new Set(this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()).filter(a => a?.role === 'player'&&currentIds.has(a.playerId)).map(a => a.playerId));
      value.connectedCount = connected.size;
      value.archive = {pending:this.archivePending, error:this.archiveError};
    }
    return value;
  }
  async handle(request) {
    const url = new URL(request.url), path = url.pathname.split('/').at(-1);
    const role = url.searchParams.get('role') || 'player';
    const token = bearer(request);
    if(path==='info'&&request.method==='GET')return json({room:this.env.ROOM_CODE || 'family-day',sessionId:sessionFor(this.state),sessionTitle:this.state.sessionTitle || '初始場次'});
    if (path === 'ws' && request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (this.ctx.getWebSockets().length >= 400) throw new GameError('連線暫時已滿，請稍後重試', 503);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({role:'pending', createdAt:Date.now()});
      if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+1000);
      return new Response(null, {status:101, webSocket:pair[0]});
    }
    if (path === 'join' && request.method === 'POST') {
      const body = await readBody(request);
      await this.mutate(s => join(s, body));
      return json(this.view('player', getPlayer(this.state, body.token)));
    }
    if (path === 'state' && request.method === 'GET') {
      const player = this.authorize(role, token);
      return json(this.view(role, player));
    }
    if (path === 'answer' && request.method === 'POST') {
      const player = this.authorize('player', token), body = await readBody(request);
      await this.mutate(s => answer(s, getPlayer(s, token), body), 'progress');
      return json(this.view('player', getPlayer(this.state, player.token)));
    }
    if (path === 'claim' && request.method === 'POST') {
      this.authorize('player', token); const body=await readBody(request);
      await this.mutate(s=>claimPrize(s,getPlayer(s,token),body));
      return json(this.view('player',getPlayer(this.state,token)));
    }
    if (path === 'host' && request.method === 'POST') {
      this.authorize('host', token); const body = await readBody(request,128*1024);
      if(body.action==='import-bank') {
        body.bank=validateBank(body.bank);
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body.bank)));
        body.bankDigest=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      }
      await this.mutate(s => command(s, body)); return json(this.view('host'));
    }
    if(path==='sessions'&&request.method==='GET') {
      this.authorize('host',token);
      const histories=await this.ctx.storage.list({prefix:'history:'});
      const sessions=[...histories.entries()].filter(([key])=>key.endsWith(':meta')).map(([,m])=>({id:m.sessionId,title:m.sessionTitle,phase:m.phase,playerCount:m.playerCount,closedAt:m.closedAt,closedVersion:m.version})).sort((a,b)=>a.closedVersion-b.closedVersion);
      sessions.push({id:sessionFor(this.state),title:this.state.sessionTitle || '初始場次',phase:this.state.phase,playerCount:this.state.players.length,current:true});
      return json({sessions});
    }
    if (path === 'export' && request.method === 'GET') {
      this.authorize('host', token);
      const id=url.searchParams.get('sessionId') || sessionFor(this.state);
      let source=this.state;
      if(id!==sessionFor(this.state)) {
        if(!/^(legacy|[0-9a-f-]{36})$/.test(id))throw new GameError('找不到場次',404);
        const prefix=`history:${id}:`,stored=await this.ctx.storage.get([prefix+'meta',prefix+'players',prefix+'answers']);
        if(!stored.has(prefix+'meta'))throw new GameError('找不到場次',404);
        source={...stored.get(prefix+'meta'),players:stored.get(prefix+'players'),answers:stored.get(prefix+'answers')};
      }
      const archived = await this.env.DB.prepare("SELECT event_id, occurred_at, kind, payload FROM game_events WHERE room = ? AND (json_extract(payload, '$.sessionId') = ? OR (? = 'legacy' AND json_extract(payload, '$.sessionId') IS NULL)) ORDER BY event_id").bind(this.env.ROOM_CODE || 'family-day',id,id).all();
      const events = new Map(archived.results.map(row => [row.event_id, {id:row.event_id, at:row.occurred_at, kind:row.kind, data:JSON.parse(row.payload)}]));
      for (const event of (await this.ctx.storage.list({prefix:'outbox:'})).values()) if((event.data.sessionId || 'legacy')===id)events.set(event.id,event);
      return json({room:this.env.ROOM_CODE || 'family-day',sessionId:id,state:snapshot(source,'host'),bank:questionsFor(source),players:source.players.map(({token:secret,...p}) => source.scoreMode === 'per-round' ? {...p,totalScore:p.score + Object.values(p.roundResults || {}).reduce((sum,result)=>sum+result.score,0)} : p),events:[...events.values()].sort((a,b)=>a.id-b.id)});
    }
    throw new GameError('找不到這項操作', 404);
  }
  authorize(role, token) {
    if (role === 'screen') return null;
    if (role === 'host') { if (!validHost(this.env, token)) throw new GameError('主持人登入碼不正確或尚未設定', 401); return null; }
    if (role === 'player') { const player = getPlayer(this.state, token); if (!player) throw new GameError('找不到玩家身份，請重新連線', 401); return player; }
    throw new GameError('無效的畫面角色');
  }
  async mutate(fn, mode = 'all') {
    const next = structuredClone(this.state), event = fn(next);
    if (!event) return;
    event.id = next.version;
    const {players, answers, bank, ...meta} = next;
    event.data={...event.data,sessionId:sessionFor(next)};
    // Separate values keep a 350-player room below per-value storage limits.
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+1000);
    await this.ctx.storage.transaction(async tx => {
      if(event.data.action==='new-session') {
        const previous=this.state,prefix=`history:${sessionFor(previous)}:`;
        await tx.put({
          [prefix+'meta']:{phase:previous.phase,index:previous.index,scoreMode:previous.scoreMode,voided:previous.voided || false,version:previous.version,revision:previous.revision,sessionId:sessionFor(previous),sessionTitle:previous.sessionTitle || '初始場次',publishedIds:previous.publishedIds || null,bank:questionsFor(previous),playerCount:previous.players.length,closedAt:event.at},
          [prefix+'players']:previous.players.map(({token:secret,...p})=>p),[prefix+'answers']:previous.answers
        });
      }
      await tx.put({meta,players,answers,bank:questionsFor(next),[`outbox:${String(event.id).padStart(10,'0')}`]:event});
    });
    this.state = next; this.archivePending++;
    if (mode === 'progress' || event.kind === 'joined') this.scheduleProgress();
    else this.broadcast();
  }
  scheduleProgress() {
    // Answers/join bursts update only host and projector, at most twice a second.
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null; this.broadcast(['host','screen']);
    }, 500);
  }
  notifyNewSession(ws){ws.send(JSON.stringify({type:'session-changed',sessionId:sessionFor(this.state),sessionTitle:this.state.sessionTitle || '初始場次'}));ws.close(4001,'請加入新場次');}
  broadcast(roles = ['host','screen','player']) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();
        if (!attachment || !roles.includes(attachment.role)) continue;
        const p = this.state.players.find(p => p.id === attachment.playerId);
        if(attachment.role==='player'&&!p){this.notifyNewSession(ws);continue;}
        ws.send(JSON.stringify({type:'state', state:this.view(attachment.role, p)}));
      } catch { try { ws.close(1011, '請重新連線'); } catch {} }
    }
  }
  webSocketMessage(ws, message) {
    return this.serial(async () => {
      let attemptedRole;
      try {
        if (typeof message !== 'string' || message.length > 4096) throw new GameError('無效訊息');
        const body = JSON.parse(message), previous = ws.deserializeAttachment();attemptedRole=body.role;
        if (body.type === 'auth' && previous?.role === 'pending') {
          const p = this.authorize(body.role, body.token || '');
          ws.serializeAttachment({role:body.role, playerId:p?.id || null});
          ws.send(JSON.stringify({type:'state', state:this.view(body.role, p)}));
          this.scheduleProgress();
        } else if (body.type === 'sync' && previous?.role !== 'pending') {
          const p = this.state.players.find(p => p.id === previous.playerId);
          if(previous.role==='player'&&!p){this.notifyNewSession(ws);return;}
          ws.send(JSON.stringify({type:'state', state:this.view(previous.role, p)}));
        } else throw new GameError('請先登入');
      } catch(error) {if(error.status===401 && attemptedRole==='player')this.notifyNewSession(ws);else ws.close(1008,'身份驗證失敗，請重新登入');}
    });
  }
  webSocketClose(ws, code) { try { ws.close(code, ''); } catch {} this.scheduleProgress(); }
  webSocketError(ws) { try { ws.close(1011, ''); } catch {} this.scheduleProgress(); }
  alarm() {
    return this.serial(async () => {
      const pending = await this.ctx.storage.list({prefix:'outbox:'});
      try {
        const entries = [...pending.entries()];
        for (let i=0; i<entries.length; i+=50) {
          const batch = entries.slice(i,i+50);
          await this.env.DB.batch(batch.map(([,event]) => this.env.DB.prepare('INSERT OR IGNORE INTO game_events (room, event_id, occurred_at, kind, payload) VALUES (?, ?, ?, ?, ?)').bind(this.env.ROOM_CODE || 'family-day', event.id, event.at, event.kind, JSON.stringify(event.data))));
          await this.ctx.storage.delete(batch.map(([key]) => key));
        }
        this.archiveError = false;
      } catch { this.archiveError = true; console.error('Archive unavailable; durable outbox retained'); }
      this.archivePending = (await this.ctx.storage.list({prefix:'outbox:'})).size;
      let hasPendingSocket = false;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a?.role === 'pending') {
          if (Date.now() - a.createdAt > 10000) ws.close(1008, '登入逾時');
          else hasPendingSocket = true;
        }
      }
      if (this.archivePending || hasPendingSocket) await this.ctx.storage.setAlarm(Date.now()+10000);
      this.broadcast(['host']);
    });
  }
}
