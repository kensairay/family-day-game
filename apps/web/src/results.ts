import type { ArchiveStatus, ResultSummary, ResultDetail, PlayerResultDetail } from '../../../packages/shared/src/results.ts';
import { resultReasons } from '../../../packages/shared/src/results.ts';
import { validRoom } from '../../../packages/shared/src/protocol.ts';
import { adminLogin, adminRequest, adminDownload, AdminError, el, field } from './lib/admin-api.ts';

const time = (value: number | null) => value === null ? '—' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(value);
export function showResults(panel: HTMLElement, say: (text: string) => void) {
 document.querySelector('main')?.classList.add('admin-layout');
 el(panel, 'h2', '活動成績歸檔'); const bankLink = el(panel, 'a', '前往題庫後台'); bankLink.href = '?admin';
 const auth = el(panel, 'div'); const workspace = el(panel, 'div'); workspace.hidden = true;
 el(workspace, 'p', '只有完整歸檔的成績可以查閱或匯出。中途關閉／到期時，未公布的題目不計分；提前結束遊戲則依結算畫面的分數保存。').className = 'muted';
 const room = field(workspace, '查詢房間歸檔狀態（8碼）', ''); room.maxLength = 8;
 const check = el(workspace, 'button', '查詢歸檔狀態'); check.className = 'secondary';
 const jobBox = el(workspace, 'div');
 const reload = el(workspace, 'button', '重新載入成績清單'); reload.className = 'secondary';
 const list = el(workspace, 'div'); const pager = el(workspace, 'div'); const details = el(workspace, 'div');
 let busy = false, offset = 0;
 const login = adminLogin(auth, say, async () => { workspace.hidden = false; await load(); }, () => {
  workspace.hidden = true; list.replaceChildren(); details.replaceChildren(); jobBox.replaceChildren(); pager.replaceChildren(); room.value = '';
 }, () => !busy);
 const fail = (error: unknown) => { if (error instanceof AdminError && error.status === 401) login.reauthenticate(); say((error as Error).message); };
 async function run(task: () => Promise<void>) {
  if (busy) return; busy = true; workspace.inert = true; workspace.setAttribute('aria-busy', 'true');
  try { await task(); } catch (error) { fail(error); } finally { busy = false; workspace.inert = false; workspace.removeAttribute('aria-busy'); }
 }
 function jobStatus(job: ArchiveStatus | null, code: string) {
  jobBox.replaceChildren();
  if (!job) { el(jobBox, 'p', '房間尚未結算，還沒有歸檔任務。'); return; }
  el(jobBox, 'p', job.status === 'complete' ? '成績已完整歸檔。' : `等待歸檔：已寫入${job.cursor}／${job.playerCount}人；失敗${job.attempts}次，下次重試：${time(job.nextRetryAt)}`);
  if (job.status === 'pending') {
   const retry = el(jobBox, 'button', '立即重試歸檔');
   retry.onclick = () => run(async () => {
    const result = await adminRequest<{ archive: ArchiveStatus | null }>(`/api/admin/results/rooms/${code}/retry`, 'POST', {});
    jobStatus(result.archive, code); await load(); say(result.archive?.status === 'complete' ? '歸檔完成。' : '已嘗試歸檔；未完成的部分會自動接續重試。');
   });
  }
 }
 check.onclick = () => run(async () => {
  const code = room.value.trim().toUpperCase(); if (!validRoom(code)) throw new Error('請輸入8碼房間代碼');
  const result = await adminRequest<{ archive: ArchiveStatus | null }>(`/api/admin/results/rooms/${code}/status`); jobStatus(result.archive, code);
 });
 async function load() {
  const result = await adminRequest<{ games: ResultSummary[]; nextOffset: number | null }>(`/api/admin/results?offset=${offset}`);
  list.replaceChildren(); pager.replaceChildren();
  if (!result.games.length) el(list, 'p', '目前沒有成績歸檔。');
  for (const game of result.games) {
   const row = el(list, 'section'); row.className = 'bank-row';
   el(row, 'h3', `${game.title} · ${game.roomId}`);
   el(row, 'p', `${time(game.endedAt)}（台北）｜${resultReasons[game.reason]}｜${game.playerCount}人｜${game.status === 'ready' ? '歸檔完成' : '寫入中'}`);
   const view = el(row, 'button', '查看成績'); view.className = 'small secondary'; view.disabled = game.status !== 'ready';
   view.onclick = () => run(async () => { showDetail(await adminRequest<ResultDetail>(`/api/admin/results/${game.id}`)); });
  }
  if (offset > 0) { const previous = el(pager, 'button', '上一頁'); previous.className = 'secondary'; previous.onclick = () => run(async () => { offset = Math.max(0, offset - 20); await load(); }); }
  if (result.nextOffset !== null) { const next = el(pager, 'button', '下一頁'); next.className = 'secondary'; next.onclick = () => run(async () => { offset = result.nextOffset!; await load(); }); }
 }
 function showDetail(detail: ResultDetail) {
  details.replaceChildren(); const { game, players } = detail;
  el(details, 'h3', `${game.title}｜${game.roomId} 完整成績`);
  el(details, 'p', `結算：${time(game.endedAt)}（台北）；${resultReasons[game.reason]}。計分${game.scoredQuestionCount}／${game.questionCount}題；發布版本：${game.bankRevision ?? '本機／舊版'}。`);
  const download = el(details, 'button', '匯出 CSV');
  download.onclick = () => run(async () => {
   const url = URL.createObjectURL(await adminDownload(`/api/admin/results/${game.id}/csv`)); const a = document.createElement('a'); a.href = url; a.download = `results-${game.roomId}.csv`;
   document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); say('CSV 已下載，文字欄位已加上試算表公式防護。');
  });
  const scroller = el(details, 'div'); scroller.className = 'table-scroll'; const table = el(scroller, 'table'); table.className = 'results-table';
  const head = el(el(table, 'thead'), 'tr'); for (const name of ['名次', '暱稱', '總分', '回合1', '回合2', '回合3', '作答', '明細']) el(head, 'th', name).scope = 'col';
  const body = el(table, 'tbody'); const answerBox = el(details, 'div');
  for (const p of players) {
   const row = el(body, 'tr'); for (const value of [p.rank, p.nickname, p.score, p.round1, p.round2, p.round3, p.answered]) el(row, 'td', String(value));
   const b = el(el(row, 'td'), 'button', '作答紀錄'); b.className = 'small secondary';
   b.onclick = () => run(async () => {
    const result = await adminRequest<PlayerResultDetail>(`/api/admin/results/${game.id}/players/${p.playerId}`); answerBox.replaceChildren();
    el(answerBox, 'h3', `${result.player.nickname} 的作答紀錄`);
    if (!result.answers.length) el(answerBox, 'p', '沒有提交答案。');
    for (const a of result.answers) {
     const q = result.questions[a.questionIndex]; const card = el(answerBox, 'section'); card.className = 'bank-row';
     el(card, 'h4', `第${a.questionIndex + 1}題（回合${q.round}）：${q.text}`);
     el(card, 'p', `選答：${q.options[a.option]}；正解：${q.options[q.correct]}；${a.counted ? `獲得${a.earned}分` : '未公布，不計分'}；送達：${time(a.received)}（台北）。`);
    }
   });
  }
 }
 reload.onclick = () => run(async () => { offset = 0; await load(); });
}
