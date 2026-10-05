import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDisplayQuestions } from '../../apps/worker/src/room/legacy-test-fixture.ts';
const source = { bankId: 'test-bank', revision: 2, title: 'E2E題庫-1791170000000' };
const questions = [1, 2, 3].map(round => ({ id: 'legacy-' + round, round, text: `<script>window.injection = true</script> 第${round}題`, options: ['答案A', '答案B'], correct: 1, seconds: 120, points: 260 }));
test('舊Staging安全測試房間只修正顯示文字，保留題目ID、答案、配分與原始資料；正式及自訂題庫不變', () => {
 const copy = structuredClone(questions);
 assert.deepEqual(fixtureDisplayQuestions('staging', source, questions), questions.map((q, i) => ({ ...q, text: `第${i + 1}題` })));
 assert.deepEqual(questions, copy);
 for (const env of [undefined, 'local', 'production']) assert.equal(fixtureDisplayQuestions(env, source, questions), questions);
 for (const change of [{ title: '手機試玩' }, { bankId: null }]) assert.equal(fixtureDisplayQuestions('staging', { ...source, ...change }, questions), questions);
 const custom = questions.map((q, i) => ({ ...q, text: i === 0 ? '<script>範例</script>' : q.text }));
 assert.equal(fixtureDisplayQuestions('staging', source, custom), custom);
});
