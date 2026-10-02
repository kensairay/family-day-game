import { DurableObject } from 'cloudflare:workers';
import { nickname, validRoom, type Player, type Snapshot } from '../../../packages/shared/src/protocol.ts';
interface Env { ROOMS: DurableObjectNamespace<GameRoom>; ASSETS: Fetcher; ADMIN_SECRET?: string }
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const token=()=>crypto.randomUUID()+crypto.randomUUID();
async function digest(s:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))), b=>b.toString(16).padStart(2,'0')).join(''); }
function sameOrigin(req:Request) { const origin=req.headers.get('Origin'); return origin===new URL(req.url).origin; }
async function body(req:Request) { const raw=await req.text(); if(raw.length>4096) throw new Error('資料過大'); return JSON.parse(raw); }
export default {
 async fetch(req:Request,env:Env):Promise<Response> {
  const url=new URL(req.url);
  if(!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
  try {
   if(req.method==='POST' && !sameOrigin(req)) return json({error:'來源驗證失敗'},403);
   if(url.pathname==='/api/rooms' && req.method==='POST') {
    if(!env.ADMIN_SECRET || env.ADMIN_SECRET.length<24) return json({error:'尚未設定管理密碼'},503);
    if(req.headers.get('Authorization')!==`Bearer ${env.ADMIN_SECRET}`) return json({error:'管理密碼錯誤'},401);
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for(let attempt=0;attempt<5;attempt++) {
     const id=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b%32]).join('');
     const hostToken=token();
     const response=await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request('https://room/init',{method:'POST',body:JSON.stringify({id,hash:await digest(hostToken)})}));
     if(response.status===409) continue;
     if(!response.ok) return response;
     return json({roomId:id,hostToken},201);
    }
    return json({error:'請稍後再建立房間'},503);
   }
   const match=url.pathname.match(/^\/api\/rooms\/([^/]+)\/(join|socket)$/);
   if(!match || !validRoom(match[1])) return json({error:'找不到房間'},404);
   if(match[2]==='socket' && (!sameOrigin(req)||req.headers.get('Upgrade')?.toLowerCase()!=='websocket')) return json({error:'連線來源錯誤'},403);
   if(match[2]==='join' && req.method!=='POST') return json({error:'不支援的操作'},405);
   return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);
  } catch { return json({error:'請檢查輸入資料'},400); }
 }
};
type Attachment={role:'host'|'player';id:string;closed?:boolean};
export class GameRoom extends DurableObject<Env> {
 constructor(ctx:DurableObjectState,env:Env) {
  super(ctx,env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, hash TEXT UNIQUE NOT NULL)');
 }
 private get(key:string):string|undefined { return this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM meta WHERE key=?',key).toArray()[0]?.value; }
 private set(key:string,value:string) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta VALUES (?,?)',key,value); }
 private players():Player[] { return this.ctx.storage.sql.exec<Player & Record<string,SqlStorageValue>>('SELECT id,nickname FROM players ORDER BY rowid').toArray(); }
 private snapshot(a:Attachment):Snapshot {
  const players=this.players();
  const ids=new Set(this.ctx.getWebSockets().filter(ws=>ws.readyState===1).map(ws=>ws.deserializeAttachment() as Attachment).filter(x=>x.role==='player'&&!x.closed).map(x=>x.id));
  return {protocol:1,type:'state.snapshot',roomId:this.get('id')!,phase:'LOBBY',version:Number(this.get('version')??0),serverTime:Date.now(),joined:players.length,online:ids.size,...(a.role==='host'?{players}:{self:players.find(p=>p.id===a.id)})};
 }
 private broadcast() { for(const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify(this.snapshot(ws.deserializeAttachment()))); } catch { /* closed socket */ } } }
 async fetch(req:Request):Promise<Response> {
  const url=new URL(req.url);
  if(url.pathname==='/init') {
   if(this.get('id')) return json({error:'房間已存在'},409);
   const data=await req.json() as {id:string;hash:string};
   this.ctx.storage.transactionSync(()=>{this.set('id',data.id);this.set('host',data.hash);this.set('version','0');});
   return json({ok:true});
  }
  if(!this.get('id')) return json({error:'房間不存在'},404);
  if(url.pathname.endsWith('/join')) {
   try {
    const name=nickname((await body(req)).nickname);
    if(this.players().length>=350) return json({error:'房間人數已滿'},409);
    const id=crypto.randomUUID(),credential=token(),hash=await digest(credential);
    // Recheck after await to make concurrent join capacity enforcement atomic.
    const added=this.ctx.storage.transactionSync(()=>{
     if(this.players().length>=350) return false;
     this.ctx.storage.sql.exec('INSERT INTO players VALUES (?,?,?)',id,name,hash);
     this.set('version',String(Number(this.get('version'))+1));return true;
    });
    if(!added) return json({error:'房間人數已滿'},409);
    this.broadcast();return json({playerId:id,playerToken:credential,nickname:name},201);
   } catch(e) { return json({error:e instanceof Error?e.message:'輸入錯誤'},400); }
  }
  const protocols=req.headers.get('Sec-WebSocket-Protocol')?.split(',').map(x=>x.trim())??[];
  const credential=protocols.find(p=>p.startsWith('auth.'))?.slice(5);
  if(!credential || credential.length>200 || !protocols.includes('family.v1')) return json({error:'需要連線憑證'},401);
  const hash=await digest(credential);
  let attachment:Attachment;
  if(hash===this.get('host')) attachment={role:'host',id:'host'};
  else {
   const p=this.ctx.storage.sql.exec<{id:string}>('SELECT id FROM players WHERE hash=?',hash).toArray()[0];
   if(!p) return json({error:'憑證失效'},401);
   attachment={role:'player',id:p.id};
  }
  for(const old of this.ctx.getWebSockets()) { const a=old.deserializeAttachment() as Attachment; if(a.role===attachment.role&&a.id===attachment.id) {old.serializeAttachment({...a,closed:true});old.send(JSON.stringify({protocol:1,type:'session.replaced'}));old.close(4001,'已在其他分頁連線');} }
  const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment(attachment);this.broadcast();
  return new Response(null,{status:101,webSocket:pair[0],headers:{'Sec-WebSocket-Protocol':'family.v1'}});
 }
 webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer) {
  try {
   if((ws.deserializeAttachment() as Attachment).closed) return;
   if(typeof raw!=='string'||raw.length>2048) throw new Error();
   const msg=JSON.parse(raw); if(msg.protocol===1&&msg.type==='session.leave'){ws.serializeAttachment({...ws.deserializeAttachment(),closed:true});this.broadcast();ws.close(1000,'離開房間');return;} if(msg.protocol!==1||msg.type!=='state.sync') throw new Error();
   ws.send(JSON.stringify(this.snapshot(ws.deserializeAttachment())));
  } catch { ws.send(JSON.stringify({protocol:1,type:'error',error:'無效訊息'})); }
 }
 webSocketClose(ws:WebSocket, code:number, reason:string) { ws.serializeAttachment({...ws.deserializeAttachment(),closed:true}); ws.close(code,reason); this.broadcast(); }
 webSocketError(ws:WebSocket) { ws.close(1011,'連線錯誤');this.broadcast(); }
}
