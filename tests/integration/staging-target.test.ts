import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { stagingTemplate } from '../../scripts/staging/config.mjs';
const { testOrigin } = createRequire(import.meta.url)('./target.cjs');
test('遠端驗收目標限制在獨立staging，拒絕正式站、非HTTPS與含憑證網址', () => {
 assert.equal(testOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
 assert.equal(testOrigin('https://family-day-game-staging.example.workers.dev'), 'https://family-day-game-staging.example.workers.dev');
 for (const url of ['https://family-day-game.example.workers.dev', 'http://family-day-game-staging.example.workers.dev', 'https://family-day-game-staging.example.workers.dev.evil.invalid', 'https://user:secret@family-day-game-staging.example.workers.dev', 'https://family-day-game-staging.example.workers.dev/other', 'https://example.com']) assert.throws(() => testOrigin(url));
});
test('部署設定禁止共用正式DO、正式D1名稱與DNS路由', async () => {
 const config = JSON.parse(await readFile('wrangler.staging.json', 'utf8'));
 assert.equal(stagingTemplate(config).name, 'family-day-game-staging');
 for (const change of [
  { name: 'family-day-game' }, { routes: ['example.com/*'] }, { services: [{ binding: 'OTHER', service: 'production' }] },
  { vars: { ...config.vars, ADMIN_SECRET: '禁止明文密碼' } },
  { d1_databases: [{ ...config.d1_databases[0], database_name: 'family-day-game' }] },
  { durable_objects: { bindings: config.durable_objects.bindings.map((binding: unknown) => ({ ...(binding as object), script_name: 'family-day-game' })) } },
 ]) assert.throws(() => stagingTemplate({ ...config, ...change }));
});
