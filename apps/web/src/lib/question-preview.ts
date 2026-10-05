import type { Question } from '../../../../packages/shared/src/protocol.ts';
import { el, select } from './admin-api.ts';

/** Local draft preview. It neither saves drafts nor creates a game. */
export function questionPreview(title: string, questions: Question[]) {
 const dialog = el(document.body, 'dialog'); dialog.className = 'question-preview';
 dialog.setAttribute('aria-labelledby', 'preview-title');
 el(dialog, 'h2', '題庫手機預覽').id = 'preview-title';
 el(dialog, 'p', '使用目前草稿；不會儲存或發布。這是版面與答案模擬，沒有實際倒數、送出作答或計分。').className = 'muted';
 const width = select(dialog, '手機寬度', [['320', '320 px'], ['375', '375 px'], ['430', '430 px']], '375');
 const screen = el(dialog, 'section'); screen.className = 'preview-screen preview-375';
 screen.setAttribute('aria-label', '玩家手機畫面');
 const navigation = el(dialog, 'div'); navigation.className = 'actions';
 const previous = el(navigation, 'button', '預覽上一題'); previous.className = 'secondary';
 const next = el(navigation, 'button', '預覽下一題'); next.className = 'secondary';
 const close = el(dialog, 'button', '關閉預覽'); close.className = 'secondary';
 let index = 0, selected: number | null = null, revealed = false;
 const render = () => {
  screen.replaceChildren(); previous.disabled = index === 0; next.disabled = index >= questions.length - 1;
  el(screen, 'p', title.trim() || '未命名題庫').className = 'muted';
  const q = questions[index];
  if (!q) { el(screen, 'p', '尚無題目，請先新增題目。'); return; }
  el(screen, 'p', `回合${q.round} · 第${index + 1}／${questions.length}題 · ${Number.isFinite(q.seconds) ? q.seconds : '未設定'}秒 · ${Number.isFinite(q.points) ? q.points : '未設定'}分`);
  el(screen, 'h2', q.text.trim() || '（題目尚未填寫）');
  const options = el(screen, 'div'); options.className = 'answers';
  q.options.forEach((value, option) => {
   const text = `${String.fromCharCode(65 + option)}. ${value.trim() || '（選項尚未填寫）'}`;
   if (revealed) {
    const row = el(options, 'p', text); row.className = `option${q.correct === option ? ' correct' : ''}`;
   } else {
    const button = el(options, 'button', text); button.className = `answer${selected === option ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selected === option)); button.onclick = () => { selected = option; render(); };
   }
  });
  el(screen, 'p', revealed
   ? q.correct >= 0 && q.correct < q.options.length ? `正確答案：${String.fromCharCode(65 + q.correct)}. ${q.options[q.correct] || '（選項尚未填寫）'}` : '尚未設定正確答案。'
   : selected === null ? '請選擇答案（預覽）' : `已選擇${String.fromCharCode(65 + selected)}（預覽，不會送出）`).setAttribute('role', 'status');
  const toggle = el(screen, 'button', revealed ? '返回作答預覽' : '模擬公布答案');
  toggle.onclick = () => { revealed = !revealed; render(); };
 };
 width.onchange = () => { screen.className = `preview-screen preview-${width.value}`; };
 previous.onclick = () => { index--; selected = null; revealed = false; render(); };
 next.onclick = () => { index++; selected = null; revealed = false; render(); };
 close.onclick = () => dialog.close();
 dialog.onclose = () => dialog.remove();
 render(); dialog.showModal();
 return () => { dialog.close(); dialog.remove(); };
}
