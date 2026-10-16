import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readSheet} from 'read-excel-file/universal';
import {checkWorkbookZip} from '../shared/xlsx-limits.js';
import {normalizeWorkbookRows} from '../shared/question-bank.js';
const bytes=async()=>{const b=await readFile('dist/question-bank-template.xlsx');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
test('real downloadable Excel template decodes as valid three-round bank',async()=>{
 const buffer=await bytes();assert.equal(checkWorkbookZip(buffer),true);
 const bank=normalizeWorkbookRows(await readSheet(buffer,'題庫'));assert.equal(bank.length,9);assert.equal(bank[0].correct,2);
});
test('ZIP bounds reject garbage, oversize, forged inflated sizes, and encrypted files',async()=>{
 assert.throws(()=>checkWorkbookZip(new ArrayBuffer(5)));assert.throws(()=>checkWorkbookZip(new ArrayBuffer(2*1024*1024+1)));
 for(const type of ['size','encrypted']){
  const buffer=await bytes(),view=new DataView(buffer);
  for(let p=0;p<buffer.byteLength-46;p++)if(view.getUint32(p,true)===0x02014b50){if(type==='size')view.setUint32(p+24,9*1024*1024,true);else view.setUint16(p+8,1,true);break;}
  assert.throws(()=>checkWorkbookZip(buffer));
 }
});

test('actual Excel blanks are rejected and actual numeric cells are preserved as option text',async()=>{
 for(const [file,valid] of [['bank-empty-answer.xlsx',false],['bank-numeric-options.xlsx',true]]){
  const bytes=await readFile('tests/fixtures/'+file),rows=await readSheet(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'題庫');
  if(valid)assert.deepEqual(normalizeWorkbookRows(rows)[0].options,['2023','2024','2025','2026']);
  else assert.throws(()=>normalizeWorkbookRows(rows),/驗證/);
 }
});
