import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nickname,validRoom} from '../../packages/shared/src/protocol.ts';
test('暱稱依Unicode字元計算、去除空白並拒絕控制字元',()=>{
 assert.equal(nickname('  王小明  '),'王小明');
 assert.equal(nickname('😀'.repeat(10)),'😀'.repeat(10));
 for(const value of ['',123,'😀'.repeat(11),'a\n名字'])assert.throws(()=>nickname(value));
});
test('房間代碼排除易混淆字元及路徑字串',()=>{
 assert.ok(validRoom('ABCDEFG2'));
 for(const value of ['ABCDEFGI','ABCDEFG0','../rooms','abcd2345','ABC'])assert.equal(validRoom(value),false);
});
