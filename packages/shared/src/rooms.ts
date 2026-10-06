import type { Phase } from './protocol.ts';
import type { ArchiveStatus, BankSource } from './results.ts';
export const phaseLabels: Record<Phase, string> = {
 LOBBY: '等待開始', QUESTION_OPEN: '答題中', QUESTION_CLOSED: '等待公布答案', REVEAL: '答案已公布', ROUND_END: '回合結束', FINISHED: '遊戲完成', CLOSED: '房間已關閉',
};
export type RoomLifecycle = 'open' | 'finished' | 'closed' | 'expired';
export const lifecycleLabels: Record<RoomLifecycle, string> = { open: '開啟中', finished: '已完成', closed: '已關閉', expired: '已到期' };
export interface RoomStatus {
 roomId: string; source: BankSource; phase: Phase; lifecycle: RoomLifecycle; version: number;
 createdAt: number; startedAt: number | null; expires: number; checkedAt: number;
 online: number; joined: number; hostOnline: boolean; questionIndex: number; questionCount: number;
 round: number | null; deadline: number | null; revealedCount: number; archive: ArchiveStatus | null;
}
export interface RoomListEntry { roomId: string; expires: number; status: RoomStatus | null }
export interface RoomList { rooms: RoomListEntry[]; nextCursor: string | null; checkedAt: number }
