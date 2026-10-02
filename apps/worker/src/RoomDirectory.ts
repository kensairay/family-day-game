import { DurableObject } from 'cloudflare:workers';
import { consumeBucket } from './security.ts';
import type { Env } from './index.ts';
// A fixed directory stops unauthenticated probes allocating arbitrary room objects.
export class RoomDirectory extends DurableObject<Env> {
 constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');
 }
 register(id: string, expires: number): boolean {
  this.prune();
  if (this.ctx.storage.sql.exec('SELECT id FROM rooms WHERE id=?', id).toArray().length) return false;
  this.ctx.storage.sql.exec('INSERT INTO rooms VALUES (?,?)', id, expires); return true;
 }
 private prune() {
  const now = Date.now();
  this.ctx.storage.sql.exec('DELETE FROM rooms WHERE expires<=?', now);
  this.ctx.storage.sql.exec('DELETE FROM limits WHERE start<=?', now - 60000);
 }
 gate(ipHash: string, kind: 'create' | 'join' | 'socket', room?: string): number {
  this.prune();
  const limit = kind === 'create' ? 5 : kind === 'join' ? 30 : 90;
  const key = kind + ':' + ipHash;
  const old = this.ctx.storage.sql.exec<{ start: number; count: number }>('SELECT start,count FROM limits WHERE key=?', key).toArray()[0];
  const { bucket, allowed } = consumeBucket(old, Date.now(), limit, 60000);
  if (!allowed) return 429;
  this.ctx.storage.sql.exec('INSERT OR REPLACE INTO limits VALUES (?,?,?)', key, bucket.start, bucket.count);
  if (room && !this.ctx.storage.sql.exec('SELECT id FROM rooms WHERE id=?', room).toArray().length) return 404;
  return 200;
 }
}
