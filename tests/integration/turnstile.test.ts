import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testSiteKey, testSecretKey, testToken, turnstileMode, verifyTurnstile } from '../../apps/worker/src/turnstile.ts';
const host = 'family-day-game-staging.example.workers.dev';
const staging = { DEPLOYMENT_ENV: 'staging', STAGING_HOSTNAME: host, TURNSTILE_MODE: 'test', TURNSTILE_SITE_KEY: testSiteKey, TURNSTILE_SECRET: testSecretKey };
const real = { TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET: 'real-secret' };
test('測試金鑰只可用於獨立staging Worker及指定hostname', () => {
 assert.equal(turnstileMode(staging, host), 'test');
 for (const change of [{ DEPLOYMENT_ENV: 'production' }, { STAGING_HOSTNAME: 'other.workers.dev' }, { TURNSTILE_SECRET: 'wrong' }, { TURNSTILE_SITE_KEY: 'wrong' }, { TURNSTILE_MODE: 'real' }]) assert.throws(() => turnstileMode({ ...staging, ...change }, host));
 assert.throws(() => turnstileMode({ ...staging, STAGING_HOSTNAME: 'family-day-game.example.workers.dev' }, 'family-day-game.example.workers.dev'));
 assert.throws(() => turnstileMode({ ...real, TURNSTILE_SECRET: testSecretKey }, host));
 assert.throws(() => turnstileMode({ ...real, TURNSTILE_SITE_KEY: testSiteKey }, host));
});
test('測試模式仍呼叫Siteverify並拒絕失敗或缺少token；正式模式保留hostname/action限制', async () => {
 let calls = 0;
 const mock = (result: unknown, status = 200): typeof fetch => async (url, options) => {
  calls++; assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(options?.method, 'POST'); return Response.json(result, { status });
 };
 await verifyTurnstile(staging, host, testToken, null, mock({ success: true, hostname: 'localhost', action: 'test' }));
 assert.equal(calls, 1);
 await assert.rejects(verifyTurnstile(staging, host, testToken, null, mock({ success: false })));
 await assert.rejects(verifyTurnstile(staging, host, 'bad', null, mock({ success: true })));
 await assert.rejects(verifyTurnstile(staging, host, undefined, null, mock({ success: true })));
 await assert.rejects(verifyTurnstile(staging, host, testToken, null, mock({ success: true }, 500)));
 await verifyTurnstile(real, host, 'valid', null, mock({ success: true, hostname: host, action: 'join' }));
 for (const result of [{ success: true, hostname: 'evil.invalid', action: 'join' }, { success: true, hostname: host, action: 'other' }, { success: 'true', hostname: host, action: 'join' }]) await assert.rejects(verifyTurnstile(real, host, 'valid', null, mock(result)));
});
