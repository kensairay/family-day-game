import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRows } from '../../apps/worker/src/results/csv.ts';
import { retryDelay, ARCHIVE_CHUNK, ARCHIVE_BATCHES } from '../../apps/worker/src/results/writer.ts';
test('CSV 防護公式、引號、換行與中文編碼，不更改數值', () => {
 for (const text of ['=1+1', '+SUM(A1)', '-2', '@A1', ' \t=1', '\n=1']) assert.ok(csvCell(text).startsWith('"\''));
 assert.equal(csvCell(-2), '"-2"'); assert.equal(csvCell('普通暱稱'), '"普通暱稱"');
 assert.equal(csvCell('a"b,c\nd'), '"a""b,c\nd"'); assert.ok(csvRows([['名次', '暱稱'], [1, '甲']]).startsWith('\uFEFF'));
});
test('歸檔重試指數退避有上限，單次分批工作保持有界', () => {
 assert.equal(retryDelay(1), 30000); assert.equal(retryDelay(2), 60000); assert.equal(retryDelay(10000), 3600000);
 assert.equal(ARCHIVE_CHUNK, 20); assert.ok(ARCHIVE_BATCHES * 4 < 50);
});
