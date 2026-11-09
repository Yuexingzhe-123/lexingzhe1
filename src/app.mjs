import {
  initialState, hydrateState, createBooks, selectedBook, wordLookup, parseTSV,
  newCount, dueCount, getProgress, isMastered, beginSession, currentExercise,
  progressGates, answerExercise, markMastered, unmarkMastered, previewImport,
  importBook, exportState, importState, shuffle, normalizeTerm
} from './engine.mjs';
import { loadState, saveState } from './storage.mjs';
import { extractImportFile, resolveDocumentWords } from './document-import.mjs';
import { AI_PROVIDERS, getAIConfig, askCloudAI } from './cloud-ai.mjs';
import { createReviewCalendar } from './reminders.mjs';

const view = document.querySelector('#view');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
const toastElement = document.querySelector('#toast');
const drawer = document.querySelector('#drawer');
const backdrop = document.querySelector('#drawer-backdrop');
const importFile = document.querySelector('#import-file');
const backupFile = document.querySelector('#backup-file');
let aiSessionKey = ''; // NEVER persisted, logged, or included in exported backups.
let aiAbortController = null;

let state = initialState();
let builtin4 = [], builtin6 = [], books = [], dictionary = new Map();
let page = 'home';
let report = null;
let toastTimer = null;
let saveSequence = Promise.resolve();
let installedPrompt = null;
const ui = {
  selectedPlan: 'mixed', showAdvanced: false, bookLayout: 'shelf', search: '',
  filter: 'all', pending: null, pendingKey: null, options: [], 
  importText: '', importTitle: '我的新词书', importPreview: null,
  showHint: false, detail: null, onlineDefinition: null, onlineLoading: false,
  importAllKnown: false, importBusy: false, importStatus: '', importResultInfo: '',
  aiQuestion: '', aiOutput: '', aiError: '', aiBusy: false
};

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const icons = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7H10v7H4a1 1 0 0 1-1-1z"/>',
  books: '<path d="M4 4h5v17H4zM10 2h5v19h-5zM16 6h5v15h-5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M4 12a8 8 0 0 0 .5 3l-2 2 3 3 2-2a8 8 0 0 0 3 1v3h4v-3a8 8 0 0 0 3-1l2 2 3-3-2-2a8 8 0 0 0 0-6l2-2-3-3-2 2a8 8 0 0 0-3-1V2h-4v3a8 8 0 0 0-3 1l-2-2-3 3 2 2A8 8 0 0 0 4 12z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v19H6.5A2.5 2.5 0 0 1 4 18.5zm0 14A2.5 2.5 0 0 1 6.5 16H20"/>',
  spark: '<path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/>',
  sound: '<path d="M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  chart: '<path d="M4 20V9m6 11V4m6 16v-7m4 7V8"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/>',
  shield: '<path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 7h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  repeat: '<path d="m4 7 3-3 3 3M7 4v10a4 4 0 0 0 4 4h9M20 17l-3 3-3-3M17 20V10a4 4 0 0 0-4-4H4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-4 5-4 15 0 20m0-20c4 5 4 15 0 20"/>',
  wand: '<path d="m4 20 12-12 4 4L8 24m8-16-4-4M18 3v2m-3-1h-2m7 12h2"/>'
};
function icon(name, size = 20) {
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' + (icons[name] || icons.info) + '</svg>';
}
function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 3400);
}
function persist() {
  const snapshot = structuredClone(state);
  saveSequence = saveSequence.catch(() => {}).then(() => saveState(snapshot));
  saveSequence.catch(() => toast('无法保存学习数据，请检查浏览器存储空间'));
}
function rebuildBooks() {
  books = createBooks(builtin4, builtin6, state.customBooks);
  dictionary = wordLookup(books);
}
function book() { return selectedBook(state, books); }
function currentWord() {
  const ex = currentExercise(state);
  if (!ex) return null;
  const sessionBook = books.find(b => b.id === state.session.bookID) || book();
  return sessionBook.words.find(w => w.id === ex.wordID) || dictionary.get(ex.wordID);
}
function localDate() {
  return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
}
function dueText(timestamp) {
  if (!timestamp) return '尚未安排';
  const gap = Number(timestamp) - Date.now();
  if (gap <= 0) return '现在可以复习';
  if (gap < 3600000) return Math.ceil(gap/60000) + ' 分钟后';
  if (gap < 86400000) return Math.ceil(gap/3600000) + ' 小时后';
  return new Intl.DateTimeFormat('zh-CN', { month:'numeric', day:'numeric',hour:'2-digit',minute:'2-digit' }).format(new Date(timestamp));
}
function applyTheme() {
  const mode = state.preferences.theme || 'system';
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#111d18' : '#f4f7f0';
}
function closeDrawer() {
  drawer.classList.remove('open');
  backdrop.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.hidden = true;
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'false');
}
function openDrawer() {
  backdrop.hidden = false;
  drawer.classList.add('open');
  backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'true');
}
function closeModal() { modal.hidden = true; modalContent.innerHTML = ''; }
function showModal(body) {
  modalContent.innerHTML = '<div class="modal-grab"></div><button class="modal-close" aria-label="关闭" data-action="close-modal">' + icon('close') + '</button>' + body;
  modal.hidden = false;
}
function go(nextPage) {
  page = nextPage;
  closeDrawer();
  closeModal();
  window.scrollTo(0,0);
  render();
}
function renderDrawer() {
  const nav = [
    ['home','home','首页'],['library','books','我的词库'],['report-list','chart','学习报告'],
    ['ai','spark','AI 词汇助手'],
    ['account','user','本地档案'],['settings','settings','设置']
  ];
  document.querySelector('#drawer-nav').innerHTML = nav.map(([key, sym, title]) =>
    '<button class="' + (key === page ? 'selected' : '') + '" data-action="page" data-page="' + key + '">' +
    icon(sym) + '<span>' + title + '</span></button>'
  ).join('');
  const label = state.nickname.trim() || '词';
  document.querySelector('#account-button').textContent = label.slice(0,1);
}
function render() {
  applyTheme();
  renderDrawer();
  const studying = page === 'study';
  document.body.classList.toggle('study-mode', studying);
  document.querySelector('#topbar').hidden = studying;
  if (page === 'home') view.innerHTML = renderHome();
  else if (page === 'library') view.innerHTML = renderLibrary();
  else if (page === 'study') view.innerHTML = renderStudy();
  else if (page === 'report') view.innerHTML = renderReport();
  else if (page === 'report-list') view.innerHTML = renderReportList();
  else if (page === 'settings') view.innerHTML = renderSettings();
  else if (page === 'ai') view.innerHTML = renderAI();
  else if (page === 'account') view.innerHTML = renderAccount();
}
function renderHome() {
  const b = book();
  const due = dueCount(state,b);
  const fresh = newCount(state,b);
  const studied = b.words.length - fresh;
  return '<div class="home">' +
    '<div class="home-date">' + esc(localDate()) + '</div>' +
    '<div class="home-center">' +
      '<div class="kicker">A QUIET SPACE FOR WORDS</div>' +
      '<div class="home-symbol" aria-hidden="true">词间</div>' +
      '<h1>在词与词之间，<br>慢慢走远。</h1>' +
      '<p class="home-sub">不必急着记住一切。<br>让每一次相遇，都成为下一次重逢的伏笔。</p>' +
      '<div class="home-action"><button class="primary full" data-action="' + (state.session ? 'continue-study' : 'open-setup') + '">' +
      (state.session ? '继续学习这一组' : '开始学习') + icon('arrow') + '</button></div>' +
      '<p class="home-hint">' + esc(b.title) + ' · 每组 ' + state.preferences.groupSize + ' 词</p>' +
    '</div>' +
    '<div class="home-foot">' +
      '<div class="stat-card"><span class="stat-number">' + studied + '</span><span class="label">已经相识</span></div>' +
      '<div class="stat-card"><span class="stat-number">' + due + '</span><span class="label">等待复习</span></div>' +
      '<div class="stat-card"><span class="stat-number">' + fresh + '</span><span class="label">尚待探索</span></div>' +
    '</div>' +
  '</div>';
}
function bookTile(b) {
  const selected = b.id === state.selectedBook;
  const learned = b.words.filter(w => Boolean(getProgress(state,w.id))).length;
  const percent = b.words.length ? Math.round(100*learned/b.words.length) : 0;
  return '<button class="book-card ' + (selected ? 'selected' : '') + '" data-action="select-book" data-id="' + esc(b.id) + '">' +
    '<div class="row between"><span class="tag">' + (b.isBuiltin ? '官方课程方向' : '个人词书') + '</span>' + (selected ? icon('check') : '') + '</div>' +
    '<div class="book-cover"><span>' + (b.id === 'cet4' ? '四' : b.id === 'cet6' ? '六' : '词') + '</span></div>' +
    '<div><h3>' + esc(b.title) + '</h3><p>' + b.words.length + ' 个词条 · 已学 ' + learned + '（' + percent + '%）</p></div>' +
  '</button>';
}
function renderLibrary() {
  const b = book();
  const layout = ui.bookLayout;
  return '<div class="stack relaxed">' +
    '<div class="section-head"><div><div class="kicker">YOUR COLLECTION</div><h1>我的词库</h1></div><button class="secondary small-btn" data-action="open-import">' + icon('plus') + ' 导入</button></div>' +
    '<div class="row between"><h3>词书书架</h3><div class="segment"><button data-action="book-layout" data-value="shelf" class="' + (layout==='shelf'?'active':'') + '" aria-label="书架视图">' + icon('grid',16) + '</button><button data-action="book-layout" data-value="list" class="' + (layout==='list'?'active':'') + '" aria-label="列表视图">' + icon('list',16) + '</button></div></div>' +
    '<div class="' + (layout==='shelf' ? 'book-grid' : 'stack tight') + '">' +
    books.map(b => layout==='shelf' ? bookTile(b) :
    '<button class="book-list-item row between" data-action="select-book" data-id="' + esc(b.id) + '"><div><strong>' + esc(b.title) + '</strong><p class="fineprint">' + b.words.length + ' 词条</p></div>' + (b.id===state.selectedBook?icon('check'):icon('chevron')) + '</button>').join('') + '</div>' +
    '<div class="card stack"><div class="row between"><div><div class="kicker">CURRENT WORD BOOK</div><h2 style="margin-top:6px">' + esc(b.title) + '</h2></div>' +
    (!b.isBuiltin ? '<button class="ghost small-btn" data-action="delete-book" data-id="' + esc(b.id) + '" aria-label="删除个人词书">' + icon('trash') + '</button>' : '') + '</div>' +
    '<div class="row" style="flex-wrap:wrap"><span class="chip">' + b.words.length + ' 个词条</span><span class="chip">' + dueCount(state,b) + ' 个待复习</span><span class="chip">' + newCount(state,b) + ' 个新词</span></div>' +
    '<div class="row"><input class="search" id="word-search" type="search" placeholder="搜索单词或释义" autocomplete="off" value="' + esc(ui.search) + '" aria-label="搜索单词"></div>' +
    '<div class="row between"><label class="field-label" for="word-filter" style="margin:0">词条列表</label><select id="word-filter" class="field" style="width:auto;min-width:130px"><option value="all"' + (ui.filter==='all'?' selected':'') + '>全部单词</option><option value="new"' + (ui.filter==='new'?' selected':'') + '>未学</option><option value="due"' + (ui.filter==='due'?' selected':'') + '>待复习</option><option value="saved"' + (ui.filter==='saved'?' selected':'') + '>生词本</option></select></div>' +
    '<div id="word-list">' + wordListHTML() + '</div></div>' +
  '</div>';
}
function wordListHTML() {
  const b = book();
  const search = ui.search.trim().toLowerCase();
  let entries = b.words.filter(w => (!search || w.id.includes(search) || w.meaning.includes(search)) &&
    (ui.filter === 'all' || ui.filter === 'new' && !getProgress(state,w.id) ||
     ui.filter === 'due' && Boolean(getProgress(state,w.id)) && dueCountWord(w) ||
     ui.filter === 'saved' && state.bookmarks.includes(w.id)));
  const count = entries.length;
  entries = entries.slice(0,80);
  if (!count) return '<div class="empty-state"><strong>还没有匹配的单词</strong>试试其他关键词或切换筛选条件。</div>';
  return '<p class="fineprint" style="margin-bottom:7px">共 ' + count + ' 个结果' + (count>80?' · 目前显示前 80 个，搜索可进一步定位':'') + '</p>' +
    entries.map(w => '<div class="word-row"><div class="word-text" data-action="word-detail" data-id="' + esc(w.id) + '" role="button" tabindex="0"><strong>' + esc(w.term) + '</strong><small>' + esc(w.meaning) + '</small></div>' +
      '<button class="mini-control" aria-label="朗读 ' + esc(w.term) + '" data-action="speak" data-id="' + esc(w.id) + '">' + icon('sound') + '</button>' +
      '<button class="mini-control" aria-label="收藏 ' + esc(w.term) + '" data-action="bookmark" data-id="' + esc(w.id) + '" style="' + (state.bookmarks.includes(w.id)?'color:#c28a4f':'') + '">' + icon('bookmark') + '</button></div>').join('');
}
function dueCountWord(w) {
  const p = getProgress(state,w.id);
  return p && !isMastered(p) && Number(p.dueDate) <= Date.now();
}
function speak(term) {
  if (!('speechSynthesis' in window)) { toast('此浏览器暂不支持系统语音'); return; }
  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(term);
  msg.lang = state.preferences.accent || 'en-US';
  msg.rate = Math.max(0.7,Math.min(1.45,Number(state.preferences.speechRate)||1));
  const voices = window.speechSynthesis.getVoices();
  const matching = voices.find(v => v.lang.toLowerCase() === msg.lang.toLowerCase());
  if (matching) msg.voice = matching;
  window.speechSynthesis.speak(msg);
}
function preparePending() {
  const ex = currentExercise(state);
  if (!ex) return;
  const key = state.session.index + ':' + ex.wordID + ':' + ex.mode;
  if (ui.pendingKey === key) return;
  ui.pendingKey = key;
  ui.pending = null;
  ui.showHint = false;
  const b = books.find(item => item.id===state.session.bookID) || book();
  const w = currentWord();
  const candidates = shuffle(b.words.filter(item => item.id !== ex.wordID && item.meaning !== w.meaning));
  ui.options = shuffle([w, ...candidates.slice(0,3)]);
  if (ex.mode !== 'spelling' && state.preferences.autoPronounce) {
    setTimeout(() => { if (page === 'study' && ui.pendingKey === key) speak(w.term); },170);
  }
}
function renderStudy() {
  const ex = currentExercise(state);
  if (!ex) { page = 'home'; return renderHome(); }
  preparePending();
  const w = currentWord();
  if (!w) return '<div class="empty-state">学习数据异常，请返回首页。</div>';
  const gate = progressGates(state);
  const stageText = ex.mode === 'choice' ? '第一关 · 释义选择' : ex.mode === 'spelling' ? '第二关 · 拼写记忆' : '第三关 · 闪卡巩固';
  const resolved = Boolean(ui.pending);
  let main = '';
  if (ex.mode==='choice') {
    main = '<div class="study-word">' + esc(w.term) + '</div><div class="study-prompt">选择它最恰当的中文释义</div>' +
      '<div class="study-control"><button data-action="speak" data-id="' + esc(w.id) + '">' + icon('sound') + (state.preferences.accent==='en-GB'?'英音':'美音') + '</button><button data-action="bookmark" data-id="' + esc(w.id) + '">' + icon('bookmark') + (state.bookmarks.includes(w.id)?'已收藏':'收藏') + '</button></div>' +
      '<div class="study-options">' + ui.options.map((candidate,i) => {
        const cls = resolved && candidate.id===w.id ? ' correct' : resolved && ui.pending.selected===candidate.id ? ' wrong' : '';
        return '<button class="option' + cls + '" data-action="choice-answer" data-id="' + esc(candidate.id) + '"' + (resolved?' disabled':'') + '>' +
          '<span class="letter">' + 'ABCD'[i] + '</span><span>' + esc(candidate.meaning) + '</span></button>';
      }).join('') + '</div>';
  } else if (ex.mode==='spelling') {
    main = '<div class="study-prompt">根据释义，拼写正确的英文单词</div>' +
      '<div class="study-meaning">' + esc(w.meaning) + '</div>' +
      '<div class="study-control"><button data-action="spelling-hint">' + icon('sound') + ' 发音与提示</button></div>' +
      (ui.showHint ? '<p class="fineprint" style="text-align:center">音标：' + esc(w.phonetic||'暂无音标') + ' · 首字母：' + esc(w.term[0]) + '</p>' : '') +
      '<input id="spelling-input" class="word-input" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="done" type="text" placeholder="输入英文单词" value="' + esc(resolved?ui.pending.selected:state.session.draftSpelling||'') + '"' + (resolved?' disabled':'') + '>' +
      (!resolved ? '<button class="primary full" data-action="spelling-answer">确认拼写</button>' : '');
  } else {
    const flipped = ui.showHint || resolved;
    main = '<div class="study-prompt">先回想单词含义，再翻开闪卡</div>' +
      '<button class="flash-card ' + (flipped?'revealed':'') + '" data-action="flip-card" aria-label="翻开单词卡" ' + (flipped?'disabled':'') + '>' +
      '<div class="study-word">' + esc(w.term) + '</div>' +
      (flipped ? '<div class="study-meaning">' + esc(w.meaning) + '</div>' + (w.example?'<p class="fineprint">' + esc(w.example) + '</p>':'') :
      '<span class="hint">轻触翻开答案</span>') + '</button>' +
      '<div class="study-control"><button data-action="speak" data-id="' + esc(w.id) + '">' + icon('sound') + '听发音</button></div>' +
      (flipped && !resolved ? '<div class="split-fields"><button class="secondary" data-action="flash-answer" data-value="wrong">忘记了</button><button class="primary" data-action="flash-answer" data-value="correct">记住了</button></div>' : '');
  }
  const feedback = resolved ?
    '<div class="study-result ' + (ui.pending.correct?'':'error') + '"><b>' + (ui.pending.correct?'✓ 本关通过':'稍后重试本关') + '</b>' +
    '<p>' + esc(w.term) + ' · ' + esc(w.meaning) + '</p>' +
    (ex.mode==='spelling' && !ui.pending.correct?'<p>正确拼写：<strong>' + esc(w.term) + '</strong></p>':'') +
    '<p class="fineprint">' + (ui.pending.correct?'通过后会穿插其他单词，再进入下一关。':'本次不增加进度；先练其他词，过几题再回来。') + '</p></div>' : '';
  return '<div class="study-wrap stack">' +
    '<div class="study-header"><button class="icon-button" data-action="leave-study" aria-label="保存并返回">' + icon('back') + '</button>' +
    '<div class="progress-wrap"><div class="progress-head"><span>' + esc(stageText) + '</span><span>' + gate.passed + ' / ' + gate.total + ' · ' + gate.percent + '%</span></div>' +
    '<div class="progress-track"><div class="progress-fill" style="width:' + gate.percent + '%"></div></div></div>' +
    '<button class="icon-button" data-action="word-detail" data-id="' + esc(w.id) + '" aria-label="查看词条">' + icon('info') + '</button></div>' +
    '<div class="card study-card"><div class="study-stage">' + (ex.retry?'REVISIT · ':'') + esc(stageText) + '</div>' +
    main + feedback +
    '<div class="study-bottom">' + (resolved ? '<button class="primary full" data-action="study-next">下一词 ' + icon('arrow') + '</button>' :
    ex.mode === 'flashcard' ? '<p class="fineprint" style="text-align:center">翻开后，根据真实记忆情况作答。</p>' :
    '<p class="fineprint" style="text-align:center">每一次通过，才算真正前进一关。</p>') + '</div></div></div>';
}
function renderReport() {
  const s = report || state.history[0];
  if (!s) return '<div class="empty-state">还没有完成的学习报告。</div>';
  const total = s.originallySelected || 0, wrong = s.failedWords.length, correct = s.correctAnswers || 0;
  const accuracy = s.totalAnswered ? Math.round(100*correct/s.totalAnswered) : 0;
  const next = s.finishedWords.map(id=>getProgress(state,id)?.dueDate).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  return '<div class="stack relaxed"><div class="report-hero"><div class="kicker">SESSION COMPLETE</div><div class="big">' + total + '</div>' +
    '<h1>这一组，完成了。</h1><p class="home-sub">你又与这些单词，多了一点熟悉。</p></div>' +
    '<div class="report-grid">' +
    '<div class="report-stat"><strong>' + total + '</strong><span>训练词数</span></div>' +
    '<div class="report-stat"><strong>' + accuracy + '%</strong><span>答题正确率</span></div>' +
    '<div class="report-stat"><strong>' + wrong + '</strong><span>出现错误的词</span></div></div>' +
    '<div class="card stack"><div class="row">' + icon('clock') + '<h3>下一次复习</h3></div>' +
    '<p>最近到期：<strong>' + esc(dueText(next)) + '</strong></p>' +
    '<p class="fineprint">遇到错误的单词按较短间隔安排复习。当天重复通过并不会让答错的词自动获得额外进度。</p></div>' +
    (wrong ? '<div class="card stack"><h3>值得再见一面的词</h3><div class="stack tight">' +
      s.failedWords.slice(0,20).map(id => {
        const w=dictionary.get(id);
        return w ? '<div class="row between"><strong>' + esc(w.term) + '</strong><span class="fineprint">' + esc(w.meaning) + '</span></div>' : '';
      }).join('') + '</div></div>' : '') +
    '<button class="primary full" data-action="page" data-page="home">回到首页 ' + icon('arrow') + '</button></div>';
}
function renderReportList() {
  return '<div class="stack relaxed"><div class="section-head"><div><div class="kicker">LEARNING RECORDS</div><h1>学习报告</h1></div></div>' +
    (state.history.length ? state.history.map((r,i) =>
      '<button class="click-card" data-action="show-report" data-index="' + i + '"><div class="flex"><strong>' +
      esc(new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(r.completedAt||r.startedAt))) +
      '</strong><p class="fineprint">' + r.originallySelected + ' 个词 · ' + (r.totalAnswered?Math.round(r.correctAnswers*100/r.totalAnswered):0) + '% 正确率 · ' + r.failedWords.length + ' 个错词</p></div>' + icon('chevron') + '</button>'
    ).join('') : '<div class="empty-state">' + icon('chart') + '<strong>还没有学习报告</strong>完成第一组训练后会自动记录。</div>') + '</div>';
}
function renderAI() {
  const config = state.preferences.aiConfig || getAIConfig('qwen');
  const provider = config.provider || 'qwen';
  return '<div class="stack relaxed"><div class="section-head"><div><div class="kicker">WORD INTELLIGENCE</div><h1>AI 词汇助手</h1></div>' +
     '<span class="chip">自带 API 密钥</span></div>' +
     '<div class="card stack"><div class="row">' + icon('spark') + '<h3>自主选择模型</h3></div>' +
     '<p class="fineprint">支持千问、DeepSeek、OpenAI 与 OpenAI 兼容接口。此网页不提供免费的云端 AI 额度，也不包含原生版的 1.4GB 离线模型。</p>' +
     '<label class="stack tight"><span class="field-label">模型供应商</span><select class="field" id="ai-provider">' +
     Object.entries(AI_PROVIDERS).map(([key,value]) => '<option value="' + key + '"' + (key===provider?' selected':'') + '>' + esc(value.label) + '</option>').join('') +
     '</select></label>' +
     '<label class="stack tight"><span class="field-label">HTTPS API 地址（OpenAI 兼容格式）</span>' +
     '<input class="field" type="url" id="ai-base" placeholder="https://..." value="' + esc(config.baseURL||'') + '" autocapitalize="off" autocomplete="off" spellcheck="false"></label>' +
     '<label class="stack tight"><span class="field-label">模型名称</span>' +
     '<input class="field" id="ai-model" value="' + esc(config.model||'') + '" autocapitalize="off" spellcheck="false"></label>' +
     '<label class="stack tight"><span class="field-label">API Key · 仅在本次打开页面期间保存在内存中</span>' +
     '<input class="field" id="ai-key" type="password" placeholder="' + (aiSessionKey?'已填写（隐藏）':'输入你的 API Key') + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
     '<p class="fineprint">不会把 API Key 写入本机学习记录或备份。向你指定的 API 服务发送提问时，浏览器会把 Key 发送给该服务；提供商必须支持 CORS，否则会报跨域错误。请勿在公开网页中嵌入开发者统一密钥。</p></div>' +
     '<div class="card stack"><h3>单词解析与辨析</h3>' +
     '<label class="stack tight"><span class="field-label">词汇 / 想问的问题</span>' +
     '<textarea class="field" id="ai-question" placeholder="例如：区分 adapt 和 adopt，并给出四级语境例句">' +
     esc(ui.aiQuestion) + '</textarea></label>' +
     '<div class="row"><button class="primary flex" data-action="ai-ask"' + (ui.aiBusy?' disabled':'') + '>' +
     (ui.aiBusy ? '正在请求…' : '生成词汇解析 ' + icon('arrow')) + '</button>' +
     (ui.aiBusy?'<button class="secondary small-btn" data-action="ai-cancel">取消</button>':'') + '</div>' +
     (ui.aiError?'<div class="study-result error"><b>未能获取解析</b><p>'+esc(ui.aiError)+'</p></div>':'') +
     (ui.aiOutput?'<div class="study-result"><b>AI 辅助解析（请核对准确性）</b><p class="ai-output">'+esc(ui.aiOutput)+'</p></div>':'') +
     '</div>' +
     '<div class="card soft stack tight"><div class="row">' + icon('shield') + '<strong>隐私与使用边界</strong></div>' +
     '<p class="fineprint">学习数据默认留在本机。只有点击“生成解析”后，提问内容才会发往你填写的第三方 API。未知接口和无 CORS 的服务无法保证兼容。需要服务端代理时，应由你控制后端并安全保存平台密钥。</p></div></div>';
}
function renderSettings() {
  const p = state.preferences;
  const intervals = p.intervalsHours;
  return '<div class="stack relaxed"><div class="section-head"><div><div class="kicker">MAKE IT YOURS</div><h1>学习设置</h1></div></div>' +
    '<div class="card stack"><h3>Paper & Glass</h3>' +
    '<div class="segment" style="width:100%"><button style="flex:1" data-action="theme" data-value="system" class="' + (p.theme==='system'?'active':'') + '">跟随系统</button><button style="flex:1" data-action="theme" data-value="light" class="' + (p.theme==='light'?'active':'') + '">纸白</button><button style="flex:1" data-action="theme" data-value="dark" class="' + (p.theme==='dark'?'active':'') + '">夜墨</button></div>' +
    '<div class="rule"></div><h3>发音</h3><div class="split-fields"><label class="stack tight"><span class="field-label">口音</span><select class="field" id="accent"><option value="en-US"' + (p.accent==='en-US'?' selected':'') + '>美音</option><option value="en-GB"' + (p.accent==='en-GB'?' selected':'') + '>英音</option></select></label><label class="stack tight"><span class="field-label">语速</span><input class="field" type="number" min=".7" max="1.45" step=".05" id="speech-rate" value="' + p.speechRate + '"></label></div>' +
    '<div class="toggle-row"><label for="auto-pronounce">新词自动发音（拼写题除外）</label><input type="checkbox" id="auto-pronounce"' + (p.autoPronounce?' checked':'') + '></div>' +
    '<div class="toggle-row"><label for="sound-feedback">答题反馈音</label><input type="checkbox" id="sound-feedback"' + (p.soundFeedback?' checked':'') + '></div></div>' +
    '<div class="card stack"><h3>单词闯关</h3><p class="fineprint">每个词第一关固定为释义选择。错题不增加进度，稍后重试，通过后才解锁下一关。</p>' +
    '<div class="check-choice"><input type="checkbox" checked disabled aria-label="第一关选择题必选"><div><strong>释义选择</strong><small>必选 · 第一关</small></div></div>' +
    '<label class="check-choice"><input type="checkbox" id="mode-spelling"' + (p.modes.includes('spelling')?' checked':'') + '><div><strong>拼写</strong><small>第二关 · 回忆英文拼写</small></div></label>' +
    '<label class="check-choice"><input type="checkbox" id="mode-flashcard"' + (p.modes.includes('flashcard')?' checked':'') + '><div><strong>闪卡</strong><small>第三关 · 自主回忆与判断</small></div></label>' +
    '<p class="fineprint">训练模式变更会应用于下一组；当前尚未完成的训练保留原有模式。</p>' +
    '<div class="rule"></div><label class="stack tight"><span class="field-label">每组词数</span><select class="field" id="group-size">' +
    [5,10,15,20,30,50].map(n=>'<option value="' + n + '"' + (n===p.groupSize?' selected':'') + '>' + n + ' 词</option>').join('') + '</select></label>' +
    '<label class="stack tight"><span class="field-label">混合训练旧词占比：<b id="ratio-value">' + p.mixedReviewPercent + '%</b></span><input id="mixed-ratio" type="range" min="0" max="100" step="10" value="' + p.mixedReviewPercent + '"></label></div>' +
    '<div class="card stack"><div class="row">' + icon('repeat') + '<h3>复习间隔</h3></div><p class="fineprint">对应原生版遗忘曲线：首次约 20 分钟，再延长至 1、2、4、7、15、30 天。可以独立调整各阶段。</p>' +
    '<div class="interval-grid">' + intervals.map((hrs,i) =>
      '<label class="interval-field"><span>第 ' + (i+1) + ' 次</span><select data-interval="' + i + '" class="field">' +
      [[1/3,'20 分钟'],[1,'1 小时'],[6,'6 小时'],[12,'12 小时'],[24,'1 天'],[48,'2 天'],[96,'4 天'],[168,'7 天'],[360,'15 天'],[720,'30 天']].map(([h,t]) =>
      '<option value="' + h + '"' + (Math.abs(h-Number(hrs))<0.01?' selected':'') + '>' + t + '</option>').join('') +
      '</select></label>').join('') + '</div></div>' +
    '<div class="card stack"><h3>保存与安装</h3><button class="secondary full" data-action="open-install">' + icon('download') + ' 如何安装到 iPhone 主屏幕</button>' +
    '<button class="secondary full" data-action="persist-storage">' + icon('shield') + ' 请求持久化本机存储</button>' +
    '<button class="secondary full" data-action="cache-ocr">' + icon('download') + ' 下载完整离线图片识别包（约 35 MB）</button>' +
    '<button class="secondary full" data-action="export-calendar">' + icon('clock') + ' 导出复习日历（iPhone 日历提醒）</button>' +
    '<button class="secondary full" data-action="page" data-page="ai">' + icon('spark') + ' AI 词汇助手（自填 API Key）</button>' +
    '<p class="fineprint">关闭应用后的精确定时 Web Push 需要单独的推送后端。当前支持打开时显示待复习数、主屏幕角标（设备支持时）以及手动导出日历提醒。日历文件不会自动更新。</p>' +
    '<a class="fineprint" href="./VOCABULARY-LICENSE.txt" target="_blank" rel="noopener">词库来源及 BSD 3-Clause 许可说明</a></div></div>';
}
function renderAccount() {
  const total = Object.keys(state.progress).length;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  return '<div class="stack relaxed"><div class="section-head"><div><div class="kicker">LOCAL, PRIVATE, YOURS</div><h1>我的档案</h1></div></div>' +
    '<div class="card stack"><div class="row"><div class="drawer-logo">' + esc((state.nickname||'词').slice(0,1)) + '</div><div><h2>' + esc(state.nickname||'本地学习档案') + '</h2><p class="fineprint">' + total + ' 个词条已有学习记录 · ' + (standalone?'已安装到主屏幕':'网页模式') + '</p></div></div>' +
    '<label class="stack tight"><span class="field-label">昵称（只保存在本机）</span><input class="field" id="nickname" maxlength="30" placeholder="给自己起个昵称" value="' + esc(state.nickname) + '"></label>' +
    '<p class="fineprint">当前 PWA 不包含 Apple 登录、短信登录和云同步。学习进度只保存在这个设备的浏览器存储中，不会自动传到另一部手机。</p></div>' +
    '<div class="card stack"><h3>备份与迁移</h3><p class="fineprint">支持恢复词间原生 iOS App 导出的 JSON 学习备份（词书、进度、收藏、部分训练报告）。Apple 身份和手机号不会迁入 PWA。也支持 PWA 自有备份，请妥善保管文件。</p>' +
    '<button class="primary full" data-action="export-backup">' + icon('download') + ' 导出学习备份</button>' +
    '<button class="secondary full" data-action="import-backup">' + icon('upload') + ' 从原生 / PWA JSON 备份恢复</button></div>' +
    '<div class="card stack"><h3>安装与使用</h3><button class="secondary full" data-action="open-install">' + icon('globe') + ' Safari 添加到主屏幕教程</button>' +
    '<p class="fineprint">词间 PWA 使用免费静态托管即可部署，核心功能可离线运行。离线大模型仍仅存在于原生版；云端 AI 可自行配置 API。</p></div></div>';
}
function modalBase(title, subtitle, content) {
  return '<div class="kicker" style="margin-bottom:7px">BETWEEN WORDS</div><h2 style="margin-bottom:7px">' + title + '</h2>' +
    (subtitle?'<p class="fineprint" style="margin-bottom:20px">' + subtitle + '</p>':'') + content;
}
function showStudySetup() {
  const b=book(), p=state.preferences;
  const select = [
    ['mixed','新旧混合','根据到期旧词与新词智能分配'],
    ['new','学习新词',newCount(state,b) + ' 个尚未学习的新词'],
    ['review','复习旧词',dueCount(state,b) + ' 个到期复习的词']
  ];
  showModal(modalBase('这一组，想怎么学？',esc(b.title)+' · 每组 '+p.groupSize+' 词',
    '<div class="stack tight">' + select.map(([key,title,desc]) =>
      '<button class="click-card ' + (ui.selectedPlan===key?'chosen':'') + '" data-action="select-plan" data-value="' + key + '">' +
      '<div class="flex"><strong>' + title + '</strong><p class="fineprint">' + desc + '</p></div>' + (ui.selectedPlan===key?icon('check'):icon('chevron')) + '</button>'
    ).join('') +
    '<button class="ghost full" data-action="toggle-advanced">调整设置 ' + icon('down') + '</button>' +
    (ui.showAdvanced ? '<div class="card soft stack tight">' +
      (ui.selectedPlan === 'mixed' ? '<label class="field-label">旧词比例：<b id="setup-ratio-value">' + p.mixedReviewPercent + '%</b></label><input id="setup-ratio" type="range" min="0" max="100" step="10" value="' + p.mixedReviewPercent + '">' : '') +
      '<p class="fineprint">本组使用：' + p.modes.map(m => ({choice:'选择',spelling:'拼写',flashcard:'闪卡'})[m]).join('、') + '。</p></div>' : '') +
    '<button class="primary full" data-action="start-study">开始本组学习 ' + icon('arrow') + '</button></div>'));
}
function showImport() {
  showModal(modalBase('导入个人词书',
    '支持 PDF、照片（JPG/PNG/WebP）、TXT/CSV/TSV 和粘贴文字。扫描件会在本机识别，不上传服务器。',
    '<div class="stack">' +
    '<label><span class="field-label">词书名称</span><input class="field" id="import-title" value="' + esc(ui.importTitle) + '" maxlength="70"></label>' +
    '<button class="secondary full" data-action="choose-import-file"' + (ui.importBusy ? ' disabled':'') + '>' +
       icon('upload') + (ui.importBusy ? ' 正在识别文件…' : ' 从文件或照片导入') + '</button>' +
    '<div id="import-progress" class="fineprint" aria-live="polite">' + esc(ui.importStatus) + '</div>' +
    '<label class="check-choice"><input type="checkbox" id="import-scan-prose"' + (ui.importAllKnown?' checked':'') + '>' +
      '<div><strong>从文章提取单词</strong><small>启用后，会从正文筛选内置词库中已收录的英文词；可能包含常见词</small></div></label>' +
    '<label><span class="field-label">文字识别结果 / 可编辑词表</span><textarea class="field" id="import-text" placeholder="access,获取；访问\nproject,项目\nresilience,韧性">' + esc(ui.importText) + '</textarea></label>' +
    '<div class="row between"><span class="fineprint">可编辑或删除识别错误，再预览</span>' +
      '<button class="ghost small-btn" data-action="clear-import">清空</button></div>' +
    '<button class="secondary full" data-action="preview-import"' + (ui.importBusy?' disabled':'') + '>' + icon('search') + ' 预览与核对</button>' +
    (ui.importPreview ? '<div class="card soft stack tight"><p><strong>可导入 ' + ui.importPreview.words.length +
       ' 个有效词</strong> · ' + ui.importPreview.ambiguous.length + ' 行需要核对</p>' +
       (ui.importPreview.ambiguous.length ? '<p class="fineprint">未能匹配的内容：' +
       esc(ui.importPreview.ambiguous.slice(0,8).join(' / ')) + '</p>' : '') +
       '<p class="fineprint">只保存已确认的英文词与已有释义；不会猜测未知单词的中文含义。</p>' +
       '<button class="primary full" data-action="save-import"' + (!ui.importPreview.words.length?' disabled':'') +
       '>保存 ' + ui.importPreview.words.length + ' 个词条</button></div>' : '') +
    '</div>'));
}
function showWordDetails(id) {
  const w=dictionary.get(normalizeTerm(id));
  if (!w) { toast('没有找到词条');return; }
  ui.detail=w.id;
  const p=getProgress(state,w.id);
  const bookmarked=state.bookmarks.includes(w.id);
  showModal(modalBase(esc(w.term),esc(w.phonetic||'来自当前词书的中文释义'),
    '<div class="stack"><div class="study-meaning" style="text-align:left">' + esc(w.meaning) + '</div>' +
    (w.example ? '<p class="fineprint">' + esc(w.example) + '</p>' : '') +
    '<div class="row"><button class="secondary small-btn" data-action="speak" data-id="' + esc(w.id) + '">' + icon('sound') + ' 听发音</button>' +
    '<button class="secondary small-btn" data-action="bookmark" data-id="' + esc(w.id) + '">' + icon('bookmark') + (bookmarked?'取消收藏':'加入生词本') + '</button></div>' +
    '<button class="secondary full" data-action="ai-from-word" data-id="' + esc(w.id) + '">' + icon('spark') + ' AI 辅助理解这个单词</button>' +
    '<div class="rule"></div>' +
    '<p class="fineprint">学习状态：' + (!p?'尚未学习':isMastered(p)?'已掌握':'下次复习 '+esc(dueText(p.dueDate))) + '</p>' +
    (p ? '<button class="secondary full" data-action="toggle-mastered" data-id="' + esc(w.id) + '">' + (isMastered(p)?'恢复为待复习':'标记为已掌握') + '</button>' : '') +
    '</div>'));
}
function showInstall() {
  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  showModal(modalBase('把词间带在身边','无需 App Store，无需 Apple 开发者账号，也不需要每 7 天刷新签名。',
    (installed?'<p class="tag">你已通过主屏幕启动词间</p>':'') +
    '<div class="install-steps"><p>用 iPhone 的 <strong>Safari</strong> 打开部署后的 HTTPS 网址。</p>' +
    '<p>点击 Safari 的<strong>分享</strong>按钮（方框向上箭头）。</p>' +
    '<p>向下找到并选择<strong>添加到主屏幕</strong>，开启<strong>以网页应用打开</strong>（Open as Web App），再确认名称「词间」。</p>' +
    '<p>从 iPhone 主屏幕点击图标进入。打开过一次并完成缓存后，即可离线学习。</p></div>' +
    '<div class="card soft stack tight" style="margin-top:18px"><strong>需要知道</strong>' +
    '<p class="fineprint">学习数据仅存于此设备；清除 Safari 网站数据可能导致记录丢失。正式域名和 HTTPS 是 PWA 安装及 Service Worker 离线功能的前提。</p></div>'));
}
function setBookmark(id) {
  if (state.bookmarks.includes(id)) state.bookmarks = state.bookmarks.filter(x=>x!==id);
  else state.bookmarks.push(id);
  persist();
  if (!modal.hidden && ui.detail === id) showWordDetails(id);
  else render();
}
function maybeSound(correct) {
  if (!state.preferences.soundFeedback || !window.AudioContext && !window.webkitAudioContext) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(correct?650:300,ctx.currentTime);
    gain.gain.setValueAtTime(.0001,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.045,ctx.currentTime+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.15);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+.16);
    osc.onended=()=>ctx.close();
  } catch {}
}
function decide(correct, selected = '') {
  if (ui.pending) return;
  ui.pending={correct,selected};
  maybeSound(correct);
  render();
}
function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function handleAction(button) {
  const action=button.dataset.action;
  const id=button.dataset.id;
  if (action==='page'){go(button.dataset.page);return;}
  if (action==='ai-from-word'){
    const w=dictionary.get(id);
    if(w) ui.aiQuestion='解析单词 '+w.term+'，中文释义：'+w.meaning+'。请给出词性、常用义项、自然例句与易混词辨析。';
    go('ai');return;
  }
  if (action==='close-modal'){closeModal();return;}
  if (action==='toggle-drawer'){drawer.classList.contains('open')?closeDrawer():openDrawer();return;}
  if (action==='open-setup'){showStudySetup();return;}
  if (action==='continue-study'){go('study');return;}
  if (action==='select-plan'){ui.selectedPlan=button.dataset.value;showStudySetup();return;}
  if (action==='toggle-advanced'){ui.showAdvanced=!ui.showAdvanced;showStudySetup();return;}
  if (action==='start-study'){
    const result=beginSession(state,book(),ui.selectedPlan);
    if (!result.ok) {toast(result.reason);return;}
    persist();go('study');return;
  }
  if (action==='leave-study'){go('home');toast('本组进度已保存在本机');return;}
  if (action==='choice-answer'){if(!ui.pending){const ex=currentExercise(state);decide(id===ex.wordID,id);}return;}
  if (action==='spelling-hint'){ui.showHint=true;speak(currentWord().term);render();return;}
  if (action==='spelling-answer'){
    const input=document.querySelector('#spelling-input');
    if (!input || !input.value.trim()) {toast('请先输入单词');return;}
    const typed=input.value.trim();decide(typed.toLowerCase()===currentWord().term.toLowerCase(),typed);return;
  }
  if (action==='flip-card'){ui.showHint=true;render();return;}
  if (action==='flash-answer'){decide(button.dataset.value==='correct',button.dataset.value);return;}
  if (action==='study-next'){
    if(!ui.pending)return;
    const result=answerExercise(state,ui.pending.correct);
    persist();
    ui.pending=null;ui.pendingKey=null;
    if(result.finished){report=result.report;go('report');}
    else render();
    return;
  }
  if (action==='speak'){const w=dictionary.get(id);if(w)speak(w.term);return;}
  if (action==='word-detail'){showWordDetails(id);return;}
  if (action==='bookmark'){setBookmark(id);return;}
  if (action==='toggle-mastered'){
    const p=getProgress(state,id);
    isMastered(p)?unmarkMastered(state,id):markMastered(state,id);
    persist();showWordDetails(id);return;
  }
  if (action==='select-book'){
    if (state.session) {toast('正在学习的一组不受切换影响，仍使用原来的词书。');}
    state.selectedBook=id;ui.search='';ui.filter='all';persist();render();return;
  }
  if (action==='book-layout'){ui.bookLayout=button.dataset.value;render();return;}
  if (action==='delete-book'){
    const b=books.find(b=>b.id===id);
    if(!b||b.isBuiltin)return;
    if(!confirm('确定删除「'+b.title+'」？个人词书无法自动恢复，请先备份。'))return;
    state.customBooks=state.customBooks.filter(b=>b.id!==id);
    if(state.session?.bookID===id){state.session=null;ui.pending=null;ui.pendingKey=null;}
    if(state.selectedBook===id)state.selectedBook='cet4';
    rebuildBooks();persist();render();return;
  }
  if (action==='open-import'){ui.importPreview=null;showImport();return;}
  if (action==='choose-import-file'){importFile.click();return;}
  if (action==='clear-import'){
    if(ui.importBusy)return;
    ui.importText='';ui.importPreview=null;ui.importStatus='';showImport();return;
  }
  if (action==='preview-import'){
    ui.importPreview=resolveDocumentWords(ui.importText,dictionary,{includeAllKnown:ui.importAllKnown});
    showImport();return;
  }
  if (action==='save-import'){
    const preview=resolveDocumentWords(ui.importText,dictionary,{includeAllKnown:ui.importAllKnown});
    if(!preview.words.length){toast('没有识别到有效词条');return;}
    importBook(state,ui.importTitle,preview.words);
    rebuildBooks();persist();
    ui.importText='';ui.importPreview=null;
    go('library');toast('已添加 '+preview.words.length+' 个词条');return;
  }
  if (action==='show-report'){report=state.history[Number(button.dataset.index)];go('report');return;}
  if (action==='theme'){state.preferences.theme=button.dataset.value;persist();render();return;}
  if (action==='export-backup'){downloadJSON(exportState(state),'词间-PWA-学习备份-'+new Date().toISOString().slice(0,10)+'.json');toast('备份已生成');return;}
  if (action==='import-backup'){backupFile.click();return;}
  if (action==='ai-ask'){
    if(ui.aiBusy)return;
    const config=state.preferences.aiConfig || getAIConfig('qwen');
    ui.aiBusy=true;ui.aiOutput='';ui.aiError='';
    const currentQuestion=ui.aiQuestion;
    aiAbortController=new AbortController();
    render();
    const call=async()=>{
      try {
        const answer=await askCloudAI({...config,key:aiSessionKey,question:currentQuestion,signal:aiAbortController.signal});
        ui.aiOutput=answer;
      }catch(error){ui.aiError=error.message;}
      finally {ui.aiBusy=false;aiAbortController=null;if(page==='ai')render();}
    };
    call();return;
  }
  if (action==='ai-cancel'){aiAbortController?.abort();return;}
  if (action==='export-calendar'){
    try {
      const {content,events}=createReviewCalendar(state,book());
      const blob=new Blob([content],{type:'text/calendar;charset=utf-8'});
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='词间-未来14天复习日历.ics';
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      toast('已生成 '+events.length+' 个复习日程；请导入 iPhone 日历');
    }catch(error){toast(error.message);}
    return;
  }
  if (action==='cache-ocr'){
    if(!window.isSecureContext||!('caches' in window)){toast('离线资源预存需要 HTTPS 或 localhost');return;}
    if(!confirm('将下载约 35 MB 的浏览器本地英文 OCR 程序和语言资源，可能使用移动流量。继续吗？'))return;
    const urls=[
      './vendor/tesseract/core/tesseract-core.wasm.js','./vendor/tesseract/core/tesseract-core.wasm',
      './vendor/tesseract/core/tesseract-core-simd.wasm.js','./vendor/tesseract/core/tesseract-core-simd.wasm',
      './vendor/tesseract/core/tesseract-core-lstm.wasm.js','./vendor/tesseract/core/tesseract-core-lstm.wasm',
      './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js','./vendor/tesseract/core/tesseract-core-simd-lstm.wasm',
      './vendor/tesseract/lang/eng.traineddata.gz'
    ];
    (async()=>{
      let n=0;
      try{
        const cache=await caches.open('cijian-ocr-assets-v1');
        for(const url of urls){
          if(!await cache.match(url))await cache.add(url);
          n++;toast('离线识别包：'+n+'/'+urls.length+' 个资源');
        }
        toast('离线英文 OCR 资源已下载完成（未包括后续更新）');
      }catch(error){toast('离线 OCR 预存中断，可联网重试：'+error.message);}
    })();
    return;
  }
  if (action==='open-install'){showInstall();return;}
  if (action==='persist-storage'){
    if (!navigator.storage?.persist){toast('当前浏览器不支持持久化存储请求');return;}
    navigator.storage.persist().then(ok=>toast(ok?'浏览器已允许持久化存储':'浏览器未提供持久化授权；请定期备份')).catch(()=>toast('当前无法申请持久化存储'));
    return;
  }
}
document.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');
  if(!el)return;
  event.preventDefault();
  try{handleAction(el);}catch(error){console.error(error);toast('操作未完成：'+error.message);}
});
document.querySelector('#menu-button').addEventListener('click',openDrawer);
document.querySelector('#account-button').addEventListener('click',()=>go('account'));
backdrop.addEventListener('click',closeDrawer);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(!modal.hidden)closeModal();else closeDrawer();}
  if(event.key==='Enter'&&event.target.id==='spelling-input'&&!ui.pending){
    event.preventDefault();handleAction({dataset:{action:'spelling-answer'}});
  }
  if((event.key==='Enter'||event.key===' ') && event.target.classList.contains('word-text')){
    event.preventDefault();showWordDetails(event.target.dataset.id);
  }
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='word-search'){
    ui.search=el.value;
    const list=document.querySelector('#word-list');
    if(list)list.innerHTML=wordListHTML();
  }
  if(el.id==='spelling-input'&&state.session){state.session.draftSpelling=el.value;persist();}
  if(el.id==='import-text'){ui.importText=el.value;ui.importPreview=null;}
  if(el.id==='import-title'){ui.importTitle=el.value;}
  if(el.id==='ai-question'){ui.aiQuestion=el.value;}
  if(el.id==='ai-key'){aiSessionKey=el.value;}
  if(el.id==='mixed-ratio'||el.id==='setup-ratio'){
    state.preferences.mixedReviewPercent=Number(el.value);
    persist();
    const label=document.querySelector(el.id==='mixed-ratio'?'#ratio-value':'#setup-ratio-value');
    if(label)label.textContent=el.value+'%';
  }
});
document.addEventListener('change',event=>{
  const el=event.target, p=state.preferences;
  if(el.id==='word-filter'){ui.filter=el.value;const list=document.querySelector('#word-list');if(list)list.innerHTML=wordListHTML();return;}
  if(el.id==='import-scan-prose'){ui.importAllKnown=el.checked;ui.importPreview=null;return;}
  if(el.id==='ai-provider'){
    state.preferences.aiConfig=getAIConfig(el.value);
    persist();render();return;
  }
  if(el.id==='ai-base'||el.id==='ai-model'){
    const old=state.preferences.aiConfig || getAIConfig('qwen');
    state.preferences.aiConfig={...old,[el.id==='ai-base'?'baseURL':'model']:el.value.trim()};
    persist();return;
  }
  if(el.id==='nickname'){state.nickname=el.value.trim().slice(0,30);persist();render();return;}
  if(el.id==='accent'){p.accent=el.value;persist();return;}
  if(el.id==='speech-rate'){p.speechRate=Math.max(.7,Math.min(1.45,Number(el.value)||1));persist();return;}
  if(el.id==='auto-pronounce'){p.autoPronounce=el.checked;persist();return;}
  if(el.id==='sound-feedback'){p.soundFeedback=el.checked;persist();return;}
  if(el.id==='group-size'){p.groupSize=Number(el.value);persist();return;}
  if(el.id==='mode-spelling'||el.id==='mode-flashcard'){
    const mode=el.id==='mode-spelling'?'spelling':'flashcard';
    p.modes=['choice',...['spelling','flashcard'].filter(m=>m===mode?el.checked:p.modes.includes(m))];
    persist();return;
  }
  if(el.dataset.interval!==undefined){
    p.intervalsHours[Number(el.dataset.interval)]=Number(el.value);
    persist();return;
  }
});
importFile.addEventListener('change',async()=>{
  const file=importFile.files[0];
  if(!file)return;
  ui.importBusy=true;ui.importStatus='正在读取 '+file.name+'…';ui.importPreview=null;
  showImport();
  try {
    const result=await extractImportFile(file,{
      scanImages:true,
      onProgress:(status,percent)=>{
        ui.importStatus=status+(percent>0?' · '+Math.round(percent*100)+'%':'');
        const el=document.querySelector('#import-progress');
        if(el)el.textContent=ui.importStatus;
      }
    });
    if(!result.text.trim())throw Error('没有提取到文字。请换一张更清晰的照片，或尝试拆分 PDF');
    if(result.text.length>250_000)throw Error('文本过长，请拆分文件后导入');
    ui.importText=ui.importText.trim()?ui.importText+'\n'+result.text:result.text;
    ui.importPreview=resolveDocumentWords(ui.importText,dictionary,{includeAllKnown:ui.importAllKnown});
    ui.importStatus='读取完成 · '+(result.pages?result.pages+' 页 · ':'')+
      (result.truncated?'超过 25 页的部分尚未处理 · ':'')+
      '建议核对识别文本';
    toast('提取完成：'+ui.importPreview.words.length+' 个有效词条');
  }catch(error){
    ui.importStatus='读取失败：'+error.message;toast(ui.importStatus);
  }finally{
    ui.importBusy=false;
    importFile.value='';
    showImport();
  }
});
backupFile.addEventListener('change',async()=>{
  const file=backupFile.files[0];if(!file)return;
  try{
    const raw=JSON.parse(await file.text());
    const restored=importState(raw);
    if(!confirm('确定恢复备份？会替换当前设备的个人词书、学习记录和设置。原生账户身份不会导入，建议先导出当前 PWA 数据。'))return;
    state=restored;rebuildBooks();persist();go('account');toast('学习备份已恢复');
  }catch(error){toast('恢复失败：'+error.message);}
  backupFile.value='';
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installedPrompt=event;});
window.addEventListener('appinstalled',()=>toast('词间已添加到主屏幕'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.preferences.theme==='system')applyTheme();});
window.addEventListener('pageshow',()=>{if(books.length&&page==='home')render();});

async function initialize() {
  try {
    const [p4,p6,stored]=await Promise.all([
      fetch('./data/cet4.tsv').then(r=>{if(!r.ok)throw Error('CET-4 数据请求失败');return r.text();}),
      fetch('./data/cet6.tsv').then(r=>{if(!r.ok)throw Error('CET-6 数据请求失败');return r.text();}),
      loadState()
    ]);
    builtin4 = parseTSV(p4);
    builtin6 = parseTSV(p6);
    if(!builtin4.length||!builtin6.length)throw Error('内置词库没有读到有效数据');
    state=hydrateState(stored);
    rebuildBooks();
    render();
    if('setAppBadge' in navigator) {
      const badgeCount=dueCount(state,book());
      Promise.resolve(badgeCount?navigator.setAppBadge(badgeCount):navigator.clearAppBadge()).catch(()=>{});
    }
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('离线服务未启动',e));
    }
  } catch(error) {
    console.error(error);
    view.innerHTML='<div class="card stack"><h2>词间尚未准备好</h2><p class="fineprint">'+esc(error.message)+'</p>'+
      '<p>请通过 HTTPS 站点或本地服务器运行，首次打开时连接网络完成词库缓存。</p><button class="primary" id="retry">重新加载</button></div>';
    document.querySelector('#retry')?.addEventListener('click',()=>location.reload());
  }
}
initialize();
