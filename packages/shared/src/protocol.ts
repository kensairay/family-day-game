export const PROTOCOL_VERSION = 1;
export type Phase = 'LOBBY' | 'QUESTION_OPEN' | 'QUESTION_CLOSED' | 'REVEAL' | 'ROUND_END' | 'FINISHED' | 'CLOSED';
export type HostAction = 'start' | 'close' | 'reveal' | 'next' | 'end' | 'closeRoom' | 'removePlayer';
export interface Player { id: string; nickname: string; score: number }
export interface Question { id: string; round: number; text: string; options: string[]; correct: number; seconds: number; points: number }
export interface PublicQuestion { id: string; round: number; text: string; options: string[]; seconds: number; points: number; correct?: number }
export interface Standing extends Player { rank: number }
export interface Snapshot {
 protocol: 1; type: 'state.snapshot'; roomId: string; phase: Phase; version: number; serverTime: number;
 online: number; joined: number; questionIndex: number; questionCount: number; deadline: number | null;
 question?: PublicQuestion; self?: Player & { answer?: number; earned?: number }; players?: Player[];
 leaderboard: Standing[];
}
export function nickname(value: unknown): string {
 if (typeof value !== 'string') throw new Error('請輸入暱稱');
 const name = value.trim();
 if (!name || [...name].length > 10 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('暱稱須為1～10個字');
 return name;
}
export function validRoom(value: string): boolean { return /^[A-HJ-NP-Z2-9]{8}$/.test(value); }
export function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value); }
