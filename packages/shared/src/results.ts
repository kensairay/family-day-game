import type { Question } from './protocol.ts';
export type ArchiveReason = 'completed' | 'ended' | 'closed' | 'expired';
export interface BankSource { bankId: string | null; revision: number | null; title: string }
export interface ArchiveStatus {
 id: string; status: 'pending' | 'complete'; attempts: number; nextRetryAt: number | null;
 cursor: number; playerCount: number; finalVersion: number; endedAt: number; reason: ArchiveReason;
}
export interface ResultSummary {
 id: string; roomId: string; title: string; bankId: string | null; bankRevision: number | null;
 createdAt: number; startedAt: number | null; endedAt: number; finalVersion: number; reason: ArchiveReason;
 questionCount: number; scoredQuestionCount: number; playerCount: number; status: 'writing' | 'ready'; archivedAt: number | null;
}
export interface ArchivedAnswer { questionIndex: number; option: number; earned: number; counted: boolean; received: number }
export interface ResultPlayer {
 playerId: string; nickname: string; rank: number; score: number; round1: number; round2: number; round3: number; answered: number;
}
export interface ResultDetail { game: ResultSummary; players: ResultPlayer[] }
export interface PlayerResultDetail { player: ResultPlayer; answers: ArchivedAnswer[]; questions: Question[] }
export const resultReasons: Record<ArchiveReason, string> = { completed: '正常完成', ended: '提前結束', closed: '中途關閉', expired: '到期關閉' };
