import type { Question } from '../../../../packages/shared/src/protocol.ts';
import type { BankSource } from '../../../../packages/shared/src/results.ts';

// Compatibility for rooms created from the old synthetic E2E bank. Keep the
// stored version, answers and scores intact; change only outgoing display text.
export function fixtureDisplayQuestions(environment: string | undefined, source: BankSource | undefined, questions: Question[]): Question[] {
 if (environment !== 'staging' || !source?.bankId || !/^E2E題庫-\d{13}$/.test(source.title) || questions.length !== 3
  || questions.some((q, i) => q.round !== i + 1 || q.text !== `<script>window.injection = true</script> 第${i + 1}題`
   || q.options.length !== 2 || q.options[0] !== '答案A' || q.options[1] !== '答案B' || q.correct !== 1 || q.points !== 260)) return questions;
 return questions.map((q, i) => ({ ...q, text: `第${i + 1}題` }));
}
