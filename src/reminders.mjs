/* Offline reminder export as iCalendar. No server and no hidden push delivery. */
function calendarEscape(value) {
  return String(value||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}
function stamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
}
export function nextReviewEvents(state,book,now=Date.now(),days=14) {
  const max=now+days*86400000;
  const byDay=new Map();
  for(const w of book.words||[]) {
    const p=state.progress?.[w.id];
    if(!p||p.manuallyMastered||p.automaticallyMastered||!Number.isFinite(Number(p.dueDate)))continue;
    let when=Number(p.dueDate);
    if(when<now)when=now+5*60000;
    if(when>max)continue;
    const day=new Date(when).toLocaleDateString('en-CA');
    const entry=byDay.get(day);
    if(entry){entry.count++;entry.start=Math.min(entry.start,when);}
    else byDay.set(day,{day,start:when,count:1});
  }
  return [...byDay.values()].sort((a,b)=>a.start-b.start).slice(0,14);
}
export function createReviewCalendar(state,book,now=Date.now()) {
  const events=nextReviewEvents(state,book,now);
  if(!events.length)throw new Error('未来 14 天内没有待安排的复习词。完成一组学习后再导出。');
  const start=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cijian//Review Schedule//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:词间复习'];
  const lines=[...start];
  for(const entry of events){
    const id='cijian-'+book.id+'-'+entry.day.replace(/-/g,'')+'@betweenwords.local';
    const began=entry.start;
    lines.push(
      'BEGIN:VEVENT',
      'UID:'+calendarEscape(id),
      'DTSTAMP:'+stamp(now),
      'DTSTART:'+stamp(began),
      'DTEND:'+stamp(began+15*60000),
      'SUMMARY:'+calendarEscape('词间 · 复习 '+entry.count+' 个单词'),
      'DESCRIPTION:'+calendarEscape(book.title+'。打开词间，选择复习旧词。此日历不会在你完成学习后自动同步变化。'),
      'BEGIN:VALARM',
      'TRIGGER:-PT5M',
      'ACTION:DISPLAY',
      'DESCRIPTION:'+calendarEscape('词间复习时间到了'),
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return {content:lines.join('\r\n')+'\r\n',events};
}
