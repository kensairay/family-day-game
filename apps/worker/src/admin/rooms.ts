import type { Env } from '../index.ts';
import type { RoomList, RoomListEntry } from '../../../../packages/shared/src/rooms.ts';
import { validRoom } from '../../../../packages/shared/src/protocol.ts';
import { HttpError, json } from '../security.ts';
// index.ts checks the administrator session before this read-only route.
export async function roomsRoute(req: Request, env: Env): Promise<Response> {
 const url = new URL(req.url);
 if (req.method !== 'GET') throw new HttpError(405, '不支援的操作');
 const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory-v1'));
 if (url.pathname === '/api/admin/rooms') {
  const raw = url.searchParams.get('cursor');
  let cursor: { expires: number; roomId: string } | undefined;
  if (raw !== null) {
   const match = raw.match(/^(\d{1,16})\.([A-HJ-NP-Z2-9]{8})$/);
   if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) throw new HttpError(400, '分頁格式錯誤');
   cursor = { expires: Number(match[1]), roomId: match[2] };
  }
  const page = await directory.listRooms(cursor);
  // At most ten independent room RPCs per page. A single room that cannot
  // respond is marked unavailable instead of hiding all the other rooms.
  const results = await Promise.allSettled(page.rooms.map(room => env.ROOMS.get(env.ROOMS.idFromName(room.roomId)).roomStatus()));
  const rooms: RoomListEntry[] = page.rooms.map((room, i) => ({ ...room, status: results[i].status === 'fulfilled' ? results[i].value : null }));
  return json({ rooms, nextCursor: page.nextCursor, checkedAt: Date.now() } satisfies RoomList);
 }
 const match = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/);
 if (!match || !validRoom(match[1])) throw new HttpError(404, '找不到房間');
 const room = match[1];
 // Never allocate objects for arbitrary room IDs, even for authenticated users.
 if (!await directory.hasRoom(room)) throw new HttpError(404, '房間不存在');
 const status = await env.ROOMS.get(env.ROOMS.idFromName(room)).roomStatus();
 if (!status) throw new HttpError(404, '房間尚未完成建立');
 return json(status);
}
