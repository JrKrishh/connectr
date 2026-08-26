// The whole dashboard is one embedded page: no build step, no CDN, ships inside dist/.
// Rule for this string: no backticks and no "$" + "{" sequences in the client code.
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>connectr</title>
<style>
  :root{
    --bg:#121816; --panel:#1A211E; --panel2:#161D1A; --ink:#E4EAE6; --muted:#8A968F;
    --line:#26302B; --accent:#3FBF9F; --amber:#D98E2B; --red:#D96A6A;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.5 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
  .mono{font-family:"IBM Plex Mono",Consolas,ui-monospace,monospace}
  header{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  header .logo{font-weight:700;font-size:17px;letter-spacing:.02em}
  header .logo b{color:var(--accent)}
  .chip{font-family:Consolas,ui-monospace,monospace;font-size:12px;padding:2px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
  .chip.mode-auto{border-color:var(--accent);color:var(--accent)}
  .chip.mode-safe{border-color:var(--muted)}
  .chip.mode-yolo{border-color:var(--amber);color:var(--amber)}
  .grow{flex:1}
  .composer{display:flex;gap:8px;padding:12px 18px;border-bottom:1px solid var(--line)}
  .composer input{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:6px;
    color:var(--ink);padding:9px 12px;font:13px Consolas,ui-monospace,monospace;outline:none}
  .composer input:focus{border-color:var(--accent)}
  button{background:var(--panel);border:1px solid var(--line);border-radius:6px;color:var(--ink);
    padding:9px 16px;font:600 13px "IBM Plex Sans","Segoe UI",sans-serif;cursor:pointer}
  button:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#0B1512}
  button.warn{background:var(--amber);border-color:var(--amber);color:#1B1206}
  #msg{padding:6px 18px;font-family:Consolas,ui-monospace,monospace;font-size:12.5px;color:var(--accent);min-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #msg.err{color:var(--red)}
  #confirm{display:none;margin:0 18px 10px;padding:12px 14px;background:var(--panel);border:1px solid var(--amber);border-radius:8px}
  #confirm .title{color:var(--amber);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
  #confirm .row{font-family:Consolas,ui-monospace,monospace;font-size:13px;padding:2px 0}
  #confirm .actions{margin-top:10px;display:flex;gap:8px}
  main{display:grid;grid-template-columns:1fr 340px;gap:14px;padding:0 18px 18px}
  @media(max-width:900px){main{grid-template-columns:1fr}}
  h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:14px 0 8px;font-family:Consolas,ui-monospace,monospace}
  .board{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  @media(max-width:1200px){.board{grid-template-columns:1fr}}
  .col{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px;min-height:80px}
  .col h3{margin:0 0 8px;font-size:12px;color:var(--muted);font-weight:600;font-family:Consolas,ui-monospace,monospace}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-bottom:8px}
  .card .tid{color:var(--accent);font-family:Consolas,ui-monospace,monospace;font-size:12px;font-weight:600}
  .card .route{color:var(--muted);font-family:Consolas,ui-monospace,monospace;font-size:11.5px}
  .card .t{margin:3px 0 2px;font-size:13.5px}
  .card .note{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .card.closed{opacity:.55}
  .side .panel{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:14px}
  .agent{display:flex;gap:8px;align-items:baseline;font-family:Consolas,ui-monospace,monospace;font-size:12.5px;padding:2px 0}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none;position:relative;top:0}
  .dot.live{background:var(--accent)}
  .fact{border-top:1px solid var(--line);padding:6px 0;font-size:12.5px;color:var(--muted)}
  .fact:first-child{border-top:none}
  .fact .k{font-family:Consolas,ui-monospace,monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;margin-right:6px}
  .fact .k.lesson{color:var(--amber)}
  .fact .k.decision{color:var(--accent)}
  .fact .fix{color:var(--ink)}
  .runs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
  .runpill{font-family:Consolas,ui-monospace,monospace;font-size:11.5px;padding:3px 9px;border:1px solid var(--line);border-radius:999px;cursor:pointer;color:var(--muted)}
  .runpill.sel{border-color:var(--accent);color:var(--accent)}
  #logtail{background:#0D1210;border:1px solid var(--line);border-radius:8px;padding:10px;font-family:Consolas,ui-monospace,monospace;
    font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;color:var(--muted);display:none}
  .empty{color:var(--muted);font-size:12.5px}
  .card{cursor:pointer}
  .card.sel{border-color:var(--accent)}
  #thread{display:none;background:var(--panel2);border:1px solid var(--accent);border-radius:8px;padding:12px;margin:12px 0 0}
  .th-head{font-size:14px}
  .th-head .route{color:var(--muted);font-family:Consolas,ui-monospace,monospace;font-size:12px}
  .th-desc{color:var(--muted);font-size:12.5px;margin:6px 0}
  .th-notes{margin-top:6px}
  .th-note{border-top:1px solid var(--line);padding:4px 0;font-family:Consolas,ui-monospace,monospace;font-size:12px;color:var(--muted)}
  .th-note .who{color:var(--accent)}
</style>
</head>
<body>
<header>
  <span class="logo">connect<b>r</b></span>
  <span class="chip mono" id="proj"></span>
  <span class="chip" id="mode"></span>
  <span class="chip mono" id="plan"></span>
  <span class="grow"></span>
  <span class="chip mono" id="livecount"></span>
</header>
<div class="composer">
  <input id="task" placeholder='new task - plain title auto-routes, or "title @codex:gpt-5-codex" to assign' >
  <button class="primary" id="addBtn">Add task</button>
  <button class="warn" id="dispatchBtn">Dispatch open</button>
</div>
<div id="msg"></div>
<div id="confirm">
  <div class="title">Dispatch plan - confirm</div>
  <div id="confirmRows"></div>
  <div class="actions">
    <button class="warn" id="confirmGo">Launch agents</button>
    <button id="confirmNo">Cancel</button>
  </div>
</div>
<main>
  <section>
    <h2>Ticket board</h2>
    <div class="board">
      <div class="col"><h3 id="h-open"></h3><div id="c-open"></div></div>
      <div class="col"><h3 id="h-prog"></h3><div id="c-prog"></div></div>
      <div class="col"><h3 id="h-done"></h3><div id="c-done"></div></div>
    </div>
    <div id="thread"></div>
    <h2>Run logs</h2>
    <div class="runs" id="runs"></div>
    <div id="logtail"></div>
  </section>
  <section class="side">
    <h2>Agents</h2>
    <div class="panel" id="agents"></div>
    <h2>File claims</h2>
    <div class="panel" id="claims"></div>
    <h2>Shared memory</h2>
    <div class="panel" id="facts"></div>
  </section>
</main>
<script>
"use strict";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
function el(id){return document.getElementById(id);}
var selectedLog=null, logTimer=null, selectedTicket=null, lastState=null;

function setMsg(text, isErr){var m=el("msg");m.textContent=text||"";m.className=isErr?"err":"";}

function card(t){
  var route=t.routedTo?esc(t.routedTo.tool)+(t.routedTo.model?":"+esc(t.routedTo.model):""):"";
  var html='<div class="card'+(t.status==="closed"?" closed":"")+(t.id===selectedTicket?" sel":"")+'" data-id="'+esc(t.id)+'">';
  html+='<span class="tid">'+esc(t.id)+'</span> ';
  if(route)html+='<span class="route">&rarr; '+route+'</span>';
  if(t.resolution)html+='<span class="route"> ('+esc(t.resolution)+')</span>';
  html+='<div class="t">'+esc(t.title)+'</div>';
  if(t.owner)html+='<div class="note">@'+esc(t.owner)+'</div>';
  if(t.lastNote)html+='<div class="note" title="'+esc(t.lastNote)+'">'+esc(t.lastNote)+'</div>';
  html+='</div>';
  return html;
}

function renderThread(s){
  var box=el("thread");
  var t=null;
  for(var i=0;i<s.tickets.length;i++)if(s.tickets[i].id===selectedTicket)t=s.tickets[i];
  if(!t){box.style.display="none";return;}
  box.style.display="block";
  var route=t.routedTo?esc(t.routedTo.tool)+(t.routedTo.model?":"+esc(t.routedTo.model):""):"unrouted";
  var html='<div class="th-head"><span class="tid">'+esc(t.id)+'</span> <b>'+esc(t.title)+'</b>  <span class="route">['+esc(t.status)+(t.resolution?" &middot; "+esc(t.resolution):"")+'] &rarr; '+route+(t.owner?" &middot; @"+esc(t.owner):"")+'</span></div>';
  if(t.desc)html+='<div class="th-desc">'+esc(t.desc)+"</div>";
  if(t.notes&&t.notes.length){
    html+='<div class="th-notes">'+t.notes.map(function(n){
      return '<div class="th-note"><span class="who">'+esc(n.agent)+"</span> "+esc(n.text)+"</div>";
    }).join("")+"</div>";
  }
  if(t.runs&&t.runs.length){
    html+='<div class="runs" style="margin-top:8px">'+t.runs.map(function(r){
      return '<span class="runpill'+(r===selectedLog?" sel":"")+'" data-f="'+esc(r)+'">'+esc(r)+"</span>";
    }).join("")+"</div>";
  }else{
    html+='<div class="empty" style="margin-top:6px">no runs for this ticket yet</div>';
  }
  box.innerHTML=html;
}

function selectTicket(id){
  selectedTicket=(selectedTicket===id)?null:id;
  if(selectedTicket&&lastState){
    var t=null;
    for(var i=0;i<lastState.tickets.length;i++)if(lastState.tickets[i].id===selectedTicket)t=lastState.tickets[i];
    if(t&&t.runs&&t.runs.length&&selectedLog!==t.runs[0])toggleLog(t.runs[0]);
  }
  if(lastState)render(lastState);
}

function render(s){
  lastState=s;
  el("proj").textContent=s.project;
  el("mode").textContent="mode "+s.mode;
  el("mode").className="chip mode-"+s.mode;
  el("plan").textContent=s.planFile?("brief "+s.planFile):"no brief";
  var liveN=s.agents.filter(function(a){return a.live;}).length;
  el("livecount").textContent=liveN+" live";

  var open=s.tickets.filter(function(t){return t.status==="open";});
  var prog=s.tickets.filter(function(t){return t.status==="in_progress";});
  var done=s.tickets.filter(function(t){return t.status==="done"||t.status==="closed";}).reverse();
  el("h-open").textContent="OPEN ("+open.length+")";
  el("h-prog").textContent="IN PROGRESS ("+prog.length+")";
  el("h-done").textContent="DONE / CLOSED ("+done.length+")";
  el("c-open").innerHTML=open.map(card).join("")||'<div class="empty">nothing queued - add a task above</div>';
  el("c-prog").innerHTML=prog.map(card).join("")||'<div class="empty">no agent working right now</div>';
  el("c-done").innerHTML=done.slice(0,12).map(card).join("")||'<div class="empty">nothing finished yet</div>';

  el("agents").innerHTML=s.agents.slice(0,10).map(function(a){
    return '<div class="agent"><span class="dot'+(a.live?" live":"")+'"></span><span>'+esc(a.id)+'</span>'+(a.model?'<span style="color:var(--muted)">'+esc(a.model)+"</span>":"")+"</div>";
  }).join("")||'<div class="empty">agents appear when they call whoami</div>';

  el("claims").innerHTML=s.claims.map(function(c){
    return '<div class="agent">@'+esc(c.agent)+": "+esc(c.paths.join(", "))+"</div>";
  }).join("")||'<div class="empty">none</div>';

  el("facts").innerHTML=s.facts.slice(0,12).map(function(f){
    var fix=f.fix?' <span class="fix">&rarr; fix: '+esc(f.fix)+"</span>":"";
    return '<div class="fact"><span class="k '+esc(f.kind)+'">'+esc(f.kind)+"</span>"+esc(f.text)+fix+"</div>";
  }).join("")||'<div class="empty">nothing remembered yet</div>';

  el("runs").innerHTML=s.runs.map(function(r){
    return '<span class="runpill'+(r===selectedLog?" sel":"")+'" data-f="'+esc(r)+'">'+esc(r)+"</span>";
  }).join("")||'<div class="empty">no run logs yet</div>';
  renderThread(s);
}

document.addEventListener("click",function(e){
  var target=e.target;
  if(!target||!target.closest)return;
  var pill=target.closest(".runpill");
  if(pill){toggleLog(pill.getAttribute("data-f"));return;}
  var c=target.closest(".card");
  if(c&&c.getAttribute("data-id"))selectTicket(c.getAttribute("data-id"));
});

function toggleLog(file){
  if(selectedLog===file){selectedLog=null;el("logtail").style.display="none";if(logTimer)clearInterval(logTimer);logTimer=null;refresh();return;}
  selectedLog=file;el("logtail").style.display="block";
  var pull=function(){
    fetch("/api/log?file="+encodeURIComponent(file)).then(function(r){return r.json();}).then(function(d){
      var box=el("logtail");var stick=box.scrollTop+box.clientHeight>=box.scrollHeight-8;
      box.textContent=d.tail||"(empty)";
      if(stick)box.scrollTop=box.scrollHeight;
    });
  };
  pull();
  if(logTimer)clearInterval(logTimer);
  logTimer=setInterval(pull,1500);
  refresh();
}

function refresh(){fetch("/api/state").then(function(r){return r.json();}).then(render);}

el("addBtn").onclick=function(){
  var input=el("task");var v=input.value.trim();if(!v)return;
  fetch("/api/task",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:v})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){setMsg(d.error,true);return;}
      input.value="";
      var rt=d.ticket.routedTo;
      setMsg("created "+d.ticket.id+" -> "+rt.tool+(rt.model?":"+rt.model:"")+(rt.auto?" [auto-routed]":" [manual]"));
    });
};
el("task").addEventListener("keydown",function(e){if(e.key==="Enter")el("addBtn").click();});

el("dispatchBtn").onclick=function(){
  fetch("/api/dispatch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dry:true})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.plan||d.plan.length===0){setMsg("no open tickets to dispatch");return;}
      el("confirmRows").innerHTML=d.plan.map(function(p){
        return '<div class="row">'+esc(p.id)+" &rarr; "+esc(p.tool)+(p.model?":"+esc(p.model):"")+"  &middot;  "+esc(p.title)+"</div>";
      }).join("")+'<div class="row" style="color:var(--amber)">permission mode: '+esc(d.mode)+"</div>";
      el("confirm").style.display="block";
    });
};
el("confirmNo").onclick=function(){el("confirm").style.display="none";setMsg("dispatch cancelled");};
el("confirmGo").onclick=function(){
  el("confirm").style.display="none";
  fetch("/api/dispatch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({})})
    .then(function(r){return r.json();})
    .then(function(d){
      var parts=d.launches.map(function(l){return l.id+"->"+l.tool+(l.ok?" pid "+l.pid:" NOT FOUND");});
      setMsg("dispatched "+parts.join(" | "));
      refresh();
    });
};

try{
  var es=new EventSource("/api/events");
  es.onmessage=function(ev){render(JSON.parse(ev.data));};
  es.onerror=function(){setTimeout(refresh,2000);};
}catch(e){setInterval(refresh,2000);}
refresh();
</script>
</body>
</html>
`;
