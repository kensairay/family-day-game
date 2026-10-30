export const HEADERS=['回合','回合名稱','題目','選項A','選項B','選項C','選項D','正確答案'];
export const MAX_BANK_BYTES=96*1024;
export class BankValidationError extends Error {
 constructor(message,details=[]){super(message);this.status=400;this.details=details;}
}
const text=value=>typeof value==='string'?value.trim():'';
export function validateBank(input) {
 if(!Array.isArray(input)||input.length<1)throw new BankValidationError('題庫至少需要一題');
 const errors=[],counts=new Map(),names=new Map(),bank=[];
 let previous=0;
 input.forEach((q,index)=>{
  const row=Number.isInteger(q?.sourceRow)?q.sourceRow:index+2;
  const fail=message=>errors.push({row,message});
  if(!q||typeof q!=='object'){fail('題目格式不正確');return;}
  const round=q.round,roundName=text(q.roundName),question=text(q.text);
  if(!Number.isSafeInteger(round)||round<1){fail('回合必須為正整數');return;}
  if(round<previous)fail('請依回合順序排列');previous=round;
  counts.set(round,(counts.get(round)||0)+1);
  if(!roundName||Array.from(roundName).length>40)fail('回合名稱需為 1～40 字');
  if(names.has(round)&&names.get(round)!==roundName)fail('同一回合的名稱必須相同');names.set(round,roundName);
  if(!question||Array.from(question).length>200)fail('題目需為 1～200 字');
  const options=Array.isArray(q.options)?q.options.map(text):[];
  if(options.length!==4||options.some(v=>!v||Array.from(v).length>80))fail('四個選項都需填寫，且各不超過 80 字');
  if(new Set(options.map(v=>v.normalize('NFKC'))).size!==4)fail('同一題的選項不可重複');
  if(!Number.isInteger(q.correct)||q.correct<0||q.correct>3)fail('正確答案必須為 A、B、C 或 D');
  bank.push({id:`r${round}q${counts.get(round)}`,round,number:counts.get(round),roundName,text:question,options,correct:q.correct});
 });
 if(errors.length)throw new BankValidationError('題庫驗證失敗，請修正欄位內容',errors.slice(0,20));
 if(new TextEncoder().encode(JSON.stringify(bank)).byteLength>MAX_BANK_BYTES)throw new BankValidationError('題庫文字總量過大，請縮短題目或選項');
 return bank;
}
export function normalizeWorkbookRows(rows) {
 if(!Array.isArray(rows)||!Array.isArray(rows[0])||rows[0].length!==HEADERS.length||rows[0].some((v,i)=>text(v)!==HEADERS[i]))throw new BankValidationError('Excel 欄位不符合範本，請使用下載的題庫範本');
 const data=rows.slice(1).map((cells,i)=>({cells,row:i+2})).filter(({cells})=>cells.some(v=>v!==null&&v!==undefined&&v!==''));
 if(data.some(({cells})=>cells.length>8))throw new BankValidationError('題庫僅接受範本的 8 個欄位');
 return validateBank(data.map(({cells:c,row})=>{
  const letter=text(c[7]).toUpperCase();
  return {sourceRow:row,round:typeof c[0]==='number'?c[0]:Number(text(c[0])),roundName:c[1],text:c[2],
   options:c.slice(3,7).map(value=>typeof value==='number'&&Number.isFinite(value)?String(value):value),
   correct:/^[ABCD]$/.test(letter)?'ABCD'.indexOf(letter):-1};
 }));
}
