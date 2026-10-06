import { DurableObject } from 'cloudflare:workers';
import { consumeBucket } from './security.ts';
import type { Env } from './index.ts';
// A fixed directory stops unauthenticated probes allocating arbitrary room objects.
export class RoomDirectory extends DurableObject<Env> {
 constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS rooms_recent ON rooms(expires DESC,id DESC)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS known_rooms (id TEXT PRIMARY KEY)');
  ctx.storage.sql.exec('INSERT OR IGNORE INTO known_rooms SELECT id FROM rooms');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS admin_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, secret_hash TEXT NOT NULL)');
 }
 register(id: string, expires: number): boolean {
  this.prune();
  if (this.hasRoom(id)) return false;
  this.ctx.storage.transactionSync(() => {
   this.ctx.storage.sql.exec('INSERT INTO known_rooms VALUES (?)', id);
   this.ctx.storage.sql.exec('INSERT INTO rooms VALUES (?,?)', id, expires);
  }); return true;
 }
 hasRoom(id: string): boolean { return !!this.ctx.storage.sql.exec('SELECT id FROM known_rooms WHERE id=?', id).toArray().length; }
 listRooms(cursor?: { expires: number; roomId: string }): { rooms: { roomId: string; expires: number }[]; nextCursor: string | null } {
  const rows = cursor
   ? this.ctx.storage.sql.exec<{ id: string; expires: number }>('SELECT id,expires FROM rooms WHERE expires>? AND (expires<? OR (expires=? AND id<?)) ORDER BY expires DESC,id DESC LIMIT 11', Date.now(), cursor.expires, cursor.expires, cursor.roomId).toArray()
   : this.ctx.storage.sql.exec<{ id: string; expires: number }>('SELECT id,expires FROM rooms WHERE expires>? ORDER BY expires DESC,id DESC LIMIT 11', Date.now()).toArray();
  const page = rows.slice(0, 10), last = page.at(-1);
  return { rooms: page.map(row => ({ roomId: row.id, expires: row.expires })), nextCursor: rows.length > 10 && last ? `${last.expires}.${last.id}` : null };
 }
 private prune() {
  const now = Date.now();
  this.ctx.storage.sql.exec('DELETE FROM rooms WHERE expires<=?', now);
  this.ctx.storage.sql.exec('DELETE FROM limits WHERE start<=?', now - 60000);
  this.ctx.storage.sql.exec('DELETE FROM admin_sessions WHERE expires<=?', now);
 }
 adminSessionCreate(hash: string, expires: number, secretHash: string) {
  this.prune();
  if (this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM admin_sessions').toArray()[0].n >= 100) throw new Error('Too many admin sessions');
  this.ctx.storage.sql.exec('INSERT INTO admin_sessions VALUES (?,?,?)', hash, expires, secretHash);
 }
 adminSessionValid(hash: string, secretHash: string): boolean {
  return this.adminSessionExpires(hash, secretHash) !== null;
 }
 adminSessionExpires(hash: string, secretHash: string): number | null {
  this.prune();
  return this.ctx.storage.sql.exec<{ expires: number }>('SELECT expires FROM admin_sessions WHERE hash=? AND secret_hash=?', hash, secretHash).toArray()[0]?.expires ?? null;
 }
 adminSessionRevoke(hash: string) { this.ctx.storage.sql.exec('DELETE FROM admin_sessions WHERE hash=?', hash); }
 gate(ipHash: string, kind: 'create' | 'join' | 'socket' | 'login' | 'admin', room?: string): number {
  this.prune();
  const limit = kind === 'create' || kind === 'login' ? 5 : kind === 'join' ? 30 : kind === 'admin' ? 120 : 90;
  const key = kind + ':' + ipHash;
  const old = this.ctx.storage.sql.exec<{ start: number; count: number }>('SELECT start,count FROM limits WHERE key=?', key).toArray()[0];
  const { bucket, allowed } = consumeBucket(old, Date.now(), limit, 60000);
  if (!allowed) return 429;
  this.ctx.storage.sql.exec('INSERT OR REPLACE INTO limits VALUES (?,?,?)', key, bucket.start, bucket.count);
  if (room && !this.ctx.storage.sql.exec('SELECT id FROM rooms WHERE id=?', room).toArray().length) return 404;
  return 200;
 }
}
