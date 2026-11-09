/* 词间 PWA core. Ported from Cijian/Services/LearningStore.swift.
   Pure functions, intentionally independent of browsers or network. */
export const DEFAULT_PREFERENCES = Object.freeze({
  groupSize: 10,
  modes: ['choice', 'spelling', 'flashcard'],
  mixedReviewPercent: 60,
  intervalsHours: [1 / 3, 24, 48, 96, 168, 360, 720],
  accent: 'en-US',
  autoPronounce: true,
  speechRate: 1.02,
  soundFeedback: true,
  theme: 'system'
});
export const MODES = ['choice', 'spelling', 'flashcard'];

export function normalizeTerm(value) {
  return String(value || '').trim().toLowerCase().replace(/’/g, "'");
}
export function validTerm(value) {
  return /^[a-z][a-z'’-]{0,44}$/i.test(String(value || '').trim());
}
export function parseTSV(text) {
  const seen = new Set();
  const result = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const term = line.slice(0, tab).trim();
    const meaning = line.slice(tab + 1).trim();
    const id = normalizeTerm(term);
    if (!validTerm(term) || !meaning || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, term, meaning, example: '', phonetic: '', partOfSpeech: '' });
  }
  return result;
}
export function initialState() {
  return {
    version: 1,
    selectedBook: 'cet4',
    progress: {},
    bookmarks: [],
    customBooks: [],
    history: [],
    session: null,
    nickname: '',
    preferences: { ...DEFAULT_PREFERENCES, modes: [...MODES], intervalsHours: [...DEFAULT_PREFERENCES.intervalsHours] }
  };
}
export function canonicalModes(input) {
  const selected = Array.isArray(input) ? input : MODES;
  return MODES.filter(m => m === 'choice' || selected.includes(m));
}
export function hydrateState(value) {
  const defaults = initialState();
  if (!value || typeof value !== 'object') return defaults;
  const pref = (value.preferences && typeof value.preferences === 'object') ? value.preferences : {};
  const restored = {
    ...defaults,
    ...value,
    progress: value.progress && typeof value.progress === 'object' && !Array.isArray(value.progress) ? value.progress : {},
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks : [],
    customBooks: Array.isArray(value.customBooks) ? value.customBooks : [],
    history: Array.isArray(value.history) ? value.history.slice(0, 40) : [],
    preferences: {
      ...defaults.preferences, ...pref,
      modes: canonicalModes(pref.modes),
      intervalsHours: Array.isArray(pref.intervalsHours) && pref.intervalsHours.length ? pref.intervalsHours : defaults.preferences.intervalsHours
    }
  };
  if (!['cet4', 'cet6'].includes(restored.selectedBook) &&
      !restored.customBooks.some(b => b.id === restored.selectedBook)) {
    restored.selectedBook = 'cet4';
  }
  return restored;
}
export function createBooks(cet4, cet6, customBooks = []) {
  return [
    { id: 'cet4', title: '大学英语四级 CET-4', isBuiltin: true, tint: 'sage', words: cet4 },
    { id: 'cet6', title: '大学英语六级 CET-6', isBuiltin: true, tint: 'forest', words: cet6 },
    ...customBooks.filter(b => b && Array.isArray(b.words))
  ];
}
export function selectedBook(state, books) {
  return books.find(b => b.id === state.selectedBook) || books[0];
}
export function wordLookup(books) {
  const dict = new Map();
  for (const book of books) for (const w of book.words) {
    if (!dict.has(w.id)) dict.set(w.id, w);
  }
  return dict;
}
export function getProgress(state, id) {
  return state.progress[normalizeTerm(id)] || null;
}
export function isMastered(progress) {
  return Boolean(progress && (progress.manuallyMastered || progress.automaticallyMastered));
}
export function isDue(progress, now = Date.now()) {
  return Boolean(progress && !isMastered(progress) && Number(progress.dueDate) <= now);
}
export function newCount(state, book) {
  return book.words.filter(w => !getProgress(state, w.id)).length;
}
export function dueCount(state, book, now = Date.now()) {
  return book.words.filter(w => isDue(getProgress(state, w.id), now)).length;
}
export function shuffle(input, random = Math.random) {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function beginSession(state, book, plan = 'mixed', now = Date.now(), random = Math.random) {
  if (state.session) return { ok: false, reason: '已有未完成的学习进度，请继续当前学习或先结束本组。' };
  const prefs = state.preferences;
  const newWords = shuffle(book.words.filter(w => !getProgress(state, w.id)), random);
  const dueWords = shuffle(book.words.filter(w => isDue(getProgress(state, w.id), now)), random);
  const group = Math.max(1, Math.min(100, Number(prefs.groupSize) || 10));
  let chosen = [];
  if (plan === 'new') chosen = newWords.slice(0, group);
  else if (plan === 'review') chosen = dueWords.slice(0, group);
  else {
    const portion = Math.max(0, Math.min(100, Number(prefs.mixedReviewPercent) || 0));
    const reviewTarget = Math.round(group * portion / 100);
    chosen = dueWords.slice(0, reviewTarget);
    chosen.push(...newWords.slice(0, group - chosen.length));
    const set = new Set(chosen.map(w => w.id));
    if (chosen.length < group) chosen.push(...[...dueWords, ...newWords].filter(w => !set.has(w.id)).slice(0, group - chosen.length));
    chosen = shuffle(chosen, random);
  }
  if (!chosen.length) {
    return { ok: false, reason: plan === 'new' ? '当前词书已没有新词' : plan === 'review' ? '当前没有到期复习的词' : '目前没有新词或到期的旧词' };
  }
  state.session = {
    bookID: book.id, plan, queue: chosen.map(w => ({ wordID: w.id, mode: 'choice', round: 1, retry: false })),
    index: 0, originallySelected: chosen.length, activeModes: canonicalModes(prefs.modes),
    finishedModes: {}, failedWords: [], finishedWords: [], totalAnswered: 0, correctAnswers: 0,
    startedAt: now, draftSpelling: ''
  };
  return { ok: true, session: state.session };
}
export function currentExercise(state) {
  const s = state.session;
  return s && s.index < s.queue.length ? s.queue[s.index] : null;
}
export function progressGates(state) {
  const s = state.session;
  if (!s) return { passed: 0, total: 1, percent: 0 };
  const modes = canonicalModes(s.activeModes);
  const seen = new Set();
  let passed = 0;
  for (const ex of s.queue) {
    if (seen.has(ex.wordID)) continue;
    seen.add(ex.wordID);
    if (s.finishedWords.includes(ex.wordID)) passed += modes.length;
    else passed += (s.finishedModes[ex.wordID] || []).filter(m => modes.includes(m)).length;
  }
  const total = Math.max(1, s.originallySelected * modes.length);
  return { passed: Math.min(passed, total), total, percent: Math.round(100 * Math.min(passed, total) / total) };
}
function recordWord(state, id, success, now) {
  const old = state.progress[id] || {};
  const prefs = state.preferences;
  const today = new Date(now).toLocaleDateString('en-CA');
  const successfulDays = Array.isArray(old.successfulDays) ? [...old.successfulDays] : [];
  if (success && !successfulDays.includes(today)) successfulDays.push(today);
  const intervals = prefs.intervalsHours.filter(n => Number.isFinite(Number(n)) && Number(n) > 0);
  const safeIntervals = intervals.length ? intervals : DEFAULT_PREFERENCES.intervalsHours;
  const step = success ? Math.min((old.step || 0) + 1, safeIntervals.length - 1) : 0;
  state.progress[id] = {
    dueDate: now + Number(safeIntervals[step]) * 3600 * 1000,
    step, attempts: (old.attempts || 0) + 1, successfulDays,
    manuallyMastered: Boolean(old.manuallyMastered),
    automaticallyMastered: Boolean(old.automaticallyMastered) || successfulDays.length >= 3
  };
}
function finishSession(state, now) {
  const s = state.session;
  if (!s) return null;
  const result = {
    ...s, completedAt: now,
    failedWords: [...s.failedWords],
    finishedWords: [...s.finishedWords],
    finishedModes: { ...s.finishedModes }
  };
  state.history.unshift(result);
  state.history = state.history.slice(0, 40);
  state.session = null;
  return result;
}
export function answerExercise(state, correct, now = Date.now()) {
  const s = state.session;
  if (!s || s.index >= s.queue.length) return { ok: false };
  const ex = s.queue[s.index];
  const modes = canonicalModes(s.activeModes);
  s.totalAnswered++;
  s.draftSpelling = '';
  if (correct) {
    s.correctAnswers++;
    const passed = s.finishedModes[ex.wordID] || [];
    if (!passed.includes(ex.mode)) passed.push(ex.mode);
    s.finishedModes[ex.wordID] = passed;
    const nextMode = modes.find(m => !passed.includes(m));
    if (nextMode) {
      const next = { wordID: ex.wordID, mode: nextMode, round: modes.indexOf(nextMode) + 1, retry: false };
      // Successfully completed stages are interleaved after two other exercises.
      const insertAt = Math.min(s.queue.length, s.index + 3);
      s.queue.splice(insertAt, 0, next);
    } else if (!s.finishedWords.includes(ex.wordID)) {
      s.finishedWords.push(ex.wordID);
      recordWord(state, ex.wordID, !s.failedWords.includes(ex.wordID), now);
    }
  } else {
    if (!s.failedWords.includes(ex.wordID)) s.failedWords.push(ex.wordID);
    const retry = { ...ex, retry: true };
    const gap = Math.min(3, s.queue.length - s.index - 1);
    s.queue.splice(s.index + 1 + gap, 0, retry);
  }
  s.index++;
  if (s.index >= s.queue.length) {
    const report = finishSession(state, now);
    return { ok: true, finished: true, report };
  }
  return { ok: true, finished: false, next: currentExercise(state) };
}
export function skipExercise(state, now = Date.now()) {
  return answerExercise(state, false, now);
}
export function markMastered(state, wordID) {
  const id = normalizeTerm(wordID);
  const old = state.progress[id] || {};
  state.progress[id] = { ...old, dueDate: Date.now(), step: old.step || 0,
    attempts: old.attempts || 0, successfulDays: old.successfulDays || [],
    manuallyMastered: true, automaticallyMastered: Boolean(old.automaticallyMastered) };
}
export function unmarkMastered(state, wordID) {
  const id = normalizeTerm(wordID);
  const old = state.progress[id] || {};
  state.progress[id] = { ...old, dueDate: Date.now(), step: 0,
    attempts: old.attempts || 0, successfulDays: [],
    manuallyMastered: false, automaticallyMastered: false };
}
export function previewImport(text, existing = new Map()) {
  const words = [], ambiguous = [], seen = new Set();
  for (const entry of String(text || '').split(/\r?\n/).slice(0, 5000)) {
    const line = entry.trim();
    if (!line || /^word[\t,，]/i.test(line) || /^单词[\t,，]/.test(line)) continue;
    let term = '', meaning = '', example = '';
    const csv = line.match(/^([A-Za-z][A-Za-z'’-]{0,44})[\t,，:：;；]\s*(.+)$/);
    const spaced = line.match(/^([A-Za-z][A-Za-z'’-]{0,44})\s+([\u3400-\u9FFF].+)$/);
    if (csv || spaced) {
      term = (csv || spaced)[1].trim();
      const rest = (csv || spaced)[2].trim().replace(/^["']|["']$/g, '');
      const split = rest.indexOf(',');
      meaning = (split >= 0 ? rest.slice(0, split) : rest).trim();
      example = split >= 0 ? rest.slice(split + 1).trim() : '';
    } else if (validTerm(line) && existing.has(normalizeTerm(line))) {
      const found = existing.get(normalizeTerm(line));
      term = found.term; meaning = found.meaning; example = found.example || '';
    } else {
      if (ambiguous.length < 200) ambiguous.push(line);
      continue;
    }
    const id = normalizeTerm(term);
    if (!validTerm(term) || !meaning) {
      if (ambiguous.length < 200) ambiguous.push(line);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const known = existing.get(id) || {};
    words.push({ id, term, meaning,
      example: example || known.example || '',
      partOfSpeech: known.partOfSpeech || '', phonetic: known.phonetic || '' });
  }
  return { words, ambiguous };
}
export function importBook(state, title, words) {
  if (!Array.isArray(words) || !words.length) throw new Error('没有有效词条');
  const id = 'custom-' + crypto.randomUUID();
  state.customBooks.push({ id, title: String(title || '').trim() || '我的词书',
    isBuiltin: false, tint: 'brown', words });
  state.selectedBook = id;
  return id;
}
export function exportState(state) {
  return { product: '词间 PWA', exportedAt: new Date().toISOString(),
    schema: 1, data: hydrateState(state) };
}
const SWIFT_REFERENCE_OFFSET_SECONDS = 978307200;
const SWIFT_MODES = Object.freeze({
  '释义选择':'choice', '拼写':'spelling', '闪卡':'flashcard',
  choice:'choice', spelling:'spelling', flashcard:'flashcard'
});
export function convertSwiftDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Foundation JSONEncoder defaults to seconds since Jan 1 2001 UTC.
    if (value > 1e12) return value;
    if (value > 1e10) return value * 1000;
    return (value + SWIFT_REFERENCE_OFFSET_SECONDS) * 1000;
  }
  if (typeof value === 'string') {
    const ms=Date.parse(value);
    return Number.isFinite(ms)?ms:null;
  }
  return null;
}
function swiftMode(mode) { return SWIFT_MODES[String(mode)] || null; }
function migrateSwiftSession(session, knownBooks) {
  if (!session || typeof session !== 'object' || !Array.isArray(session.queue)) return null;
  const oldBook=knownBooks.find(b=>b.nativeID===session.bookID);
  const bookID=oldBook?.id || 'cet4';
  const finishedModes={};
  for (const [id,modes] of Object.entries(session.finishedModes||{})) {
    if (Array.isArray(modes)) finishedModes[normalizeTerm(id)]=modes.map(swiftMode).filter(Boolean);
  }
  return {
    bookID,plan:session.reviewOnly?'review':'mixed',
    queue:session.queue.map(ex=>({
      wordID:normalizeTerm(ex.wordID),mode:swiftMode(ex.mode)||'choice',
      round:Number(ex.round)||1,retry:Boolean(ex.retry)
    })).filter(ex=>validTerm(ex.wordID)),
    index:Math.max(0,Math.min(Number(session.index)||0,session.queue.length)),
    originallySelected:Math.max(0,Number(session.originallySelected)||0),
    activeModes:canonicalModes((session.activeModes||['释义选择','拼写','闪卡']).map(swiftMode).filter(Boolean)),
    finishedModes,
    failedWords:Array.isArray(session.failedWords)?session.failedWords.map(normalizeTerm):[],
    finishedWords:Array.isArray(session.finishedWords)?session.finishedWords.map(normalizeTerm):[],
    totalAnswered:Number(session.totalAnswered)||0,
    correctAnswers:Number(session.correctAnswers)||0,
    startedAt:convertSwiftDate(session.started)||Date.now(),
    completedAt:convertSwiftDate(session.completedAt),
    draftSpelling:String(session.draftSpelling||'')
  };
}
export function importNativeBackup(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.books) ||
    !doc.preferences || !doc.progress || Array.isArray(doc.progress)) {
    throw new Error('不是可识别的词间 iPhone 原生备份');
  }
  const state=initialState();
  const importedBooks=[];
  for (const b of doc.books.slice(0,90)) {
    if (!b || typeof b !== 'object') continue;
    const rawID=String(b.id||'');
    if (b.isBuiltin) {
      importedBooks.push({
        nativeID:rawID,id:String(b.title||'').includes('六级')?'cet6':'cet4'
      });
      continue;
    }
    if(!Array.isArray(b.words))continue;
    const seen=new Set(), words=[];
    for(const w of b.words.slice(0,8000)){
      if(!w||!validTerm(w.term)||!String(w.meaning||'').trim())continue;
      const id=normalizeTerm(w.term);
      if(seen.has(id))continue;
      seen.add(id);
      words.push({
        id,term:String(w.term).trim(),meaning:String(w.meaning).trim(),
        partOfSpeech:String(w.partOfSpeech||'').slice(0,60),
        phonetic:String(w.phonetic||'').slice(0,100),
        example:String(w.example||'').slice(0,600)
      });
    }
    if(words.length){
      const id='native-'+rawID;
      state.customBooks.push({
        id,title:String(b.title||'我的词书').slice(0,80),isBuiltin:false,
        tint:String(b.tint||'brown'),words
      });
      importedBooks.push({nativeID:rawID,id});
    }
  }
  const selected=importedBooks.find(b=>b.nativeID===doc.selectedBookID);
  if(selected)state.selectedBook=selected.id;
  for(const [key,value] of Object.entries(doc.progress).slice(0,30000)){
    if(!validTerm(key)||!value||typeof value!=='object')continue;
    const id=normalizeTerm(key);
    const dueDate=convertSwiftDate(value.dueDate)||Date.now();
    state.progress[id]={
      dueDate,step:Math.max(0,Number(value.step)||0),
      attempts:Math.max(0,Number(value.attempts)||0),
      successfulDays:Array.isArray(value.successfulDays)?value.successfulDays.map(String).slice(0,300):[],
      manuallyMastered:Boolean(value.manuallyMastered),
      automaticallyMastered:Boolean(value.automaticallyMastered)
    };
  }
  if(Array.isArray(doc.bookmarks))
    state.bookmarks=[...new Set(doc.bookmarks.filter(validTerm).map(normalizeTerm))].slice(0,30000);
  const pref=doc.preferences;
  state.preferences.modes=canonicalModes((pref.modes||[]).map(swiftMode).filter(Boolean));
  state.preferences.groupSize=Math.min(100,Math.max(1,Number(pref.groupSize)||10));
  if(Number.isFinite(Number(pref.mixedReviewPercent)))
    state.preferences.mixedReviewPercent=Math.max(0,Math.min(100,Number(pref.mixedReviewPercent)));
  if(Array.isArray(pref.reviewIntervalsHours)&&pref.reviewIntervalsHours.length)
    state.preferences.intervalsHours=pref.reviewIntervalsHours.map(Number).filter(x=>Number.isFinite(x)&&x>0).slice(0,20);
  if(['en-US','en-GB'].includes(pref.preferredAccent))state.preferences.accent=pref.preferredAccent;
  if(typeof pref.autoPronounce==='boolean')state.preferences.autoPronounce=pref.autoPronounce;
  if(typeof pref.soundFeedback==='boolean')state.preferences.soundFeedback=pref.soundFeedback;
  state.preferences.theme=pref.appearanceMode==='dark'||pref.appearanceMode==='light'
    ?pref.appearanceMode:pref.darkTheme?'dark':'system';
  state.nickname=String(doc.profile?.nickname||'').slice(0,30);
  state.session=migrateSwiftSession(doc.session,importedBooks);
  if(Array.isArray(doc.reportHistory)){
    state.history=doc.reportHistory.slice(0,40)
      .map(x=>migrateSwiftSession(x,importedBooks))
      .filter(Boolean);
  }
  // Excludes Apple ID, phone numbers, authentication state and avatarData.
  return hydrateState(state);
}
export function importState(document) {
  if (document && document.product === '词间 PWA' && document.data) {
    return hydrateState(document.data);
  }
  if (document && Array.isArray(document.books) && document.progress && document.preferences)
    return importNativeBackup(document);
  throw new Error('文件不是有效的词间备份（支持原生 iPhone 版和 PWA 版 JSON）');
}
