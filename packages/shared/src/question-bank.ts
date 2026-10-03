import type { Question } from './protocol.ts';
export interface BankSummary {
 id: string; title: string; description: string; revision: number;
 publishedRevision: number | null; publishedTitle: string | null;
 questionCount: number; publishedCount: number; updatedAt: number;
}
export interface QuestionBank extends BankSummary { questions: Question[] }
