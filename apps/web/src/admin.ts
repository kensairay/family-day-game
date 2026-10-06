import type { BankSummary, QuestionBank } from '../../../packages/shared/src/question-bank.ts';
import type { Question } from '../../../packages/shared/src/protocol.ts';
import { adminLogin, adminRequest, AdminError, el, field, select } from './lib/admin-api.ts';
import { questionPreview } from './lib/question-preview.ts';

export function showAdmin(panel: HTMLElement, say: (text: string) => void) {
 document.querySelector('main')?.classList.add('admin-layout');
 el(panel, 'h2', '正式題庫後台'); const host = el(panel, 'a', '前往主持人入口'); host.href = '?host';
 const results = el(panel, 'a', '活動成績歸檔'); results.href = '?results';
 const rooms = el(panel, 'a', '房間狀態後台'); rooms.href = '?rooms';
 const auth = el(panel, 'div'); const workspace = el(panel, 'div'); workspace.hidden = true;
 const toolbar = el(workspace, 'div'); toolbar.className = 'actions';
 const reload = el(toolbar, 'button', '重新載入題庫清單'); reload.className = 'secondary';
 const add = el(toolbar, 'button', '新增題庫');
 const list = el(workspace, 'div'); const editor = el(workspace, 'div'); editor.className = 'bank-editor';
 let current: QuestionBank | undefined, dirty = false, busy = false;
 let closePreview: (() => void) | undefined;
 let capture: (() => { title: string; description: string; questions: Question[] }) | undefined;
 const login = adminLogin(auth, say, async () => { workspace.hidden = false; await loadList(); }, () => {
  closePreview?.(); closePreview = undefined;
  workspace.hidden = true; editor.replaceChildren(); list.replaceChildren(); current = undefined; dirty = false; capture = undefined;
 }, () => !busy && discard());
 const fail = (error: unknown) => {
  if (error instanceof AdminError && error.status === 401) login.reauthenticate();
  say((error as Error).message);
 };
 const markDirty = () => { dirty = true; editor.querySelector('[data-save-status]')!.textContent = '尚有未儲存變更'; };
 const discard = () => !dirty || confirm('有未儲存變更，確定放棄？');
 async function loadList() {
  const result = await adminRequest<{ banks: BankSummary[] }>('/api/admin/banks'); list.replaceChildren();
  if (!result.banks.length) el(list, 'p', '尚無題庫，請先新增。');
  for (const bank of result.banks) {
   const row = el(list, 'section'); row.className = 'bank-row';
   el(row, 'h3', bank.title);
   el(row, 'p', `草稿：${bank.questionCount}題／版本${bank.revision}；${bank.publishedRevision === null ? '尚未發布' : `已發布：${bank.publishedCount}題／版本${bank.publishedRevision}${bank.revision !== bank.publishedRevision ? '（另有新草稿）' : ''}`}`);
   const open = el(row, 'button', '編輯題庫'); open.className = 'small secondary';
   open.onclick = () => run(async () => {
    if (!discard()) return;
    current = await adminRequest<QuestionBank>(`/api/admin/banks/${bank.id}`); dirty = false; renderEditor();
   });
  }
 }
 async function run(task: () => Promise<void>) {
  if (busy) return; busy = true;
  workspace.inert = true; workspace.setAttribute('aria-busy', 'true');
  try { await task(); } catch (error) { fail(error); }
  finally { busy = false; workspace.inert = false; workspace.removeAttribute('aria-busy'); }
 }
 function renderEditor(values = current ? { title: current.title, description: current.description, questions: current.questions } : { title: '', description: '', questions: [] as Question[] }) {
  closePreview?.(); closePreview = undefined;
  editor.replaceChildren(); el(editor, 'h3', current ? '編輯草稿' : '新增題庫草稿');
  const note = el(editor, 'p', '草稿可先留白儲存。發布前須填完每題與正確答案，依三回合順序排列，每回合至少一題。修改草稿不影響已發布版本或進行中的遊戲。'); note.className = 'muted';
  const saved = el(editor, 'p', dirty ? '尚有未儲存變更' : '目前無未儲存變更'); saved.dataset.saveStatus = '';
  const title = field(editor, '題庫名稱', values.title); title.maxLength = 80;
  const description = field(editor, '題庫說明（選填）', values.description); description.maxLength = 500;
  title.oninput = description.oninput = markDirty;
  const readQuestions: (() => Question)[] = [];
  values.questions.forEach((q, index) => {
   const card = el(editor, 'fieldset'); card.className = 'question-editor'; el(card, 'legend', `第${index + 1}題`);
   const round = select(card, '回合', [['1', '第1回合'], ['2', '第2回合'], ['3', '第3回合']], String(q.round));
   const promptLabel = el(card, 'label', '題目'); const text = el(promptLabel, 'textarea'); text.value = q.text; text.maxLength = 300; text.rows = 3;
   const optionInputs = q.options.map((value, i) => { const o = field(card, `選項${String.fromCharCode(65 + i)}`, value); o.maxLength = 100; return o; });
   const correct = select(card, '正確答案', [['-1', '請選擇正確答案'], ...q.options.map((_, i): [string, string] => [String(i), `選項${String.fromCharCode(65 + i)}`])], String(q.correct));
   const numbers = el(card, 'div'); numbers.className = 'number-fields';
   const seconds = field(numbers, '作答秒數（3～120）', String(q.seconds), 'number'); seconds.min = '3'; seconds.max = '120'; seconds.step = '1';
   const points = field(numbers, '配分（0～10000）', String(q.points), 'number'); points.min = '0'; points.max = '10000'; points.step = '1';
   const read = () => ({ id: q.id, round: Number(round.value), text: text.value, options: optionInputs.map(o => o.value), correct: Number(correct.value), seconds: seconds.value === '' ? NaN : Number(seconds.value), points: points.value === '' ? NaN : Number(points.value) });
   readQuestions.push(read);
   card.oninput = markDirty; card.onchange = markDirty;
   const tools = el(card, 'div'); tools.className = 'actions';
   const button = (label: string, fn: (draft: ReturnType<NonNullable<typeof capture>>) => void) => {
    const b = el(tools, 'button', label); b.className = 'small secondary'; b.onclick = () => { if (busy) return; const draft = capture!(); fn(draft); dirty = true; renderEditor(draft); }; return b;
   };
   if (q.options.length < 4) button('新增選項', draft => draft.questions[index].options.push(''));
   if (q.options.length > 2) button('移除最後選項', draft => { draft.questions[index].options.pop(); draft.questions[index].correct = Math.min(draft.questions[index].correct, draft.questions[index].options.length - 1); });
   if (index > 0) button('往前移', draft => { [draft.questions[index - 1], draft.questions[index]] = [draft.questions[index], draft.questions[index - 1]]; });
   if (index < values.questions.length - 1) button('往後移', draft => { [draft.questions[index + 1], draft.questions[index]] = [draft.questions[index], draft.questions[index + 1]]; });
   const remove = el(tools, 'button', '刪除此題'); remove.className = 'small danger';
   remove.onclick = () => { if (busy || !confirm(`確定刪除第${index + 1}題？尚未儲存前可重新載入還原。`)) return; const draft = capture!(); draft.questions.splice(index, 1); dirty = true; renderEditor(draft); };
  });
  capture = () => ({ title: title.value, description: description.value, questions: readQuestions.map(read => read()) });
  const actions = el(editor, 'div'); actions.className = 'actions';
  const preview = el(actions, 'button', '題庫手機預覽'); preview.className = 'secondary';
  preview.onclick = () => { if (busy) return; closePreview?.(); const draft = capture!(); closePreview = questionPreview(draft.title, draft.questions); };
  const addQuestion = el(actions, 'button', '新增題目'); addQuestion.className = 'secondary'; addQuestion.disabled = values.questions.length >= 60;
  addQuestion.onclick = () => {
   if (busy || values.questions.length >= 60) return;
   const draft = capture!(); draft.questions.push({ id: crypto.randomUUID(), round: draft.questions.at(-1)?.round ?? 1, text: '', options: ['', ''], correct: -1, seconds: 15, points: 260 }); dirty = true; renderEditor(draft);
  };
  const save = el(actions, 'button', '儲存草稿');
  save.onclick = () => run(async () => {
   const draft = capture!();
   current = await adminRequest<QuestionBank>(current ? `/api/admin/banks/${current.id}` : '/api/admin/banks', current ? 'PUT' : 'POST', { ...draft, ...(current ? { revision: current.revision } : {}) });
   dirty = false; renderEditor(); await loadList(); say('草稿已儲存；已發布版本未變更。');
  });
  if (current) {
   const publish = el(actions, 'button', '發布目前已儲存的草稿');
   publish.onclick = () => run(async () => {
    if (dirty) { say('請先儲存草稿，再發布。'); return; }
    if (!confirm('確定發布此題庫？之後建立的新遊戲會使用這個版本；既有遊戲不受影響。')) return;
    current = await adminRequest<QuestionBank>(`/api/admin/banks/${current!.id}/publish`, 'POST', { revision: current!.revision });
    renderEditor(); await loadList(); say('題庫已發布，可在主持人入口選用。');
   });
   const reloadDraft = el(actions, 'button', '重新載入草稿'); reloadDraft.className = 'secondary';
   reloadDraft.onclick = () => run(async () => { if (!discard()) return; current = await adminRequest<QuestionBank>(`/api/admin/banks/${current!.id}`); dirty = false; renderEditor(); say('已載入最新版本。'); });
   const archive = el(actions, 'button', '封存題庫'); archive.className = 'danger';
   archive.onclick = () => run(async () => {
    if (!confirm('封存後將無法選用或編輯此題庫；資料會保留，已建立的遊戲不受影響。確定封存？')) return;
    await adminRequest(`/api/admin/banks/${current!.id}`, 'DELETE', { revision: current!.revision });
    current = undefined; capture = undefined; dirty = false; editor.replaceChildren(); await loadList(); say('題庫已封存。');
   });
  }
 }
 add.onclick = () => { if (busy || !discard()) return; current = undefined; dirty = false; renderEditor(); };
 reload.onclick = () => run(loadList);
 window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
}

export function showHostSetup(panel: HTMLElement, say: (text: string) => void, created: (room: { roomId: string; hostToken: string }) => void) {
 el(panel, 'h2', '建立遊戲房間'); const link = el(panel, 'a', '開啟正式題庫後台'); link.href = '?admin';
 const results = el(panel, 'a', '活動成績歸檔'); results.href = '?results';
 const rooms = el(panel, 'a', '房間狀態後台'); rooms.href = '?rooms';
 const auth = el(panel, 'div'); const workspace = el(panel, 'div'); workspace.hidden = true;
 const notice = el(workspace, 'p'); notice.className = 'muted';
 const choice = select(workspace, '使用題庫', [], '');
 const refresh = el(workspace, 'button', '重新載入已發布題庫'); refresh.className = 'secondary';
 const create = el(workspace, 'button', '建立房間');
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
 let banks: BankSummary[] = [], busy = false;
 const fail = (error: unknown) => { if (error instanceof AdminError && error.status === 401) login.reauthenticate(); say((error as Error).message); };
 const load = async () => {
  create.disabled = true; choice.replaceChildren();
  try {
   banks = (await adminRequest<{ banks: BankSummary[] }>('/api/admin/banks')).banks.filter(b => b.publishedRevision !== null);
   for (const b of banks) { const o = el(choice, 'option', `${b.publishedTitle} · ${b.publishedCount}題 · 版本${b.publishedRevision}`); o.value = b.id; }
   if (local) { const o = el(choice, 'option', '本機三回合示範題（僅供測試）'); o.value = 'demo'; }
   notice.textContent = banks.length ? '遊戲會固定使用所選發布版本，後續改題不影響這個房間。' : '尚無已發布題庫，請先到題庫後台新增並發布。';
   create.disabled = !choice.options.length;
  } catch (error) { fail(error); }
 };
 const login = adminLogin(auth, say, async () => { workspace.hidden = false; await load(); }, () => { workspace.hidden = true; choice.replaceChildren(); });
 refresh.onclick = () => { if (!busy) void load(); };
 create.onclick = async () => {
  if (busy || !choice.value) return; busy = true; create.disabled = true; refresh.disabled = true; choice.disabled = true;
  try {
   const bank = banks.find(b => b.id === choice.value);
   const data = bank ? { bankId: bank.id, publishedRevision: bank.publishedRevision } : {};
   if (!bank && !(local && choice.value === 'demo')) throw new Error('請選擇已發布題庫');
   const room = await adminRequest<{ roomId: string; hostToken: string }>('/api/rooms', 'POST', data); created(room);
  } catch (error) { fail(error); } finally { busy = false; create.disabled = false; refresh.disabled = false; choice.disabled = false; }
 };
}
