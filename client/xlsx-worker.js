import {readSheet} from 'read-excel-file/universal';
import {normalizeWorkbookRows} from '../shared/question-bank.js';
import {checkWorkbookZip} from '../shared/xlsx-limits.js';
self.onmessage=async event=> {
 try {
  checkWorkbookZip(event.data);
  const rows=await readSheet(event.data,'題庫');
  self.postMessage({bank:normalizeWorkbookRows(rows)});
 } catch(error) {
  self.postMessage({error:error.details?error.message:'無法讀取 Excel，請確認檔案符合範本、工作表名稱為「題庫」。',details:error.details || []});
 }
};
