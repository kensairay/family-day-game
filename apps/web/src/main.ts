import QRCode from 'qrcode';
import {validRoom,type Snapshot} from '../../../packages/shared/src/protocol.ts';
import './style.css';
const app=document.querySelector<HTMLElement>('#app')!;
const root=document.createElement('div');app.append(root);
const heading=document.createElement('header');heading.innerHTML='<span class="tag">家庭日・正式版開發中</span><h1>全員出動！</h1>';root.append(heading);
const panel=document.createElement('section');panel.className='card';root.append(panel);
const status=document.createElement('p');status.className='status';root.append(status);
const say=(text:string)=>{status.textContent=text;};
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text='',parent:HTMLElement=panel) {const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;}
function input(label:string,type='text') {const wrap=element('label',label);const el=element('input','',wrap);el.type=type;return el;}
async function api(path:string,data:unknown,key?:string) {
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok) throw new Error(result.error??'操作失敗');return result;
}
const params=new URLSearchParams(location.search);
const isHost=params.has('host');let room=params.get('room')??'';
let socket:WebSocket|undefined,retry=0,stopped=false;
function connect(credential:string,host:boolean) {
 const url=new URL(`/api/rooms/${room}/socket`,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
 socket=new WebSocket(url,['family.v1',`auth.${credential}`]);say('連線中…');
 socket.onopen=()=>{retry=0;say('已連線');};
 socket.onmessage=e=>{
  const msg=JSON.parse(e.data);if(msg.type==='session.replaced'){stopped=true;socket?.close();say('此身分已在其他分頁連線，這個分頁已停止重連。');return;}if(msg.type==='error') {say(msg.error);return;}
  if(msg.type!=='state.snapshot') return;
  const s=msg as Snapshot;
  const count=document.querySelector('#count');if(count) count.textContent=`目前 ${s.online} 人在線／${s.joined} 人已加入`;
  const list=document.querySelector('#players');if(host&&list){list.replaceChildren();for(const p of s.players??[]) element('li',p.nickname,list as HTMLElement);}
  const name=document.querySelector('#name');if(name)name.textContent=s.self?.nickname??'';
 };
 socket.onclose=e=>{
  if(stopped)return;
  if(e.code===4001){stopped=true;say('此身分已在其他分頁連線，這個分頁已停止重連。');return;}
  if(retry>=8){say('連線未恢復，請重新整理；身分會保留。');return;}
  say('連線中斷，正在重新連線…');setTimeout(()=>connect(credential,host),Math.min(15000,500*2**retry++)+Math.random()*500);
 };
 socket.onerror=()=>say('連線失敗，請確認房間與憑證。');
}
function lobby(credential:string,host:boolean) {
 panel.replaceChildren();element('h2',host?'主持人房間':'已加入，等待主持人');element('p',`房間代碼：${room}`);
 if(host){
  const join=new URL(location.href);join.search='';join.searchParams.set('room',room);
  const canvas=element('canvas');QRCode.toCanvas(canvas,join.href,{width:220}).catch(()=>say('QR Code產生失敗，請使用加入連結。'));
  const link=element('a','開啟玩家加入頁');link.href=join.href;
  const copy=element('button','複製加入連結');copy.onclick=()=>navigator.clipboard.writeText(join.href).then(()=>say('加入連結已複製')).catch(()=>say(join.href));
 }else{element('h3').id='name';}
 element('p','正在讀取人數…').id='count';
 if(host)element('ul').id='players';
 element('p','目前已完成房間與加入流程；出題與計分將在下一階段接上。').className='muted';
 connect(credential,host);
}
if(isHost){
 const saved=room?sessionStorage.getItem(`host:${room}`):null;
 if(saved&&validRoom(room))lobby(saved,true);
 else {
  element('h2','建立遊戲房間');const key=input('管理密碼','password');key.autocomplete='off';
  const create=element('button','建立房間');create.onclick=async()=>{
   create.disabled=true;try{const data=await api('/api/rooms',{},key.value);key.value='';room=data.roomId;sessionStorage.setItem(`host:${room}`,data.hostToken);history.replaceState(null,'',`?host&room=${room}`);lobby(data.hostToken,true);}catch(e){say((e as Error).message);create.disabled=false;}
  };
 }
}else{
 const saved=validRoom(room)?localStorage.getItem(`player:${room}`):null;
 if(saved)lobby(saved,false);
 else {
  element('h2','一起玩，一起拿分。');const code=input('房間代碼');code.value=room;code.maxLength=8;
  const name=input('你的暱稱（最多10個字）');name.setAttribute('autocomplete','nickname');
  const join=element('button','加入遊戲');join.onclick=async()=>{
   room=code.value.trim().toUpperCase();if(!validRoom(room)){say('請輸入8碼房間代碼');return;}
   join.disabled=true;try{const data=await api(`/api/rooms/${room}/join`,{nickname:name.value});localStorage.setItem(`player:${room}`,data.playerToken);history.replaceState(null,'',`?room=${room}`);lobby(data.playerToken,false);}catch(e){say((e as Error).message);join.disabled=false;}
  };
  const host=element('a','主持人入口');host.href='?host';
 }
}
window.addEventListener('pagehide',()=>{stopped=true;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({protocol:1,type:'session.leave'}));socket?.close();});
