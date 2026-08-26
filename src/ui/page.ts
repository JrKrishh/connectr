// The whole dashboard is one embedded page: no build step, no CDN, ships inside dist/.
// Rule for this string: no backticks and no "$" + "{" sequences in the client code.
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>connectr</title>
<style>
  /* dark-first: this is a tool that lives next to a terminal */
  :root{
    --bg:#0F1312; --surface:#161B19; --raised:#1C2321; --border:#273230;
    --ink:#E7EDEA; --muted:#8D9C96; --faint:#5E6B66;
    --accent:#45C89A; --accent-ink:#08130F; --accent-dim:#1B3A31;
    --amber:#E0A34E; --amber-dim:#332510; --red:#E0706C;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.22);
    --r:10px; --r-sm:7px;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    --mono:ui-monospace,"Cascadia Code","SF Mono","Consolas","Liberation Mono",monospace;
  }
  @media (prefers-color-scheme: light){
    :root{
      --bg:#F6F8F7; --surface:#FFFFFF; --raised:#EFF3F1; --border:#DCE4E1;
      --ink:#141C19; --muted:#5C6B65; --faint:#8A9993;
      --accent:#06674E; --accent-ink:#FFFFFF; --accent-dim:#DDF0E8;
      --amber:#9A6512; --amber-dim:#F7EBD8; --red:#B4403C;
      --shadow:0 1px 2px rgba(16,32,28,.06), 0 8px 24px rgba(16,32,28,.06);
    }
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.55 var(--sans);
    -webkit-font-smoothing:antialiased;
    overflow:hidden;
  }
  .mono{font-family:var(--mono);font-size:.92em}
  button{font:inherit;cursor:pointer}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
  .scroll{overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
  .scroll::-webkit-scrollbar{width:9px}
  .scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:9px;border:2px solid transparent;background-clip:content-box}
  svg{flex:none}

  .app{display:grid;grid-template-columns:270px 1fr;height:100vh;height:100dvh}

  /* ---------- sidebar ---------- */
  .side{display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--border);min-height:0}
  .brand{display:flex;align-items:center;gap:9px;padding:14px 16px 10px}
  .brand .mark{color:var(--accent)}
  .brand .name{font-weight:650;letter-spacing:-.01em;font-size:15px}
  .brand .name b{color:var(--accent);font-weight:650}
  .proj{padding:0 16px 12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .proj .pname{font-size:12.5px;color:var(--muted);font-family:var(--mono);
    max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;
    padding:2px 7px;border-radius:999px;border:1px solid var(--border);color:var(--faint);white-space:nowrap}
  .tag.auto{color:var(--accent);border-color:var(--accent-dim);background:var(--accent-dim)}
  .tag.yolo{color:var(--amber);border-color:var(--amber-dim);background:var(--amber-dim)}
  .tag.safe{color:var(--muted)}

  .side .body{flex:1;min-height:0;padding:0 8px 14px}
  .grp{margin-top:14px}
  .grp-h{display:flex;align-items:center;gap:6px;padding:0 8px 6px;
    font-family:var(--mono);font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}
  .grp-h .n{margin-left:auto;color:var(--faint)}

  .agent{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--r-sm);font-size:12.5px}
  .agent .id{font-family:var(--mono);font-size:11.5px;color:var(--muted);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .agent.live .id{color:var(--ink)}
  .agent .on{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--accent)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--faint);flex:none}
  .dot.live{background:var(--accent);box-shadow:0 0 0 3px var(--accent-dim);animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

  .task{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;
    background:none;border:1px solid transparent;border-radius:var(--r-sm);
    padding:7px 8px;color:var(--ink);transition:background .14s ease,border-color .14s ease}
  .task:hover{background:var(--raised)}
  .task.sel{background:var(--raised);border-color:var(--border)}
  .task.sel .t-title{color:var(--ink)}
  .task .st{margin-top:3px;color:var(--faint)}
  .task .st.run{color:var(--accent)}
  .task .st.ok{color:var(--accent)}
  .task .col{min-width:0;flex:1}
  .task .t-title{font-size:12.8px;line-height:1.35;color:var(--muted);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .task .t-meta{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:2px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .task.closed .t-title{color:var(--faint)}

  .fact{padding:6px 8px;border-radius:var(--r-sm);font-size:12px;color:var(--muted);line-height:1.45}
  .fact + .fact{border-top:1px solid var(--border)}
  .fact .k{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--faint);margin-right:6px}
  .fact .k.lesson{color:var(--amber)}
  .fact .k.decision{color:var(--accent)}
  .fact .fix{color:var(--ink)}
  .claim{padding:5px 8px;font-family:var(--mono);font-size:11px;color:var(--muted);line-height:1.5;word-break:break-all}
  .claim b{color:var(--accent);font-weight:500}
  .none{padding:4px 8px;font-size:12px;color:var(--faint)}

  /* ---------- main ---------- */
  main{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg)}
  .detail{flex:1;min-height:0;padding:26px 30px 8px}
  .detail-in{max-width:860px;margin:0 auto;animation:rise .18s ease-out}
  @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

  .dh{border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:18px}
  .dh .row{display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap}
  .tid{font-family:var(--mono);font-size:12px;color:var(--accent);
    background:var(--accent-dim);border-radius:5px;padding:2px 7px;font-weight:600}
  .pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:2px 9px;
    border-radius:999px;border:1px solid var(--border);color:var(--muted)}
  .pill.run{color:var(--accent);border-color:var(--accent-dim);background:var(--accent-dim)}
  .pill.ok{color:var(--accent)}
  .dh h1{font-size:20px;line-height:1.3;margin:0;font-weight:600;letter-spacing:-.015em;text-wrap:balance}
  .dh .meta{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:10px;
    font-family:var(--mono);font-size:11.5px;color:var(--muted)}
  .dh .meta b{color:var(--ink);font-weight:500}
  .why{margin-top:10px;padding:8px 11px;border-radius:var(--r-sm);
    background:var(--surface);border:1px solid var(--border);
    font-size:12px;color:var(--muted);display:flex;gap:8px;align-items:flex-start}
  .why .lbl{font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;
    color:var(--accent);flex:none;margin-top:1px}

  .sec-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;
    color:var(--faint);margin:22px 0 10px;display:flex;align-items:center;gap:8px}
  .desc{font-size:13.5px;color:var(--muted);line-height:1.6;white-space:pre-wrap}


  .term{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .term-h{display:flex;align-items:center;gap:8px;padding:7px 11px;border-bottom:1px solid var(--border);
    background:var(--raised)}
  .term-h .f{font-family:var(--mono);font-size:11px;color:var(--muted);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .term-h .live-b{margin-left:auto;display:flex;align-items:center;gap:5px;
    font-family:var(--mono);font-size:10.5px;color:var(--accent)}

  /* the transcript: agents write markdown, so read it as prose, not as a terminal dump */
  .tx{margin:0;padding:16px 18px;max-height:460px;overflow:auto;
    font-size:13.5px;line-height:1.65;color:var(--ink)}
  .tx p{margin:0 0 10px;max-width:68ch;color:var(--muted)}
  .tx p:last-child{margin-bottom:0}
  .tx strong{color:var(--ink);font-weight:600}
  .tx em{color:var(--ink);font-style:italic}
  .tx h3,.tx h4,.tx h5{margin:18px 0 8px;font-size:14px;font-weight:600;color:var(--ink);
    letter-spacing:-.005em}
  .tx h3:first-child,.tx h4:first-child{margin-top:0}
  .tx .li{margin:0 0 6px;padding-left:18px;position:relative;max-width:68ch;color:var(--muted)}
  .tx .li::before{content:"";position:absolute;left:5px;top:9px;width:4px;height:4px;
    border-radius:50%;background:var(--faint)}
  .tx .li.num::before{display:none}
  .tx .li .n{position:absolute;left:0;color:var(--faint);font-family:var(--mono);font-size:11.5px}
  .tx code{font-family:var(--mono);font-size:.86em;background:var(--raised);
    border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--ink);
    white-space:nowrap}
  .tx pre.code{margin:0 0 12px;padding:11px 13px;background:var(--bg);
    border:1px solid var(--border);border-radius:var(--r-sm);overflow-x:auto;
    font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--muted);white-space:pre}
  .tx a{color:var(--accent)}
  .tx .sp{height:6px}
  .tx .banner{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:7px 11px;
    border-radius:var(--r-sm);background:var(--accent-dim);color:var(--accent);
    font-family:var(--mono);font-size:11px;border:1px solid var(--border)}
  .tx .banner + .banner{margin-top:16px}
  /* protocol events from the board, interleaved with what the agent wrote */
  .tx .ev{display:flex;gap:10px;align-items:baseline;margin:0 0 7px;padding:5px 11px;
    background:var(--raised);border-left:2px solid var(--border);
    border-radius:0 var(--r-sm) var(--r-sm) 0;font-size:12.5px}
  .tx .ev-a{font-family:var(--mono);font-size:10.5px;color:var(--accent);flex:none}
  .tx .ev-t{color:var(--muted);flex:1;min-width:0;overflow-wrap:anywhere}
  .tx .ev-w{font-family:var(--mono);font-size:10.5px;color:var(--faint);flex:none}
  .runtabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
  .rt{font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:999px;
    border:1px solid var(--border);background:none;color:var(--muted)}
  .rt.sel{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}

  /* overview */
  .ov-h{font-size:19px;font-weight:600;letter-spacing:-.015em;margin:0 0 4px}
  .ov-sub{color:var(--muted);font-size:13.5px;margin:0 0 22px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
    padding:13px 14px;text-align:left;width:100%;color:var(--ink);
    transition:border-color .14s ease,transform .14s ease}
  .card:hover{border-color:var(--accent);transform:translateY(-1px)}
  .card .c-top{display:flex;align-items:center;gap:8px;margin-bottom:7px}
  .card .c-t{font-size:13px;line-height:1.45;color:var(--ink);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card .c-m{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:7px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .quiet{display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;padding:52px 20px;color:var(--muted)}
  .quiet .ic{color:var(--faint);margin-bottom:14px}
  .quiet h2{font-size:16px;font-weight:600;color:var(--ink);margin:0 0 6px}
  .quiet p{margin:0;font-size:13.5px;max-width:380px;line-height:1.6}
  .kbd{font-family:var(--mono);font-size:11px;background:var(--raised);border:1px solid var(--border);
    border-bottom-width:2px;border-radius:5px;padding:1px 5px;color:var(--muted)}

  /* ---------- composer ---------- */
  .composer{border-top:1px solid var(--border);background:var(--surface);padding:12px 30px 14px}
  .composer-in{max-width:860px;margin:0 auto}
  .confirm{display:none;margin-bottom:10px;border:1px solid var(--amber);border-radius:var(--r);
    background:var(--bg);padding:11px 13px}
  .confirm .ch{display:flex;align-items:center;gap:7px;margin-bottom:8px;
    font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--amber)}
  .confirm .cr{display:flex;gap:9px;align-items:baseline;font-family:var(--mono);font-size:12px;
    color:var(--muted);padding:2px 0}
  .confirm .cr b{color:var(--ink);font-weight:500}
  .confirm .cact{display:flex;gap:8px;margin-top:11px}
  .row{display:flex;gap:9px;align-items:center}
  .field{flex:1;display:flex;align-items:center;gap:9px;background:var(--bg);
    border:1px solid var(--border);border-radius:var(--r);padding:0 12px;
    transition:border-color .14s ease}
  .field:focus-within{border-color:var(--accent)}
  .field .pfx{color:var(--faint)}
  .field input{flex:1;background:none;border:none;outline:none;color:var(--ink);
    font:13.5px/1 var(--sans);padding:12px 0}
  .field input::placeholder{color:var(--faint)}
  .btn{display:inline-flex;align-items:center;gap:7px;border-radius:var(--r);
    border:1px solid var(--border);background:var(--raised);color:var(--ink);
    padding:11px 15px;font-size:13px;font-weight:550;transition:background .14s ease,border-color .14s ease}
  .btn:hover{border-color:var(--accent)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .btn.primary:hover{filter:brightness(1.07)}
  .btn.amber{background:var(--amber);border-color:var(--amber);color:var(--accent-ink)}
  .btn.ghost{background:none}
  .hint{margin-top:8px;font-size:11.5px;color:var(--faint);display:flex;gap:14px;flex-wrap:wrap}
  .hint code{font-family:var(--mono);color:var(--muted)}

  #toast{position:fixed;left:50%;bottom:104px;transform:translateX(-50%) translateY(8px);
    background:var(--raised);border:1px solid var(--border);color:var(--ink);
    padding:9px 15px;border-radius:999px;font-size:12.5px;box-shadow:var(--shadow);
    opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:50;
    max-width:min(760px,90vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
  #toast.err{border-color:var(--red);color:var(--red)}

  @media (max-width:900px){
    body{overflow:auto}
    .app{grid-template-columns:1fr;height:auto}
    .side{border-right:none;border-bottom:1px solid var(--border);max-height:44vh}
    .detail{padding:20px 18px 8px}
    .composer{padding:12px 18px 14px;position:sticky;bottom:0}
  }
  @media (prefers-reduced-motion: reduce){
    *{animation:none !important;transition:none !important}
  }
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <span class="mark" id="mark"></span>
      <span class="name">connect<b>r</b></span>
    </div>
    <div class="proj">
      <span class="pname" id="proj"></span>
      <span class="tag" id="mode"></span>
      <span class="tag" id="plan"></span>
    </div>
    <div class="body scroll">
      <div class="grp" id="agentsGrp">
        <div class="grp-h">Agents <span class="n" id="agentN"></span></div>
        <div id="agents"></div>
      </div>
      <div class="grp" id="runGrp">
        <div class="grp-h">Working now <span class="n" id="runN"></span></div>
        <div id="listRun"></div>
      </div>
      <div class="grp" id="openGrp">
        <div class="grp-h">Queue <span class="n" id="openN"></span></div>
        <div id="listOpen"></div>
      </div>
      <div class="grp" id="doneGrp">
        <div class="grp-h">Finished <span class="n" id="doneN"></span></div>
        <div id="listDone"></div>
      </div>
      <div class="grp" id="claimsGrp">
        <div class="grp-h">File claims</div>
        <div id="claims"></div>
      </div>
      <div class="grp" id="memGrp">
        <div class="grp-h">Shared memory <span class="n" id="memN"></span></div>
        <div id="facts"></div>
      </div>
    </div>
  </aside>

  <main>
    <div class="detail scroll" id="detail"></div>
    <div class="composer">
      <div class="composer-in">
        <div class="confirm" id="confirm">
          <div class="ch" id="confirmH"></div>
          <div id="confirmRows"></div>
          <div class="cact">
            <button class="btn amber" id="confirmGo">Launch agents</button>
            <button class="btn ghost" id="confirmNo">Cancel</button>
          </div>
        </div>
        <div class="row">
          <label class="field">
            <span class="pfx" id="pfx"></span>
            <input id="task" autocomplete="off" spellcheck="false"
              placeholder="Describe what you want built - ConnectR breaks it into tasks">
          </label>
          <button class="btn primary" id="planBtn">Plan it</button>
          <button class="btn" id="addBtn">Add as one task</button>
          <button class="btn" id="dispatchBtn">Dispatch</button>
        </div>
        <div class="hint">
          <span><b>Plan it</b> sends your description to a planner agent that fills the board.
            <b>Add as one task</b> creates exactly what you typed - assign it with <code>@codex</code> or <code>@gemini:gemini-2.5-pro</code>.</span>
          <span><span class="kbd">/</span> focus &middot; <span class="kbd">enter</span> plan &middot; <span class="kbd">d</span> dispatch &middot; <span class="kbd">esc</span> back</span>
        </div>
      </div>
    </div>
  </main>
</div>
<div id="toast"></div>

<script>
"use strict";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
function el(id){return document.getElementById(id);}

var I={
 logo:'<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.4"/><circle cx="18" cy="6.5" r="2.4"/><circle cx="12" cy="17.5" r="2.4"/><path d="M8.4 6.5h7.2M7.3 8.6l3.4 6.8M16.7 8.6l-3.4 6.8"/></svg>',
 circle:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/></svg>',
 run:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></svg>',
 check:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.6 12.2l2.4 2.4 4.4-4.8"/></svg>',
 skip:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.8 12h6.4"/></svg>',
 bot:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8M9 13.5v1.5M15 13.5v1.5"/></svg>',
 term:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l4 4-4 4M12 15h7"/></svg>',
 play:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>',
 plus:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
 chev:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
 warn:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5L21 19H3z"/><path d="M12 10v3.6M12 16.4v.1"/></svg>',
 spark:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
 idle:'<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.4"/><circle cx="18" cy="6.5" r="2.4"/><circle cx="12" cy="17.5" r="2.4"/><path d="M8.4 6.5h7.2M7.3 8.6l3.4 6.8M16.7 8.6l-3.4 6.8"/></svg>'
};

var sel=null, selLog=null, logTimer=null, pending=null, last=null, toastT=null, autoPicked=false;

/* ---------- transcript ----------
   Agents write markdown, so render it instead of dumping it. Everything is escaped
   first and only then given tags, so agent output can never inject markup.
   BT is built from a char code because this whole file is a template literal. */
var BT=String.fromCharCode(96);
var FENCE=BT+BT+BT;

// NOTE: this file is a template literal, so every backslash below is doubled - a single
// one is eaten before the browser ever sees it (\\s would ship as a literal "s").
function mdInline(s){
  s=esc(s);
  // inline code first, so formatting inside it is left alone
  s=s.replace(new RegExp(BT+"([^"+BT+"]+)"+BT,"g"),"<code>$1</code>");
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");
  s=s.replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g,"$1<em>$2</em>");
  s=s.replace(/(https?:\\/\\/[^\\s<)]+)/g,'<a href="$1" target="_blank" rel="noreferrer">$1</a>');
  return s;
}

/* Each dispatch writes a banner carrying tool, mode and an ISO timestamp, so a log can be
   cut into runs with a known start time - which is what lets board notes be dropped into
   the right place between them. */
function splitRuns(text){
  var lines=String(text==null?"":text).split(/\\r?\\n/);
  var segs=[], cur={tool:null,mode:null,ts:null,body:[]};
  for(var i=0;i<lines.length;i++){
    var m=lines[i].match(/^=== connectr dispatch (\\S+?)(?::(\\S+))? mode=(\\S+) @ (\\S+) ===$/);
    if(m){
      if(cur.ts||cur.body.join("").trim())segs.push(cur);
      cur={tool:m[1]+(m[2]?":"+m[2]:""),mode:m[3],ts:m[4],body:[]};
      continue;
    }
    cur.body.push(lines[i]);
  }
  if(cur.ts||cur.body.join("").trim())segs.push(cur);
  return segs;
}

// One chronological stream: dispatched -> claimed -> evidence -> closed -> what it wrote.
// The agent's prose lands after its run's notes because it is written when the run ends.
function mergedTranscript(notes, logText){
  var segs=splitRuns(logText), out=[], used={};
  notes=(notes||[]).slice().sort(function(a,b){return Date.parse(a.ts)-Date.parse(b.ts);});
  function take(from,to){
    var got=[];
    for(var i=0;i<notes.length;i++){
      if(used[i])continue;
      var t=Date.parse(notes[i].ts);
      if(from!==null&&t<from)continue;
      if(to!==null&&t>=to)continue;
      used[i]=true; got.push(notes[i]);
    }
    return got;
  }
  var firstTs=segs.length&&segs[0].ts?Date.parse(segs[0].ts):null;
  if(firstTs!==null)out.push({k:"ev",v:take(null,firstTs)});
  for(var i=0;i<segs.length;i++){
    var s=segs[i];
    if(s.ts)out.push({k:"banner",v:s});
    var next=null;
    for(var j=i+1;j<segs.length;j++){if(segs[j].ts){next=Date.parse(segs[j].ts);break;}}
    out.push({k:"ev",v:take(s.ts?Date.parse(s.ts):null,next)});
    out.push({k:"prose",v:s.body.join("\\n")});
  }
  var rest=[];
  for(var k=0;k<notes.length;k++)if(!used[k])rest.push(notes[k]);
  if(rest.length)out.push({k:"ev",v:rest});
  return out;
}

function renderMerged(notes, logText){
  var blocks=mergedTranscript(notes,logText), html="";
  for(var i=0;i<blocks.length;i++){
    var b=blocks[i];
    if(b.k==="banner"){
      html+='<div class="banner">'+I.play+esc(b.v.tool)+" &middot; mode "+esc(b.v.mode)+
        " &middot; "+esc(rel(b.v.ts))+"</div>";
    }else if(b.k==="ev"){
      for(var j=0;j<b.v.length;j++){
        html+='<div class="ev"><span class="ev-a">'+esc(b.v[j].agent)+'</span>'+
          '<span class="ev-t">'+esc(b.v[j].text)+'</span>'+
          '<span class="ev-w">'+esc(rel(b.v[j].ts))+"</span></div>";
      }
    }else if(b.v&&b.v.trim()){
      html+=renderTranscript(b.v);
    }
  }
  return html||'<p>nothing has happened on this ticket yet</p>';
}

function renderTranscript(text){
  var lines=String(text==null?"":text).split(/\\r?\\n/);
  var out=[], code=[], inCode=false;
  for(var i=0;i<lines.length;i++){
    var L=lines[i];
    if(L.indexOf(FENCE)===0){
      if(inCode){out.push('<pre class="code">'+esc(code.join("\\n"))+"</pre>");code=[];inCode=false;}
      else inCode=true;
      continue;
    }
    if(inCode){code.push(L);continue;}
    var banner=L.match(/^=== connectr dispatch (.+?) ===$/);
    if(banner){out.push('<div class="banner">'+I.play+esc(banner[1])+"</div>");continue;}
    var h=L.match(/^(#{1,6})\\s+(.*)$/);
    if(h){var lvl=Math.min(h[1].length,3)+2;out.push("<h"+lvl+">"+mdInline(h[2])+"</h"+lvl+">");continue;}
    var ul=L.match(/^\\s*[-*+]\\s+(.*)$/);
    if(ul){out.push('<div class="li">'+mdInline(ul[1])+"</div>");continue;}
    var ol=L.match(/^\\s*(\\d+)[.)]\\s+(.*)$/);
    if(ol){out.push('<div class="li num"><span class="n">'+esc(ol[1])+'.</span>'+mdInline(ol[2])+"</div>");continue;}
    if(L.trim()===""){out.push('<div class="sp"></div>');continue;}
    out.push("<p>"+mdInline(L)+"</p>");
  }
  if(code.length)out.push('<pre class="code">'+esc(code.join("\\n"))+"</pre>");
  return out.join("")||'<p>no output yet</p>';
}

function toast(msg,isErr){
  var t=el("toast");
  t.textContent=msg; t.className="on"+(isErr?" err":"");
  clearTimeout(toastT);
  toastT=setTimeout(function(){t.className=isErr?"err":"";},4600);
}
function rel(ts){
  var s=Math.max(0,Math.round((Date.now()-Date.parse(ts))/1000));
  if(s<60)return s+"s ago";
  if(s<3600)return Math.round(s/60)+"m ago";
  if(s<86400)return Math.round(s/3600)+"h ago";
  return Math.round(s/86400)+"d ago";
}
function statusIcon(t){
  if(t.status==="in_progress")return {ic:I.run,cls:"run"};
  if(t.status==="closed")return t.resolution==="completed"?{ic:I.check,cls:"ok"}:{ic:I.skip,cls:""};
  if(t.status==="done")return {ic:I.check,cls:"ok"};
  return {ic:I.circle,cls:""};
}
function routeLabel(t){
  if(!t.routedTo)return "";
  return t.routedTo.tool+(t.routedTo.model?":"+t.routedTo.model:"");
}
function byId(s,id){for(var i=0;i<s.tickets.length;i++)if(s.tickets[i].id===id)return s.tickets[i];return null;}

/* ---------- sidebar ---------- */
function taskRow(t){
  var si=statusIcon(t);
  var meta=[t.id];
  if(t.routedTo)meta.push(routeLabel(t));
  if(t.owner)meta.push("@"+t.owner);
  return '<button class="task'+(t.id===sel?" sel":"")+(t.status==="closed"?" closed":"")+'" data-id="'+esc(t.id)+'">'+
    '<span class="st '+si.cls+'">'+si.ic+'</span>'+
    '<span class="col"><span class="t-title">'+esc(t.title)+'</span>'+
    '<span class="t-meta">'+esc(meta.join("  ·  "))+'</span></span></button>';
}
function renderSide(s){
  el("proj").textContent=s.cwd;
  el("proj").title=s.cwd;
  var m=el("mode"); m.textContent="mode "+s.mode; m.className="tag "+s.mode;
  var p=el("plan"); p.textContent=s.planFile?s.planFile:"no brief"; p.className="tag";

  var live=s.agents.filter(function(a){return a.live;});
  el("agentN").textContent=live.length?live.length+" live":"";
  var owners={};
  s.tickets.forEach(function(t){if(t.status==="in_progress"&&t.owner)owners[t.owner]=t.id;});
  el("agents").innerHTML=s.agents.slice(0,8).map(function(a){
    return '<div class="agent'+(a.live?" live":"")+'"><span class="dot'+(a.live?" live":"")+'"></span>'+
      '<span class="id">'+esc(a.id)+'</span>'+
      (owners[a.id]?'<span class="on">'+esc(owners[a.id])+'</span>':'')+'</div>';
  }).join("")||'<div class="none">none yet</div>';

  var run=s.tickets.filter(function(t){return t.status==="in_progress";});
  var open=s.tickets.filter(function(t){return t.status==="open";});
  var done=s.tickets.filter(function(t){return t.status==="closed"||t.status==="done";}).reverse();
  el("runN").textContent=run.length||"";
  el("openN").textContent=open.length||"";
  el("doneN").textContent=done.length||"";
  el("runGrp").style.display=run.length?"":"none";
  el("listRun").innerHTML=run.map(taskRow).join("");
  el("listOpen").innerHTML=open.map(taskRow).join("")||'<div class="none">nothing queued</div>';
  el("listDone").innerHTML=done.slice(0,14).map(taskRow).join("")||'<div class="none">nothing finished yet</div>';

  el("claimsGrp").style.display=s.claims.length?"":"none";
  el("claims").innerHTML=s.claims.map(function(c){
    return '<div class="claim"><b>'+esc(c.agent)+'</b><br>'+esc(c.paths.join(", "))+'</div>';
  }).join("");

  el("memN").textContent=s.facts.length||"";
  el("facts").innerHTML=s.facts.slice(0,8).map(function(f){
    return '<div class="fact"><span class="k '+esc(f.kind)+'">'+esc(f.kind)+'</span>'+esc(f.text)+
      (f.fix?' <span class="fix">fix: '+esc(f.fix)+'</span>':'')+'</div>';
  }).join("")||'<div class="none">nothing remembered yet</div>';
}

/* ---------- detail ---------- */
function renderDetail(s){
  var box=el("detail");
  var t=sel?byId(s,sel):null;
  if(!t){box.innerHTML=overview(s);return;}
  var si=statusIcon(t);
  var st=t.status==="closed"?(t.resolution||"closed"):t.status.replace("_"," ");
  var h='<div class="detail-in"><div class="dh">'+
    '<div class="row"><span class="tid">'+esc(t.id)+'</span>'+
    '<span class="pill '+si.cls+'">'+si.ic+esc(st)+'</span></div>'+
    '<h1>'+esc(t.title)+'</h1><div class="meta">';
  if(t.routedTo)h+='<span>tool <b>'+esc(routeLabel(t))+'</b>'+(t.routedTo.via?' &middot; '+esc(t.routedTo.via):'')+'</span>';
  if(t.owner)h+='<span>agent <b>'+esc(t.owner)+'</b></span>';
  if(t.updatedAt)h+='<span>updated '+esc(rel(t.updatedAt))+'</span>';
  h+='</div>';
  if(t.routedTo&&t.routedTo.reason)
    h+='<div class="why"><span class="lbl">routing</span><span>'+esc(t.routedTo.reason)+'</span></div>';
  h+='</div>';

  if(t.desc)h+='<div class="sec-h">Brief</div><div class="desc">'+esc(t.desc)+'</div>';

  h+='<div class="sec-h">Transcript'+(t.notes&&t.notes.length?' <span class="n">'+t.notes.length+' events</span>':'')+'</div>';
  if(t.runs&&t.runs.length>1){
    h+='<div class="runtabs">'+t.runs.map(function(r){
      return '<button class="rt'+(r===selLog?" sel":"")+'" data-f="'+esc(r)+'">'+esc(r)+'</button>';
    }).join("")+'</div>';
  }
  h+='<div class="term"><div class="term-h">'+I.term+'<span class="f">'+
    esc(t.runs&&t.runs.length?(selLog||t.runs[0]):"board events only - no agent has run yet")+'</span>'+
    (t.status==="in_progress"?'<span class="live-b"><span class="dot live"></span>live</span>':'')+
    '</div><div class="tx" id="logtail">'+
    (t.runs&&t.runs.length?"loading…":renderMerged(t.notes,""))+'</div></div>';
  h+='</div>';
  box.innerHTML=h;

  if(t.runs&&t.runs.length){
    var want=selLog&&t.runs.indexOf(selLog)>=0?selLog:t.runs[0];
    followLog(want);
  }else{stopLog();}
}

function overview(s){
  var run=s.tickets.filter(function(t){return t.status==="in_progress";});
  var open=s.tickets.filter(function(t){return t.status==="open";});
  var done=s.tickets.filter(function(t){return t.status==="closed";});
  if(!s.tickets.length){
    return '<div class="detail-in"><div class="quiet"><span class="ic">'+I.idle+'</span>'+
      '<h2>No tasks yet</h2><p>Describe what you want built in the box below. ConnectR picks the tool '+
      'that fits the work, or you can assign one with <code>@codex</code>.</p></div></div>';
  }
  var h='<div class="detail-in">';
  if(run.length){
    h+='<h1 class="ov-h">'+run.length+(run.length===1?' agent is working':' agents are working')+'</h1>'+
      '<p class="ov-sub">Click a task to watch its output stream in.</p><div class="cards">'+
      run.map(function(t){
        return '<button class="card" data-id="'+esc(t.id)+'"><div class="c-top"><span class="dot live"></span>'+
          '<span class="tid">'+esc(t.id)+'</span></div><div class="c-t">'+esc(t.title)+'</div>'+
          '<div class="c-m">'+esc(routeLabel(t)+(t.owner?"  ·  "+t.owner:""))+'</div></button>';
      }).join("")+'</div>';
  }else{
    h+='<h1 class="ov-h">'+(open.length?open.length+' task'+(open.length===1?'':'s')+' queued':'Board is clear')+'</h1>'+
      '<p class="ov-sub">'+(open.length?'Press Dispatch to launch agents on them.':
        'Add a task below to get the next one moving.')+'</p>';
    if(open.length){
      h+='<div class="cards">'+open.map(function(t){
        return '<button class="card" data-id="'+esc(t.id)+'"><div class="c-top">'+
          '<span class="tid">'+esc(t.id)+'</span></div><div class="c-t">'+esc(t.title)+'</div>'+
          '<div class="c-m">'+esc(routeLabel(t)||"unrouted")+'</div></button>';
      }).join("")+'</div>';
    }
  }
  if(done.length){
    h+='<div class="sec-h">Recently finished</div><div class="cards">'+
      done.slice(-6).reverse().map(function(t){
        return '<button class="card" data-id="'+esc(t.id)+'"><div class="c-top"><span class="st ok">'+I.check+'</span>'+
          '<span class="tid">'+esc(t.id)+'</span></div><div class="c-t">'+esc(t.title)+'</div>'+
          '<div class="c-m">'+esc((t.resolution||"")+(t.owner?"  ·  "+t.owner:""))+'</div></button>';
      }).join("")+'</div>';
  }
  return h+'</div>';
}

/* ---------- logs ---------- */
function stopLog(){if(logTimer)clearInterval(logTimer);logTimer=null;}
function followLog(file){
  selLog=file;
  stopLog();
  var pull=function(){
    fetch("/api/log?file="+encodeURIComponent(file)).then(function(r){return r.json();}).then(function(d){
      var box=el("logtail"); if(!box)return;
      var stick=box.scrollTop+box.clientHeight>=box.scrollHeight-24;
      var t=last&&sel?byId(last,sel):null;
      var next=renderMerged(t?t.notes:[], d.tail);
      if(box.innerHTML!==next)box.innerHTML=next;
      if(stick)box.scrollTop=box.scrollHeight;
    }).catch(function(){});
  };
  pull();
  logTimer=setInterval(pull,1500);
}

/* ---------- state ---------- */
function render(s){
  last=s;
  if(!autoPicked&&!sel){
    var running=s.tickets.filter(function(t){return t.status==="in_progress";});
    if(running.length){sel=running[0].id;autoPicked=true;}
  }
  if(sel&&!byId(s,sel))sel=null;
  renderSide(s);
  renderDetail(s);
}
function refresh(){fetch("/api/state").then(function(r){return r.json();}).then(render).catch(function(){});}

function select(id){
  if(sel===id)return;
  sel=id; selLog=null; autoPicked=true;
  if(last)render(last);
  el("detail").scrollTop=0;
}

/* ---------- actions ---------- */
function addTask(){
  var input=el("task"), v=input.value.trim();
  if(!v){input.focus();return;}
  fetch("/api/task",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:v})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){toast(d.error,true);return;}
      input.value="";
      var rt=d.ticket.routedTo;
      toast("Created "+d.ticket.id+" - routed to "+rt.tool+(rt.model?":"+rt.model:"")+
        (rt.auto?" ("+(rt.via||"auto")+")":" (manual)"));
      select(d.ticket.id);
      refresh();
    }).catch(function(){toast("could not reach the connectr server",true);});
}
function planIt(){
  var input=el("task"), v=input.value.trim();
  if(!v){input.focus();return;}
  toast("planning \\u2014 an agent is breaking this into tasks\\u2026");
  fetch("/api/plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({intent:v})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){toast(d.error,true);return;}
      if(!d.launch||!d.launch.ok){toast(d.ticket.routedTo.tool+" not found - cannot plan",true);refresh();return;}
      input.value="";
      toast("planning as "+d.ticket.id+" on "+d.ticket.routedTo.tool+" - tickets will appear as it works");
      select(d.ticket.id);
      refresh();
    }).catch(function(){toast("could not reach the connectr server",true);});
}

function armDispatch(){
  fetch("/api/dispatch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dry:true})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.plan||!d.plan.length){toast("no open tickets to dispatch");return;}
      pending=d;
      el("confirmH").innerHTML=I.warn+"about to launch "+d.plan.length+" agent"+(d.plan.length===1?"":"s")+
        " &middot; permission mode "+esc(d.mode);
      el("confirmRows").innerHTML=d.plan.map(function(p){
        return '<div class="cr"><b>'+esc(p.id)+'</b> &rarr; '+esc(p.tool+(p.model?":"+p.model:""))+
          ' <span>'+esc(p.title)+'</span></div>';
      }).join("");
      el("confirm").style.display="block";
      el("confirmGo").focus();
    });
}
function doDispatch(){
  el("confirm").style.display="none";
  var n=pending&&pending.plan?pending.plan.length:0;
  pending=null;
  toast("launching "+n+" agent"+(n===1?"":"s")+"…");
  fetch("/api/dispatch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({})})
    .then(function(r){return r.json();})
    .then(function(d){
      var ok=d.launches.filter(function(l){return l.ok;});
      var bad=d.launches.filter(function(l){return !l.ok;});
      toast(ok.length+" agent"+(ok.length===1?"":"s")+" running"+
        (bad.length?" - "+bad.length+" tool not found":""), bad.length>0);
      if(ok.length){sel=ok[0].id;selLog=null;autoPicked=true;}
      refresh();
    }).catch(function(){toast("dispatch failed",true);});
}

/* ---------- wiring ---------- */
el("mark").innerHTML=I.logo;
el("pfx").innerHTML=I.chev;
el("planBtn").innerHTML=I.spark+"Plan it";
el("addBtn").innerHTML=I.plus+"Add as one task";
el("dispatchBtn").innerHTML=I.play+"Dispatch";
el("planBtn").onclick=planIt;
el("addBtn").onclick=addTask;
el("dispatchBtn").onclick=armDispatch;
el("confirmGo").onclick=doDispatch;
el("confirmNo").onclick=function(){el("confirm").style.display="none";pending=null;toast("dispatch cancelled");};
el("task").addEventListener("keydown",function(e){
  // Enter is the conversational path; shift+enter is the literal one.
  if(e.key==="Enter")e.shiftKey?addTask():planIt();
  if(e.key==="Escape")el("task").blur();
});
document.addEventListener("click",function(e){
  var tg=e.target; if(!tg||!tg.closest)return;
  var rt=tg.closest(".rt");
  if(rt){selLog=rt.getAttribute("data-f");if(last)render(last);return;}
  var node=tg.closest("[data-id]");
  if(node)select(node.getAttribute("data-id"));
});
document.addEventListener("keydown",function(e){
  var typing=document.activeElement&&document.activeElement.tagName==="INPUT";
  if(e.key==="Escape"){
    if(el("confirm").style.display==="block"){el("confirm").style.display="none";pending=null;return;}
    if(!typing&&sel){sel=null;selLog=null;stopLog();if(last)render(last);}
    return;
  }
  if(typing)return;
  if(e.key==="/"){e.preventDefault();el("task").focus();}
  else if(e.key==="d")armDispatch();
  else if(e.key==="n"){e.preventDefault();el("task").focus();}
});

try{
  var es=new EventSource("/api/events");
  es.onmessage=function(ev){render(JSON.parse(ev.data));};
  es.onerror=function(){setTimeout(refresh,2500);};
}catch(e){setInterval(refresh,2500);}
refresh();
</script>
</body>
</html>
`;
