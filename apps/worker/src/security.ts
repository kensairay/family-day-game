export class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export const credential = () => crypto.randomUUID() + crypto.randomUUID();
export async function digest(value: string): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function readJSON(req: Request, maxBytes = 32768): Promise<Record<string, unknown>> {
 const length = req.headers.get('Content-Length');
 if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new HttpError(413, '資料過大');
 if (!req.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '需要JSON格式');
 const reader = req.body?.getReader();
 if (!reader) throw new HttpError(400, '缺少輸入資料');
 const chunks: Uint8Array[] = []; let size = 0;
 try {
  while (true) {
   const part = await reader.read(); if (part.done) break;
   size += part.value.byteLength;
   if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, '資料過大'); }
   chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value;
 } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'JSON格式錯誤'); }
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export const failure = (error: unknown) => json({ error: error instanceof HttpError ? error.message : '操作失敗，請稍後再試' }, error instanceof HttpError ? error.status : 500);
export interface Bucket { start: number; count: number }
export function consumeBucket(previous: Bucket | undefined, now: number, limit: number, windowMs: number): { bucket: Bucket; allowed: boolean } {
 const bucket = previous && now < previous.start + windowMs ? { ...previous } : { start: now, count: 0 };
 if (bucket.count >= limit) return { bucket, allowed: false };
 bucket.count++; return { bucket, allowed: true };
}
