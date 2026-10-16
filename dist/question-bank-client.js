const MAX_FILE_BYTES=2*1024*1024;
export async function parseWorkbook(file) {
 if(!file||!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('請選擇 .xlsx 檔案，不支援 .xls 或巨集格式。');
 if(file.size>MAX_FILE_BYTES)throw new Error('Excel 檔案不可超過 2 MiB，請使用精簡的題庫範本。');
 const buffer=await file.arrayBuffer();
 return new Promise((resolve,reject)=> {
  const worker=new Worker('/vendor/xlsx-worker.js',{type:'module'});
  const finish=(fn,value)=>{clearTimeout(timeout);worker.terminate();fn(value);};
  const timeout=setTimeout(()=>finish(reject,new Error('Excel 解析逾時，請移除不必要內容後重試。')),10000);
  worker.onmessage=({data})=> {
   if(data.error){const error=new Error(data.error);error.details=data.details;finish(reject,error);}
   else finish(resolve,data.bank);
  };
  worker.onerror=()=>finish(reject,new Error('無法啟動 Excel 解析，請重新整理後再試。'));
  worker.postMessage(buffer,[buffer]);
 });
}
