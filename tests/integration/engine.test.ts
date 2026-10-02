import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAnswer, initialState, sampleQuestions, settleDeadline, standings, transition, validateQuestions } from '../../apps/worker/src/room/engine.ts';
import { consumeBucket, HttpError, readJSON } from '../../apps/worker/src/security.ts';

test('三回合狀態機只能依主持人指令與截止時間推進', () => {
  let s = transition(initialState(), 'start', sampleQuestions, 1000);
  assert.equal(s.deadline, 16000);
  assert.throws(() => transition(s, 'reveal', sampleQuestions, 1001));
  assert.ok(canAnswer(s, 'demo-1', 1, sampleQuestions, 15999));
  for (const option of [-1, 3, 1.2, '1']) assert.equal(canAnswer(s, 'demo-1', option, sampleQuestions, 1200), false);
  assert.equal(canAnswer(s, 'demo-2', 1, sampleQuestions, 1200), false);
  assert.equal(canAnswer(s, 'demo-1', 1, sampleQuestions, 16000), false);
  assert.equal(settleDeadline(s, 15999), s);
  s = settleDeadline(s, 16000); assert.equal(s.phase, 'QUESTION_CLOSED');
  assert.equal(settleDeadline(s, 18000), s); // repeated alarm is idempotent
  s = transition(s, 'reveal', sampleQuestions, 18000); assert.equal(s.revealedThrough, 0);
  s = transition(s, 'next', sampleQuestions, 19000); assert.equal(s.phase, 'ROUND_END');
  for (let i = 1; i <= 2; i++) {
    s = transition(s, 'start', sampleQuestions, 20000 * i); assert.equal(s.index, i);
    s = transition(s, 'close', sampleQuestions, 20001 * i);
    s = transition(s, 'reveal', sampleQuestions, 20002 * i);
    s = transition(s, 'next', sampleQuestions, 20003 * i);
  }
  assert.equal(s.phase, 'FINISHED');
  s = transition(s, 'closeRoom', sampleQuestions, 99999);
  assert.throws(() => transition(s, 'start', sampleQuestions, 100000));
});
test('同分採1、1、3，排序不修改原始資料', () => {
  const players = [{ id: 'b', nickname: '乙', score: 260 }, { id: 'a', nickname: '甲', score: 260 }, { id: 'c', nickname: '丙', score: 0 }];
  assert.deepEqual(standings(players).map(p => p.rank), [1, 1, 3]); assert.equal(players[0].id, 'b');
});
test('題庫驗證拒絕非法答案、回合、時間、配分及重複ID', () => {
  assert.deepEqual(validateQuestions(sampleQuestions), sampleQuestions);
  for (const change of [{ correct: 3 }, { seconds: 0 }, { points: -1 }, { round: 2 }, { text: '' }, { options: ['單一'] }]) {
    assert.throws(() => validateQuestions([{ ...sampleQuestions[0], ...change }]));
  }
  assert.throws(() => validateQuestions([sampleQuestions[0], sampleQuestions[0]]));
  assert.throws(() => validateQuestions([]));
});
test('限流精確達上限並在時間窗到期後恢復', () => {
  const first = consumeBucket(undefined, 1000, 2, 100);
  const second = consumeBucket(first.bucket, 1099, 2, 100);
  assert.ok(first.allowed && second.allowed);
  assert.equal(consumeBucket(second.bucket, 1099, 2, 100).allowed, false);
  assert.ok(consumeBucket(second.bucket, 1100, 2, 100).allowed);
});
test('串流限制按位元組計算，無Content-Length也拒絕超限', async () => {
  const make = (value: string) => new Request('https://test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: value });
  assert.deepEqual(await readJSON(make('{"ok":true}'), 20), { ok: true });
  await assert.rejects(readJSON(make('{"name":"中文字"}'), 12), e => e instanceof HttpError && e.status === 413);
  await assert.rejects(readJSON(make('[]')), e => e instanceof HttpError && e.status === 400);
  await assert.rejects(readJSON(make('{bad}')), e => e instanceof HttpError && e.status === 400);
});
