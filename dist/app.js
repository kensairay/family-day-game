import {parseWorkbook} from '/question-bank-client.js';
const $ = id => document.getElementById(id);
const role = document.body.dataset.role;
let sessionId='legacy',bankPreview=null,bankParsing=false,historyRequest=0;
let room, key='', state=null, socket, reconnectTimer, heartbeat, retryDelay=1000, busy=false, authenticated=false;
let pendingAnswer=null, pendingCommand=null, lastPong=0, storageAvailable=true, actionPreview=null, lastHostPhase=null;
const playerStorage = () => `family-day:player:${room}`;
const hostStorage = () => `family-day:host:${room}`;
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
function notice(text) { $('notice').textContent=text; }
function connection(text, online=false) { $('connection').textContent=text; $('connection').classList.toggle('offline',!online); }
function saveIdentity() {
  try {
    if(role==='player') localStorage.setItem(playerStorage(),JSON.stringify({token:key,pending:pendingAnswer,sessionId,nickname:state?.me?.name || $('nickname')?.value || ''}));
    if(role==='host') sessionStorage.setItem(hostStorage(),JSON.stringify({token:key,pending:pendingCommand}));
  } catch { storageAvailable=false; notice('此瀏覽器無法保存身份；請保持頁面開啟，避免重新整理。'); }
}
async function api(path, body) {
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(`/api/rooms/${room}/${path}`,{
      method:body ? 'POST':'GET', cache:'no-store', signal:controller.signal,
      headers:{...(key ? {Authorization:`Bearer ${key}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    let value;
    try { value=await response.json(); }
    catch {
      const error=new Error('服務暫時無法回應，尚未確認成功，請重試。');
      error.status=response.status >= 500 ? response.status : 503;
      throw error;
    }
    if(!response.ok) { const error=new Error(value.error || '操作失敗'); error.status=response.status;error.details=value.details;error.sessionId=value.sessionId;error.sessionTitle=value.sessionTitle;throw error; }
    return value;
  } catch(error) {
    if(error.name==='AbortError') throw new Error('連線較慢，尚未確認成功，請重試。');
    if(error instanceof TypeError) throw new Error('網路暫時無法連線，尚未確認成功，請稍後重試。');
    throw error;
  } finally {clearTimeout(timeout);}
}
function apply(value) {
  if(state && value.version < state.version) return;
  const oldQuestion=state?.question?.id;
  if(state && value.sessionId!==state.sessionId) {
    actionPreview=null;bankPreview=null;lastHostPhase=null;
    if($('confirmationPanel'))$('confirmationPanel').hidden=true;
    if($('bankPreview'))$('bankPreview').replaceChildren();
    if($('bankFile'))$('bankFile').value='';
    if($('bankStatus'))$('bankStatus').textContent='';
  }
  state=value;sessionId=value.sessionId || 'legacy';
  if(role==='player' && pendingAnswer) {
    if(value.me?.answer || value.question?.id !== pendingAnswer.questionId || ['revealed','skipped','finished'].includes(value.phase)) { pendingAnswer=null; saveIdentity(); }
  }
  render();
  if(value.question?.id && oldQuestion !== value.question.id) {
    window.scrollTo(0,0); $('phaseHeading')?.focus({preventScroll:true});
  }
}
async function sync() {
  if(!authenticated) return;
  try{apply(await api(`state?role=${role}`));}
  catch(error){
    if(role==='player' && error.status===401 && error.sessionId && error.sessionId!==sessionId){resetPlayerForSession(error.sessionId,error.sessionTitle);return;}
    throw error;
  }
}
function closeSocket() {
  clearTimeout(reconnectTimer); clearInterval(heartbeat);
  if(socket) { socket.onclose=null; socket.close(); socket=null; }
}
function connect() {
  closeSocket();
  if(!authenticated || !navigator.onLine) { connection('目前離線，恢復網路後會自動重連'); return; }
  connection('正在同步遊戲進度…');
  const protocol=location.protocol==='https:' ? 'wss:':'ws:';
  const current=new WebSocket(`${protocol}//${location.host}/api/rooms/${room}/ws`); socket=current;
  current.onopen=()=> {
    if(current !== socket) return;
    lastPong=Date.now(); current.send(JSON.stringify({type:'auth',role,token:key}));
    heartbeat=setInterval(()=> {
      if(Date.now()-lastPong > 45000) { current.close(); return; }
      if(current.readyState===WebSocket.OPEN) current.send('ping');
    },20000);
  };
  current.onmessage=event=> {
    if(current !== socket) return;
    if(event.data==='pong') {lastPong=Date.now();return;}
    try {
      const message=JSON.parse(event.data);
      if(message.type==='session-changed' && role==='player'){resetPlayerForSession(message.sessionId,message.sessionTitle);return;}
      if(message.type==='state') {
        retryDelay=1000; connection('已連線',true); apply(message.state);
        if(role==='player' && pendingAnswer && !busy && state.phase==='open') sendAnswer();
        if(role==='host' && pendingCommand && !busy) sendCommand();
      }
    } catch { notice('無法讀取最新進度，正在重新連線。'); current.close(); }
  };
  current.onclose=event=> {
    if(current !== socket) return;
    clearInterval(heartbeat);
    connection('連線中斷，正在重連；請保留此頁面。');
    if(event.code===1008) {
      authenticated=false; notice('身份驗證失敗，請重新登入或重新整理。');
      if(role==='host') { $('loginPanel').hidden=false; $('gamePanel').hidden=true; }
      return;
    }
    const delay=retryDelay+Math.random()*1000; retryDelay=Math.min(retryDelay*2,15000);
    reconnectTimer=setTimeout(async()=> {
      try { await sync(); } catch {}
      if(authenticated)connect();
    },delay);
  };
  current.onerror=()=>{if(current === socket) current.close();};
}
function setBusy(value) { busy=value; render(); }
async function sendAnswer() {
  if(!pendingAnswer || busy || state?.phase!=='open') return;
  const sendingSession=sessionId;setBusy(true);
  try {const value=await api('answer',pendingAnswer);if(sendingSession!==sessionId)return;apply(value);notice('');}
  catch(error) {
    if(sendingSession!==sessionId)return;
    notice(error.message);
    if(error.status===401 && error.sessionId && error.sessionId!==sessionId){resetPlayerForSession(error.sessionId,error.sessionTitle);return;}
    if(error.status===409 || error.status===400) { pendingAnswer=null; saveIdentity(); }
    try { await sync(); } catch {}
  } finally {if(sendingSession===sessionId)setBusy(false);}
}
async function sendCommand() {
  if(!pendingCommand || busy) return;
  setBusy(true);
  try {
    const action=pendingCommand.action;
    apply(await api('host',pendingCommand)); pendingCommand=null; saveIdentity();
    if(action==='import-bank'){$('bankFile').value='';bankPreview=null;$('bankPreview').replaceChildren();$('bankStatus').textContent='題庫已發布並保存。';}
    if(action==='new-session'){await refreshSessions();$('sessionTitle').value='';}
    if(action==='adjust-score') {$('adjustDelta').value='';$('adjustReason').value='';}
    notice(storageAvailable ? '操作已完成' : '操作已完成，但此瀏覽器無法保存身份，請避免重新整理。');
  }
  catch(error) {
    notice(error.message);
    if(error.status && error.status<500) {pendingCommand=null;saveIdentity();}
    try {await sync();} catch {}
  } finally {setBusy(false);}
}
function hostAction(action, extra={}) {
  if(busy || pendingCommand || !state) return;
  pendingCommand={action,commandId:uuid(),revision:state.revision,...extra};
  saveIdentity(); sendCommand();
}
function render() {
  if(!state) return;
  $('gamePanel').hidden=false;
  if($('joinPanel')) $('joinPanel').hidden=true;
  if($('loginPanel')) $('loginPanel').hidden=true;
  const q=state.question, revealed=['revealed','finished'].includes(state.phase) && !state.voided, ranked=['revealed','skipped','finished'].includes(state.phase), pending=pendingAnswer?.questionId===q?.id;
  $('phaseHeading').textContent=state.phase==='waiting' ? '準備好了嗎？' : state.phase==='finished' ? '三回合完成！' : state.phase==='paused' ? '遊戲暫停' : state.phase==='skipped' ? '本題跳過' : `第 ${q.number} 題`;
  $('roundName').textContent=q?.roundName || '請等待主持人開始';
  $('question').textContent=state.phase==='finished' ? '謝謝參加，請看最終排行榜。' : q?.text || '主持人開始後，題目會同步出現在這裡。';
  $('answers').replaceChildren();
  if(q && state.phase!=='finished') q.options.forEach((text,index)=> {
    const button=document.createElement('button'); button.className='answer';
    const label=document.createElement('b');label.textContent='ABCD'[index];
    const copy=document.createElement('span');copy.textContent=text;button.append(label,copy);
    const selected=state.me?.answer?.choice===index || (pending && pendingAnswer.choice===index);
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
    button.disabled=role!=='player' || state.phase!=='open' || state.me?.answer!=null || pending || busy;
    if(revealed) {button.classList.toggle('correct',index===q.correct);button.classList.toggle('wrong',selected && index!==q.correct);}
    button.onclick=()=> {
      if(pendingAnswer || busy || state.phase!=='open' || state.me?.answer) return;
      pendingAnswer={questionId:q.id,choice:index};saveIdentity();sendAnswer();
    };
    $('answers').append(button);
  });
  let feedback=state.phase==='waiting' ? '一人一機，答對固定加分，不比作答速度。' : state.phase==='open' ? '等待主持人公布答案。' : state.phase==='paused' ? '遊戲暫停，等待主持人恢復本題。' : state.phase==='skipped' ? '本題跳過，不計分。請等待主持人開始下一題。' : state.phase==='finished' ? '同分並列，請依主持人指示上台決勝。' : `正確答案：${q.options[q.correct]}`;
  if(role==='player') {
    $('identity').textContent=`你的暱稱：${state.me.name}`;
    $('score').textContent=`${state.me.score} 分`;
    $('progress').style.width=`${state.position/state.questionCount*100}%`;
    if(state.phase==='open') feedback=state.me.answer ? '已收到，等待主持人公布答案。' : pending ? busy ? '送出中，等待伺服器確認…' : '尚未確認收到，將嘗試重送。' : '請選擇一個答案，送出後不能更改。';
    if(state.phase==='paused') feedback=state.me.answer ? '遊戲暫停，你的答案已收到並保留。' : pending ? '遊戲暫停，待送答案已保留，恢復後會再送出。' : '遊戲暫停，恢復後可繼續作答。';
    if(state.phase==='revealed') feedback=(state.me.answer?.choice===q.correct ? `答對了！＋${state.points} 分。` : state.me.answer ? '本題答錯，0 分。' : '本題未作答，0 分。')+` 正確答案：${q.options[q.correct]}`;
    $('retryBtn').hidden=!pending || state.phase!=='open'; $('retryBtn').disabled=busy;
    if(state.me.finalRank) feedback+=` 上台決勝最終名次：第 ${state.me.finalRank} 名。`;
  } else {
    $('playerCount').textContent=`已加入 ${state.playerCount} 人`;
    $('answeredCount').textContent=`本題已作答 ${state.answeredCount} 人`;
  }
  $('feedback').textContent=feedback;
  $('rankPanel').hidden=!ranked || (role==='screen' && state.phase!=='finished');
  $('leaderboard').replaceChildren();
  const visibleRanks=role==='screen' ? state.leaderboard.slice(0,10) : state.leaderboard;
  for(const entry of visibleRanks) {
    const row=document.createElement('div'); row.className='rank';if(entry.id===state.me?.id) row.classList.add('self');
    const name=document.createElement('span');name.textContent=`${entry.tied?'並列 ':''}第 ${entry.rank} 名 · ${entry.name}${entry.finalRank ? `（上台決勝：第 ${entry.finalRank} 名）` : ''}`;
    const points=document.createElement('span');points.className='points';points.textContent=`${entry.score} 分`;
    row.append(name,points);$('leaderboard').append(row);
  }
  if(role==='host') {
    $('connectedCount').textContent=`連線中 ${state.connectedCount} 人`;
    $('archiveStatus').textContent=state.archive.error ? '紀錄封存暫時失敗，遊戲資料已保存在房間，系統會重試。' : state.archive.pending ? `紀錄封存中（${state.archive.pending} 筆待處理）` : '紀錄已封存';
    renderHostControls(q);

  }
  if(role==='screen') {
    $('invitePanel').hidden=state.phase!=='waiting';
    $('questionCard').hidden=['waiting','finished'].includes(state.phase);
  }
}
function playerOptions(id) {
  const select=$(id), selected=select.value;
  select.replaceChildren();
  state.leaderboard.forEach(entry=> {
    const option=document.createElement('option');option.value=entry.id;option.textContent=`${entry.name} · ${entry.score} 分`;select.append(option);
  });
  if([...select.options].some(o=>o.value===selected)) select.value=selected;
}
function renderHostControls(q) {
  if(lastHostPhase===null){$('inviteDetails').open=state.phase==='waiting';$('bankPanel').open=state.phase==='waiting';}
  else if(lastHostPhase==='waiting' && state.phase!=='waiting'){$('inviteDetails').open=false;$('bankPanel').open=false;$('historyPanel').open=false;}
  lastHostPhase=state.phase;
  const locked=busy || Boolean(pendingCommand);
  for(const [id,phases] of [
    ['startBtn',['waiting']],['revealBtn',['open']],['nextBtn',['revealed','skipped']],
    ['pauseBtn',['open']],['resumeBtn',['paused']]
  ]) { $(id).hidden=!phases.includes(state.phase);$(id).disabled=locked; }
  $('nextBtn').textContent=state.position===state.questionCount ? '結束遊戲並公布排行榜 →' : q?.lastInRound ? '開始下一回合 →' : '下一題 →';
  $('retryHostBtn').hidden=!pendingCommand; $('retryHostBtn').disabled=busy;
  $('retryHostBtn').textContent=busy ? '正在確認上次操作…' : '重試上次操作';
  $('skipPanel').hidden=!['open','paused'].includes(state.phase);
  $('requestSkipBtn').disabled=locked;
  $('adjustPanel').hidden=!['paused','revealed','skipped','finished'].includes(state.phase);
  const finalRecorded=state.leaderboard.some(p=>p.finalRank!==null);
  $('previewAdjustmentBtn').disabled=locked || finalRecorded || state.playerCount===0;
  $('adjustHelp').textContent=finalRecorded ? '已登記決勝名次，不能再調整積分，以免已公布結果過期。' : '請在登記決勝名次前修正分數。每次操作會保留理由與前後分數。';
  $('confirmActionBtn').disabled=locked;
  $('finalRankPanel').hidden=state.phase!=='finished';$('saveRankBtn').disabled=locked;
  playerOptions('adjustPlayer');playerOptions('finalPlayer');
  $('finalRank').max=state.playerCount;
  $('sessionLabel').textContent=`目前場次：${state.sessionTitle}`;
  $('bankSummary').textContent=`目前 ${state.bankSummary.questionCount} 題；`+state.bankSummary.rounds.map(r=>`${r.name} ${r.count} 題`).join('／');
  $('bankFile').disabled=locked || bankParsing || state.phase!=='waiting';
  $('publishBankBtn').disabled=locked || bankParsing || !bankPreview || state.phase!=='waiting';
  $('sessionPanel').hidden=!(state.phase==='finished'||(state.phase==='waiting'&&state.playerCount===0));
  $('newSessionBtn').disabled=locked || !(state.phase==='finished'||(state.phase==='waiting'&&state.playerCount===0));
  $('sessionHelp').textContent=$('newSessionBtn').disabled?'請先完成本場，再建立新場次。':'';
}
function previewHostAction(action, extra, text, expectedRevision=state?.revision) {
  if(busy || pendingCommand || !state) return;
  actionPreview={action,commandId:uuid(),revision:expectedRevision,...extra};
  $('confirmationText').textContent=text;
  $('confirmationPanel').hidden=false;
  $('confirmActionBtn').focus();
  $('confirmationPanel').scrollIntoView({block:'nearest'});
}
function resetPlayerForSession(id,title) {
  const name=state?.me?.name || $('nickname')?.value || '';
  closeSocket();authenticated=false;pendingAnswer=null;state=null;busy=false;
  sessionId=id;key=uuid();$('nickname').value=Array.from(name).slice(0,10).join('');
  $('gamePanel').hidden=true;$('joinPanel').hidden=false;$('joinBtn').disabled=false;$('joinBtn').textContent='加入新場次 →';
  saveIdentity();notice(`新場次「${title || '新場次'}」已建立，請確認暱稱後重新加入。`);connection('請加入新場次',true);
}
async function refreshSessions() {
  if(role!=='host'||!authenticated)return;
  const request=++historyRequest;
  try {
    const value=await api('sessions');if(request!==historyRequest)return;
    const select=$('historySession'),selected=select.value;select.replaceChildren();
    value.sessions.filter(s=>!s.current).reverse().forEach(s=> {
      const option=document.createElement('option');option.value=s.id;option.textContent=`${s.title}（${s.playerCount} 人）`;select.append(option);
    });
    if([...select.options].some(o=>o.value===selected))select.value=selected;
    $('historyStatus').textContent=select.options.length?'下載會包含該場題庫、分數與答題紀錄。':'尚無過去場次。';
    $('downloadHistoryBtn').disabled=!select.options.length;
    if(select.options.length)$('historyPanel').open=true;
  } catch(error){$('historyStatus').textContent=error.message;}
}
function showBankPreview(bank) {
  const target=$('bankPreview');target.replaceChildren();
  for(const round of [1,2,3]) {
    const questions=bank.filter(q=>q.round===round),details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent=`${questions[0].roundName}（${questions.length} 題）`;details.open=true;details.append(summary);
    for(const q of questions){const p=document.createElement('p');p.textContent=`${q.number}. ${q.text}\n`+q.options.map((option,i)=>`${'ABCD'[i]}：${option}`).join('／')+`\n正確答案：${'ABCD'[q.correct]}`;details.append(p);}
    target.append(details);
  }
}
async function downloadRecord(path,filename) {
  const data=await api(path),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setupInvite() {
  if(!$('joinLink')) return;
  const url=new URL('/',location.origin);url.searchParams.set('room',room);
  $('joinLink').href=url.href; $('joinLink').textContent=url.href;
  if(typeof window.qrcode==='function') {const qr=window.qrcode(0,'M');qr.addData(url.href);qr.make();$('qr').src='data:image/svg+xml;base64,'+btoa(qr.createSvgTag({cellSize:5,margin:4}));}
  else { $('qr').hidden=true; notice('QR Code 載入失敗，仍可使用加入連結。'); }
}
async function boot() {
  try {
    const response=await fetch('/api/config',{cache:'no-store'}); if(!response.ok) throw new Error();
    const config=await response.json();sessionId=config.sessionId || 'legacy';room=new URLSearchParams(location.search).get('room') || config.room;
    if(room!==config.room) throw new Error('找不到這個活動房間，請重新掃描 QR Code。');
    setupInvite();
    if(role==='player') {
      let saved=null;try{saved=JSON.parse(localStorage.getItem(playerStorage()));}catch{storageAvailable=false;}
      if(saved?.nickname)$('nickname').value=Array.from(saved.nickname).slice(0,10).join('');
      if(saved?.token && (saved.sessionId || 'legacy')===sessionId) {
        key=saved.token;pendingAnswer=saved.pending || null;
        try {apply(await api('state?role=player'));authenticated=true;connect();return;}
        catch(error){if(error.status!==401) throw error;}
      }
      key=key || uuid();saveIdentity();$('joinPanel').hidden=false;connection('請輸入暱稱加入',true);
    } else if(role==='host') {
      let saved=null;try{saved=JSON.parse(sessionStorage.getItem(hostStorage()));}catch{storageAvailable=false;}
      if(saved?.token) {
        key=saved.token;pendingCommand=saved.pending || null;
        try {apply(await api('state?role=host'));authenticated=true;connect();refreshSessions();return;}catch(error){if(error.status!==401) throw error;}
      }
      key='';connection('請輸入主持人登入碼',true);
    } else { authenticated=true;apply(await api('state?role=screen'));connect(); }
  } catch(error) { connection('無法連線，請確認網路後重新整理。');notice(error.message || '目前無法讀取活動設定'); }
}
$('joinForm')?.addEventListener('submit',async event=> {
  event.preventDefault(); if(busy) return;busy=true;$('joinBtn').disabled=true;
  try { const value=await api('join',{token:key,nickname:$('nickname').value}); apply(value);authenticated=true;connect();if(storageAvailable)notice('請記住畫面上的暱稱，方便辨認排行榜。'); }
  catch(error){notice(error.message);} finally{busy=false;$('joinBtn').disabled=false;render();}
});
$('loginPanel')?.addEventListener('submit',async event=> {
  event.preventDefault();key=$('hostKey').value;$('loginBtn').disabled=true;
  try{apply(await api('state?role=host'));authenticated=true;saveIdentity();$('hostKey').value='';connect();refreshSessions();notice('');}
  catch(error){notice(error.message);}finally{$('loginBtn').disabled=false;}
});
$('bankFile')?.addEventListener('change',async()=> {
  if(busy || pendingCommand || !state || state.phase!=='waiting')return;
  bankPreview=null;$('bankPreview').replaceChildren();bankParsing=true;render();
  const revision=state.revision,parsingSession=sessionId;
  $('bankStatus').textContent='正在檢查 Excel…';
  try {
    const bank=await parseWorkbook($('bankFile').files[0]);
    if(parsingSession!==sessionId || state.phase!=='waiting')throw new Error('場次或進度已改變，請重新選擇檔案。');
    bankPreview={bank,revision};showBankPreview(bank);$('bankStatus').textContent=`檢查通過，共 ${bank.length} 題。請預覽後確認發布。`;
  } catch(error){$('bankStatus').textContent=error.message+(error.details?.length?'：'+error.details.map(d=>`第 ${d.row} 列：${d.message}`).join('；'):'');}
  finally{bankParsing=false;render();}
});
$('publishBankBtn')?.addEventListener('click',()=> {
  if(!bankPreview)return;
  previewHostAction('import-bank',{bank:bankPreview.bank},`將以預覽的 ${bankPreview.bank.length} 題取代本場題庫。開始後不能修改，確定發布？`,bankPreview.revision);
});
$('sessionPanel')?.addEventListener('submit',event=> {
  event.preventDefault();previewHostAction('new-session',{title:$('sessionTitle').value.trim()},`建立「${$('sessionTitle').value.trim()}」：保留舊場紀錄與已發布題庫，玩家須重新加入，積分從 0 開始。`);
});
$('downloadHistoryBtn')?.addEventListener('click',async()=> {
  $('downloadHistoryBtn').disabled=true;
  try{await downloadRecord('export?sessionId='+encodeURIComponent($('historySession').value),`family-day-${room}-${$('historySession').value}.json`);}
  catch(error){notice(error.message);}finally{$('downloadHistoryBtn').disabled=!$('historySession').value;}
});
$('retryBtn')?.addEventListener('click',sendAnswer);
$('startBtn')?.addEventListener('click',()=>hostAction('start'));
$('revealBtn')?.addEventListener('click',()=>hostAction('reveal'));
$('nextBtn')?.addEventListener('click',()=>hostAction('next'));
$('pauseBtn')?.addEventListener('click',()=>hostAction('pause'));
$('resumeBtn')?.addEventListener('click',()=>hostAction('resume'));
$('retryHostBtn')?.addEventListener('click',sendCommand);
$('skipPanel')?.addEventListener('submit',event=> {
  event.preventDefault();
  previewHostAction('skip',{reason:$('skipReason').value.trim()},`${state.question.roundName}第 ${state.question.number} 題將跳過，全員本題不計分。理由：${$('skipReason').value.trim()}`);
});
$('adjustPanel')?.addEventListener('submit',event=> {
  event.preventDefault();
  const player=state.leaderboard.find(p=>p.id===$('adjustPlayer').value), delta=Number($('adjustDelta').value);
  if(!player || !Number.isSafeInteger(delta) || delta===0 || Math.abs(delta)>10000 || player.score+delta<0 || player.score+delta>1000000) {
    notice('請輸入非零整數增減分數（最多正負 10000）；調整後必須介於 0～1000000 分。');return;
  }
  previewHostAction('adjust-score',{playerId:player.id,delta,reason:$('adjustReason').value.trim()},`${player.name}：${player.score} 分 → ${player.score+delta} 分（${delta>0?'+':''}${delta}）。理由：${$('adjustReason').value.trim()}`);
});
$('confirmActionBtn')?.addEventListener('click',()=> {
  if(!actionPreview || busy || pendingCommand) return;
  pendingCommand=actionPreview;actionPreview=null;$('confirmationPanel').hidden=true;
  saveIdentity();sendCommand();
});
$('cancelActionBtn')?.addEventListener('click',()=>{actionPreview=null;$('confirmationPanel').hidden=true;});
$('finalRankPanel')?.addEventListener('submit',event=>{event.preventDefault();hostAction('final-rank',{playerId:$('finalPlayer').value,rank:Number($('finalRank').value)});});
$('logoutBtn')?.addEventListener('click',()=> {
  authenticated=false;closeSocket();key='';pendingCommand=null;actionPreview=null;lastHostPhase=null;$('confirmationPanel').hidden=true;
  try{sessionStorage.removeItem(hostStorage());}catch{}
  state=null;$('gamePanel').hidden=true;$('loginPanel').hidden=false;connection('已登出主持人');
});
$('exportBtn')?.addEventListener('click',async()=> {
  $('exportBtn').disabled=true;
  try{const data=await api('export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`family-day-${room}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(error){notice(error.message);}finally{$('exportBtn').disabled=false;}
});
window.addEventListener('offline',()=>{closeSocket();connection('目前離線，請保留頁面；恢復網路後會自動重連。');});
window.addEventListener('online',()=>{if(authenticated)connect();else boot();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && authenticated){sync().then(()=>{if(!authenticated)return;if(!socket || socket.readyState!==WebSocket.OPEN)connect();else socket.send(JSON.stringify({type:'sync'}));}).catch(()=>connect());}});
boot();
