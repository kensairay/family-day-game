export const PROTOCOL_VERSION = 1;
export interface Player { id: string; nickname: string }
export interface Snapshot { protocol: 1; type: 'state.snapshot'; roomId: string; phase: 'LOBBY'; version: number; serverTime: number; online: number; joined: number; self?: Player; players?: Player[] }
export function nickname(value: unknown): string {
 if (typeof value !== 'string') throw new Error('請輸入暱稱');
 const name=value.trim();
 if (!name || [...name].length>10 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('暱稱須為1～10個字');
 return name;
}
export function validRoom(value: string): boolean { return /^[A-HJ-NP-Z2-9]{8}$/.test(value); }
