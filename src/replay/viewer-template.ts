/**
 * Self-contained HTML viewer. The recording is inlined so the file can be
 * opened straight from disk with no server, no build and no network — a debug
 * tool should never need infrastructure to look at.
 */
export function renderViewer(recordingJson: string): string {
  return `<meta charset="utf-8">
<title>agentic-world — replay</title>
<style>
  :root { --bg:#10131a; --panel:#161a24; --fg:#dde1ea; --dim:#7b8494; --line:#262c3a; --accent:#7dd3fc; }
  * { box-sizing:border-box }
  html,body { height:100% }
  body { margin:0; background:var(--bg); color:var(--fg); overflow:hidden;
         font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
         display:flex; flex-direction:column }

  /* status bar */
  header { display:flex; align-items:center; gap:18px; padding:8px 14px;
           border-bottom:1px solid var(--line); background:var(--panel); flex:none }
  .clock { font-size:20px; font-weight:700; color:var(--accent);
           font-variant-numeric:tabular-nums; letter-spacing:.02em }
  .day { color:var(--dim); font-size:12px }
  .phase { font-size:11px; padding:2px 8px; border-radius:10px; background:#1e2534; color:var(--dim) }
  button { background:#1e2431; color:var(--fg); border:1px solid var(--line);
           border-radius:4px; padding:4px 12px; cursor:pointer; font:inherit }
  button:hover { border-color:var(--accent) }
  select { background:#1e2431; color:var(--fg); border:1px solid var(--line);
           border-radius:4px; padding:3px 6px; font:inherit }
  .grow { flex:1 }
  .meta { color:var(--dim); font-size:11px }
  #scrub { width:100%; accent-color:var(--accent); margin:0 }
  .scrubwrap { padding:6px 14px; border-bottom:1px solid var(--line); background:var(--panel); flex:none }

  /* two columns */
  main { flex:1; display:grid; grid-template-columns:1fr 420px; min-height:0 }
  #left { padding:12px; overflow:auto; border-right:1px solid var(--line) }
  #right { padding:12px; overflow:auto; display:flex; flex-direction:column; gap:10px }

  #grid { position:relative; display:grid; gap:4px; margin-bottom:12px }
  .cell { position:relative; border:1px solid transparent; border-radius:4px;
          min-height:52px; display:flex; flex-direction:column; align-items:center;
          justify-content:center; gap:1px }
  .cell.venue { background:#141822; border-color:var(--line) }
  .cell .g { font-size:15px; color:#6b7688; line-height:1 }
  .cell .n { font-size:9px; color:var(--dim); text-align:center; line-height:1.1;
             max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  #people { position:absolute; inset:0; pointer-events:none }
  .agent { position:absolute; width:18px; height:18px; margin:-9px 0 0 -9px;
           border-radius:50%; display:flex; align-items:center; justify-content:center;
           font-size:10px; font-weight:700; color:#0d1017; border:1.5px solid #0d1017;
           transition:left .1s linear, top .1s linear }

  table { width:100%; border-collapse:collapse; font-size:12px }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.07em;
       color:var(--dim); font-weight:500; padding:0 6px 4px }
  td { padding:2px 6px; white-space:nowrap; border-top:1px solid var(--line) }
  td.num { text-align:right; font-variant-numeric:tabular-nums }
  .neg { color:#f87171 }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px }

  h2 { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim);
       margin:0 0 6px; font-weight:500 }
  .feed { flex:1; overflow:auto; display:flex; flex-direction:column; gap:8px }
  .ev { border-left:2px solid var(--line); padding:4px 0 4px 10px }
  .ev.now { border-left-color:var(--accent) }
  .ev .when { color:var(--dim); font-size:10px }
  .ev .head { font-weight:600; color:#e879f9 }
  .line { margin:3px 0 }
  .line b { color:var(--accent); font-weight:600 }
  .outcome { color:var(--dim); font-style:italic; margin-top:4px }
  .xfer { color:#fbbf24; margin-top:2px }
  .plain { color:#cbd5e1 }
</style>

<header>
  <span class="clock" id="clock">--:--</span>
  <span class="day" id="day"></span>
  <span class="phase" id="phase"></span>
  <button id="play">▶ play</button>
  <select id="speed" title="ms per tick">
    <option value="600">slow</option>
    <option value="250" selected>normal</option>
    <option value="90">fast</option>
    <option value="25">blur</option>
  </select>
  <label class="meta" style="cursor:pointer"><input type="checkbox" id="autopause" checked> pause on dialogue</label>
  <span class="grow"></span>
  <span class="meta" id="title"></span>
  <span class="meta" id="stats"></span>
</header>
<div class="scrubwrap"><input type="range" id="scrub" min="0" value="0"></div>

<main>
  <div id="left">
    <div id="grid"><div id="people"></div></div>
    <table id="agents"></table>
  </div>
  <div id="right">
    <h2>events &amp; dialogue</h2>
    <div class="feed" id="feed"></div>
  </div>
</main>

<script>
const R = ${recordingJson};
const GLYPH = { home:'⌂', bar:'♦', office:'■', shop:'▪', supermarket:'▦',
                clinic:'✚', school:'▲', gym:'●', park:'♣', garage:'✱' };
const COLOUR = { sleep:'#60a5fa', work:'#4ade80', travel:'#fbbf24', scene:'#e879f9',
                 steal:'#f87171', indulge_vice:'#fb923c', socialize:'#a78bfa',
                 eat:'#facc15', relax:'#34d399', idle:'#94a3b8' };

const xs = R.locations.map(l=>l.x), ys = R.locations.map(l=>l.y);
const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
const cols=x1-x0+1, rows=y1-y0+1;

const grid = document.getElementById('grid');
grid.style.gridTemplateColumns = 'repeat('+cols+',1fr)';
const locAt = {};
for (const l of R.locations) locAt[l.x+','+l.y] = l;
for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
  const l = locAt[x+','+y];
  const d = document.createElement('div');
  d.className = 'cell' + (l ? ' venue' : '');
  if (l) d.innerHTML = '<span class="g">'+(GLYPH[l.kind]??'·')+'</span><span class="n">'+l.name+'</span>';
  grid.appendChild(d);
}
const people = document.getElementById('people');
grid.appendChild(people);

const dots = {};
for (const a of R.agents) {
  const d = document.createElement('div');
  d.className='agent'; d.textContent=a.name[0]; d.title=a.name+' — '+a.occupation;
  people.appendChild(d); dots[a.id]=d;
}
const px = v => ((v-x0+0.5)/cols)*100, py = v => ((v-y0+0.5)/rows)*100;

const byId = Object.fromEntries(R.agents.map(a=>[a.id,a]));
const locName = Object.fromEntries(R.locations.map(l=>[l.id,l.name]));
const scrub = document.getElementById('scrub');
scrub.max = R.frames.length-1;
document.getElementById('title').textContent = R.city.name+' · '+R.frames.length+' ticks';
document.getElementById('stats').textContent = R.stats.scenesResolved+' scenes · $'+R.stats.spendUsd.toFixed(3);

const phaseOf = h => h>=23||h<7 ? 'night' : h<9 ? 'morning' : h<18 ? 'working hours' : 'evening';

function evHtml(e, when, now) {
  if (e.dialogue) return '<div class="ev'+(now?' now':'')+'">'+
    '<div class="when">'+when+'</div><div class="head">'+e.text+'</div>'+
    e.dialogue.map(d=>'<div class="line"><b>'+d.speaker+':</b> '+d.line+'</div>').join('')+
    (e.outcome?'<div class="outcome">'+e.outcome+'</div>':'')+
    (e.transfer?'<div class="xfer">'+e.transfer.amount+'c · '+e.transfer.from+' → '+e.transfer.to+'</div>':'')+
    '</div>';
  return '<div class="ev'+(now?' now':'')+'"><div class="when">'+when+'</div>'+
         '<div class="plain">'+e.text+'</div></div>';
}
const stamp = f => 'd'+f.day+' '+String(f.hour).padStart(2,'0')+':'+String(f.minute).padStart(2,'0');

function draw(i) {
  const f = R.frames[i];
  document.getElementById('clock').textContent =
    String(f.hour).padStart(2,'0')+':'+String(f.minute).padStart(2,'0');
  document.getElementById('day').textContent = 'day '+f.day;
  document.getElementById('phase').textContent = phaseOf(f.hour);

  // Fan out everyone sharing a tile: stacked at the cell centre they hide each
  // other, and "who is in the room with whom" is the main thing to read here.
  const groups = {};
  for (const a of f.agents) {
    const key = Math.round(a.x)+','+Math.round(a.y);
    (groups[key] ??= []).push(a);
  }
  const cellW = 100/cols;
  for (const list of Object.values(groups)) {
    list.sort((p,q)=>p.id.localeCompare(q.id));
    list.forEach((a,idx)=>{
      const d = dots[a.id];
      const spread = list.length>1 ? (idx-(list.length-1)/2)*(cellW*0.26) : 0;
      d.style.left = (px(a.x)+spread)+'%';
      d.style.top = py(a.y)+'%';
      d.style.background = COLOUR[a.state] ?? '#94a3b8';
      d.style.zIndex = String(10+idx);
    });
  }
  document.getElementById('agents').innerHTML =
    '<tr><th>who</th><th>doing</th><th>where</th><th style="text-align:right">money</th><th></th></tr>' +
    f.agents.map(a=>{
      const c = COLOUR[a.state] ?? '#94a3b8';
      return '<tr><td><span class="dot" style="background:'+c+'"></span>'+byId[a.id].name+'</td>'+
        '<td style="color:'+c+'">'+a.state+'</td>'+
        '<td class="meta">'+(locName[a.at]??a.at)+'</td>'+
        '<td class="num">'+a.money+'c</td>'+
        '<td class="num neg">'+(a.arrears>0?'-'+a.arrears:'')+'</td></tr>';
    }).join('');

  // Everything up to now, newest first — scrubbing back rewinds the feed too.
  const items = [];
  for (let k=i; k>=0 && items.length<25; k--)
    for (const e of R.frames[k].events) items.push(evHtml(e, stamp(R.frames[k]), k===i));
  document.getElementById('feed').innerHTML =
    items.length ? items.join('') : '<span class="meta">nothing yet</span>';
}
scrub.addEventListener('input', ()=>draw(+scrub.value));

let timer=null;
const playBtn = document.getElementById('play');
const speedSel = document.getElementById('speed');
const autopause = document.getElementById('autopause');

function stop(){ if(timer){clearInterval(timer);timer=null;} playBtn.textContent='▶ play'; }
function start(){
  stop();
  playBtn.textContent='⏸ pause';
  timer = setInterval(()=>{
    const n = +scrub.value+1;
    if (n >= R.frames.length) { stop(); return; }
    scrub.value=n; draw(n);
    // A conversation is the thing you actually want to read, so stop for it
    // rather than letting it scroll past at playback speed.
    if (autopause.checked && R.frames[n].events.some(e=>e.dialogue)) stop();
  }, +speedSel.value);
}
playBtn.addEventListener('click', ()=>{ timer ? stop() : start(); });
speedSel.addEventListener('change', ()=>{ if (timer) start(); });
addEventListener('keydown', e=>{
  if (e.key==='ArrowRight'){ scrub.value=Math.min(+scrub.value+1,R.frames.length-1); draw(+scrub.value); }
  if (e.key==='ArrowLeft'){ scrub.value=Math.max(+scrub.value-1,0); draw(+scrub.value); }
  if (e.key===' '){ e.preventDefault(); playBtn.click(); }
});
draw(0);
</script>`
}
