export const MAX_XLSX_BYTES=2*1024*1024;
// This inspects ZIP bounds only; the maintained Excel reader handles Office XML.
export function checkWorkbookZip(buffer) {
 const fail=()=>{throw new Error('Excel 格式或大小不符合限制，請使用範本另存為 .xlsx');};
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<22||buffer.byteLength>MAX_XLSX_BYTES)fail();
 const view=new DataView(buffer),bytes=new Uint8Array(buffer),size=buffer.byteLength;
 let end=-1;
 for(let p=size-22;p>=Math.max(0,size-65557);p--)if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===size){end=p;break;}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)fail();
 const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(count<1||count>64||view.getUint16(end+8,true)!==count||offset+length!==end)fail();
 let p=offset,total=0;const names=new Set(),ranges=[];
 for(let i=0;i<count;i++) {
  if(p+46>end||view.getUint32(p,true)!==0x02014b50)fail();
  const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true),uncompressed=view.getUint32(p+24,true);
  const nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
  if(flags&1||![0,8].includes(method)||p+46+nameLength+extra+comment>end||local+30>offset)fail();
  const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLength));
  if(names.has(name)||name.startsWith('/')||name.split('/').includes('..')||name.endsWith('vbaProject.bin'))fail();names.add(name);
  total+=uncompressed;if(total>8*1024*1024)fail();
  if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method)fail();
  const localNameLength=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localNameLength+localExtra;
  if(start+compressed>offset||new TextDecoder().decode(bytes.subarray(local+30,local+30+localNameLength))!==name)fail();
  ranges.push([local,start+compressed]);p+=46+nameLength+extra+comment;
 }
 if(p!==end||!names.has('xl/workbook.xml')||!names.has('[Content_Types].xml'))fail();
 ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((range,i)=>i>0&&range[0]<ranges[i-1][1]))fail();
 return true;
}
