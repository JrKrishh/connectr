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
  .tag.auto{color:var(--accent);border-color:var(--accent-dim);background:var(--accent-dim)}
  .set-auto{display:flex;align-items:center;gap:12px;justify-content:space-between;
    padding:12px 18px;border-top:1px solid var(--border);font-size:13px}
  .set-auto .m-b{max-width:420px}
  .switch{position:relative;flex:none;width:38px;height:21px;border-radius:999px;cursor:pointer;
    border:1px solid var(--border);background:var(--raised);transition:background .15s ease}
  .switch::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;
    border-radius:50%;background:var(--faint);transition:transform .15s ease,background .15s ease}
  .switch.on{background:var(--accent);border-color:var(--accent)}
  .switch.on::after{transform:translateX(17px);background:var(--accent-ink)}

  .bell{margin-left:auto;display:inline-flex;align-items:center;background:none;border:none;
    padding:3px;cursor:pointer;color:var(--faint);border-radius:6px}
  .bell:hover{color:var(--muted)}
  .bell.on{color:var(--accent)}
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

  /* review & merge: the work agents did, waiting to come back */
  .review{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 0;
    padding:10px 13px;border:1px solid var(--accent);border-radius:var(--r);
    background:var(--accent-dim)}
  .review .rv-t{font-size:13px;color:var(--ink);flex:1;min-width:180px}
  .review .rv-t b{color:var(--accent)}
  .review button{font:550 12.5px var(--sans);padding:7px 13px;border-radius:999px;cursor:pointer;
    border:1px solid var(--border);background:var(--surface);color:var(--ink)}
  .review button:hover{border-color:var(--accent)}
  .review button.go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .review.warn{border-color:var(--amber);background:var(--amber-dim)}
  .review.warn .rv-t b{color:var(--amber)}

  .diff{font-family:var(--mono);font-size:11.5px;line-height:1.5}
  .diff div{white-space:pre-wrap;word-break:break-word}
  .diff .df{color:var(--ink);font-weight:600;margin-top:10px}
  .diff .dh{color:var(--accent)}
  .diff .da{color:#4CC38A}
  .diff .dd{color:var(--red)}
  .diff .dm{color:var(--faint)}
  .diff .dstat{color:var(--muted);border-bottom:1px solid var(--border);
    padding-bottom:8px;margin-bottom:8px}

  .samples{display:flex;flex-direction:column;gap:8px;margin-top:16px;max-width:440px}
  .sample{text-align:left;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;
    background:var(--surface);border:1px dashed var(--border);border-radius:var(--r);
    padding:10px 13px;transition:border-color .14s ease,color .14s ease}
  .sample:hover{border-color:var(--accent);color:var(--ink)}
  .sample b{color:var(--accent);font-weight:600}
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

  /* shown only when the page is running inside the desktop shell */
  .shellbtn{display:none;align-items:center;gap:5px;margin-left:auto;background:none;
    border:1px solid var(--border);border-radius:999px;color:var(--muted);
    padding:3px 10px;font-size:11.5px;transition:border-color .14s ease,color .14s ease}
  .shellbtn:hover{border-color:var(--accent);color:var(--accent)}
  body.shell .shellbtn{display:inline-flex}

  .pal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;
    display:flex;align-items:flex-start;justify-content:center;padding-top:14vh}
  .pal-box{width:min(560px,92vw);background:var(--surface);border:1px solid var(--border);
    border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}
  .pal-box input{width:100%;background:none;border:none;outline:none;color:var(--ink);
    font:14.5px var(--sans);padding:15px 17px;border-bottom:1px solid var(--border)}
  .pal-box input::placeholder{color:var(--faint)}
  .pal-list{max-height:46vh;overflow:auto;padding:6px}
  .pal-i{display:flex;flex-direction:column;gap:1px;padding:9px 11px;border-radius:var(--r-sm);cursor:pointer}
  .pal-i.on{background:var(--raised)}
  .pal-i .pal-n{font-size:13.5px;color:var(--ink)}
  .pal-i .pal-p{font-family:var(--mono);font-size:11px;color:var(--faint);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pal-none{padding:16px;text-align:center;color:var(--faint);font-size:13px}
  .pal-foot{border-top:1px solid var(--border);padding:8px 14px;
    font-family:var(--mono);font-size:10.5px;color:var(--faint)}

  /* settings */
  .tag.mode-auto,.tag.mode-safe,.tag.mode-yolo{cursor:pointer}
  .tag.clickable:hover{border-color:var(--accent);color:var(--accent)}
  .set-h{padding:16px 18px 12px;border-bottom:1px solid var(--border)}
  .set-h h2{margin:0 0 3px;font-size:16px;font-weight:600;letter-spacing:-.01em}
  .set-h p{margin:0;font-size:12.5px;color:var(--muted)}
  .set-body{padding:12px;max-height:56vh;overflow:auto}
  .mode{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border-radius:var(--r-sm);
    border:1px solid var(--border);margin-bottom:8px;cursor:pointer;background:var(--bg)}
  .mode.on{border-color:var(--accent);background:var(--accent-dim)}
  .mode .dotr{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--faint);flex:none;margin-top:2px}
  .mode.on .dotr{border-color:var(--accent);box-shadow:inset 0 0 0 3px var(--accent)}
  .mode .m-t{font-size:13.5px;font-weight:600}
  .mode .m-b{font-size:12.5px;color:var(--muted);line-height:1.5}
  .mode.on .m-b{color:var(--ink)}
  .set-flags{margin-top:12px;border-top:1px solid var(--border);padding-top:12px}
  .set-flags .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--faint);margin-bottom:8px}
  .flagrow{display:flex;gap:10px;align-items:baseline;padding:4px 0;font-size:12.5px}
  .flagrow .ft{font-family:var(--mono);font-size:11.5px;color:var(--accent);flex:none;min-width:88px}
  .flagrow .ff{font-family:var(--mono);font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}

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
      <button class="shellbtn" id="homeBtn" title="Back to projects (Ctrl+O)">Projects</button>
    </div>
    <div class="proj">
      <span class="pname" id="proj"></span>
      <span class="tag" id="mode"></span>
      <span class="tag" id="plan"></span>
      <span class="tag auto clickable" id="autoTag" hidden title="Auto-continue is on - queued tasks launch on their own"></span>
      <button class="bell" id="bell" title="Notify me when agents finish or need review"></button>
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
          <button class="btn" id="dispatchBtn">Launch</button>
        </div>
        <div class="hint">
          <span><b>Plan it</b> sends your description to a planner agent that fills the board.
            <b>Add as one task</b> creates exactly what you typed - assign it with <code>@codex</code> or <code>@gemini:gemini-2.5-pro</code>.</span>
          <span><span class="kbd">/</span> focus &middot; <span class="kbd">enter</span> plan &middot; <span class="kbd">d</span> launch &middot; <span class="kbd">esc</span> back</span>
        </div>
      </div>
    </div>
  </main>
</div>
<div class="pal" id="settings" hidden>
  <div class="pal-box">
    <div class="set-h">
      <h2>Permission mode</h2>
      <p>Set it once here. Every tool ConnectR launches gets its own equivalent of it.</p>
    </div>
    <div class="set-body">
      <div id="modeList"></div>
      <div class="set-flags">
        <div class="lbl">What each tool gets in this mode</div>
        <div id="modeFlags"></div>
      </div>
    </div>
    <div class="set-auto">
      <span><span class="m-t">Auto-continue</span>
        <div class="m-b">Keep launching queued tasks until the board is clear. A task that fails twice is left for you.</div></span>
      <button class="switch" id="autoBtn"></button>
    </div>
    <div class="pal-foot">click a mode to apply it &middot; esc close</div>
  </div>
</div>
<div class="pal" id="palette" hidden>
  <div class="pal-box">
    <input id="palInput" autocomplete="off" spellcheck="false" placeholder="Switch project…">
    <div class="pal-list" id="palList"></div>
    <div class="pal-foot">&uarr;&darr; move &middot; enter open &middot; esc close</div>
  </div>
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
 idle:'<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.4"/><circle cx="18" cy="6.5" r="2.4"/><circle cx="12" cy="17.5" r="2.4"/><path d="M8.4 6.5h7.2M7.3 8.6l3.4 6.8M16.7 8.6l-3.4 6.8"/></svg>',
 bell:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.5v-6a6 6 0 0 1 12 0v6l1.5 2.5H4.5z"/><path d="M10.2 21a2 2 0 0 0 3.6 0"/></svg>'
};

var sel=null, selLog=null, logTimer=null, logES=null, logBuf="", pending=null, last=null,
    toastT=null, autoPicked=false, diffMode=false, diffCache=null;

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

/* A unified diff, colored line by line. Everything is escaped before it gets a class. */
function renderDiff(d){
  var out=[];
  if(d.stat)out.push('<div class="dstat">'+esc(d.stat)+"</div>");
  var lines=String(d.patch||"").split("\\n");
  for(var i=0;i<lines.length;i++){
    var L=lines[i], cls="dm";
    if(L.indexOf("diff --git")===0)cls="df";
    else if(L.indexOf("@@")===0)cls="dh";
    else if(L.indexOf("+++")===0||L.indexOf("---")===0)cls="dm";
    else if(L.charAt(0)==="+")cls="da";
    else if(L.charAt(0)==="-")cls="dd";
    out.push('<div class="'+cls+'">'+(esc(L)||"&nbsp;")+"</div>");
  }
  if(d.truncated)out.push('<div class="dm">&hellip; diff truncated - the merge still brings everything</div>');
  return '<div class="diff">'+out.join("")+"</div>";
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

/* ---------- notifications ----------
   The dashboard already knows the moment an agent finishes, leaves commits to review,
   or dies - all client-side, by comparing one SSE state push with the previous one.
   Nothing fires while you are looking at the page; the title badge needs no permission,
   native notifications are an opt-in bell. */
var prevSnap=null, unseen=0;

function notifySupported(){return typeof Notification!=="undefined";}
function notifyOn(){
  try{return localStorage.getItem("connectr-notify")==="1"&&notifySupported()&&Notification.permission==="granted";}
  catch(e){return false;}
}
function paintBell(){
  var b=el("bell"); if(!b)return;
  b.innerHTML=I.bell;
  b.className="bell"+(notifyOn()?" on":"");
  b.title=notifyOn()?"Notifications on - click to turn off":"Notify me when agents finish or need review";
}
function bellClick(){
  if(!notifySupported()){toast("notifications are not supported here",true);return;}
  if(notifyOn()){
    try{localStorage.setItem("connectr-notify","0");}catch(e){}
    paintBell();toast("notifications off");return;
  }
  Notification.requestPermission().then(function(p){
    if(p==="granted"){
      try{localStorage.setItem("connectr-notify","1");}catch(e){}
      toast("on - you will be tapped when agents finish or need review");
    }else{toast("the browser blocked notifications",true);}
    paintBell();
  });
}

function noticeChanges(s){
  var snap={},i,t;
  for(i=0;i<s.tickets.length;i++){
    t=s.tickets[i];
    snap[t.id]={status:t.status,commits:t.tree?t.tree.commits:0,title:t.title,resolution:t.resolution};
  }
  if(prevSnap){
    var evs=[];
    for(var id in snap){
      var now=snap[id],was=prevSnap[id];
      if(!was)continue; // new tickets are the user's own doing
      if(was.status!=="closed"&&now.status==="closed")
        evs.push({id:id,title:id+" finished"+(now.resolution&&now.resolution!=="completed"?" ("+now.resolution+")":""),body:now.title});
      else if(was.status==="in_progress"&&now.status==="open")
        evs.push({id:id,title:id+" stopped - its agent is gone",body:now.title});
      if(now.commits>0&&was.commits===0)
        evs.push({id:id,title:id+" has "+now.commits+" commit"+(now.commits===1?"":"s")+" to review",body:now.title});
    }
    if(evs.length)deliver(evs);
  }
  prevSnap=snap;
}

function deliver(evs){
  if(document.hasFocus())return; // you are already watching
  unseen+=evs.length;
  document.title="("+unseen+") connectr";
  if(!notifyOn())return;
  var show=evs.length>3
    ?[{id:null,title:evs.length+" updates on the board",body:"agents finished or need review"}]
    :evs;
  for(var i=0;i<show.length;i++){
    (function(ev){
      try{
        var n=new Notification(ev.title,{body:ev.body,tag:"connectr-"+(ev.id||"board")});
        n.onclick=function(){window.focus();if(ev.id)select(ev.id);n.close();};
      }catch(e){/* notification construction can throw on some platforms */}
    })(show[i]);
  }
}
window.addEventListener("focus",function(){unseen=0;document.title="connectr";});
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
  var ac=el("autoTag"); ac.hidden=!s.autoContinue; ac.textContent="auto-continue";

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
    h+='<div class="why"><span class="lbl">why this tool</span><span>'+esc(t.routedTo.reason)+'</span></div>';

  // The closing move: work waiting in this ticket's worktree, reviewable and mergeable
  // right here instead of via the CLI.
  if(t.tree&&t.tree.commits>0){
    h+='<div class="review"><span class="rv-t"><b>'+t.tree.commits+' commit'+(t.tree.commits===1?"":"s")+
      '</b> from this ticket waiting to merge'+(t.tree.dirty?' &middot; plus unsaved edits left behind':'')+
      '</span><button id="diffBtn">'+(diffMode?"View transcript":"View changes")+'</button>'+
      '<button class="go" id="mergeBtn">Merge</button></div>';
  }else if(t.tree&&t.tree.dirty){
    h+='<div class="review warn"><span class="rv-t"><b>unsaved edits</b> sit in this ticket&#39;s workspace - nothing to merge yet</span></div>';
  }
  if(t.status==="in_progress"&&t.owner&&!s.agents.some(function(a){return a.id===t.owner&&a.live;})){
    h+='<div class="review warn"><span class="rv-t">The agent on this ticket looks <b>gone</b> - reopen it and launch again</span>'+
      '<button class="go" id="reopenBtn">Reopen</button></div>';
  }
  h+='</div>';

  if(t.desc)h+='<div class="sec-h">Brief</div><div class="desc">'+esc(t.desc)+'</div>';

  h+='<div class="sec-h">Transcript'+(t.notes&&t.notes.length?' <span class="n">'+t.notes.length+' events</span>':'')+'</div>';
  if(t.runs&&t.runs.length>1){
    h+='<div class="runtabs">'+t.runs.map(function(r){
      return '<button class="rt'+(r===selLog?" sel":"")+'" data-f="'+esc(r)+'">'+esc(r)+'</button>';
    }).join("")+'</div>';
  }
  h+='<div class="term"><div class="term-h">'+I.term+'<span class="f">'+
    esc(diffMode?("changes on connectr/"+t.id):(t.runs&&t.runs.length?(selLog||t.runs[0]):"activity so far - no agent has run yet"))+'</span>'+
    (t.status==="in_progress"&&!diffMode?'<span class="live-b"><span class="dot live"></span>live</span>':'')+
    '</div><div class="tx" id="logtail">'+
    (diffMode
      ?(diffCache&&diffCache.ticket===t.id?renderDiff(diffCache):"reading the changes...")
      :(t.runs&&t.runs.length?"loading…":renderMerged(t.notes,"")))+'</div></div>';
  h+='</div>';
  box.innerHTML=h;

  var db=el("diffBtn");if(db)db.onclick=function(){diffMode=!diffMode;if(last)render(last);};
  var mb=el("mergeBtn");if(mb)mb.onclick=function(){doMerge(t.id);};
  var rb=el("reopenBtn");if(rb)rb.onclick=function(){doReopen();};

  if(diffMode){
    stopLog();
    if(!diffCache||diffCache.ticket!==t.id)loadDiff(t.id);
  }else if(t.runs&&t.runs.length){
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
      'that fits the work, or you can assign one with <code>@codex</code>.</p>'+
      '<div class="samples">'+
      '<button class="sample" data-intent="Build a URL shortener: a REST API backed by sqlite, a small CLI to add and list links, and a README with usage examples"><b>Try:</b> a URL shortener - API, CLI and docs</button>'+
      '<button class="sample" data-intent="Build a personal notes REST API with tagging, full-text search and unit tests for every endpoint"><b>Try:</b> a notes API with search and tests</button>'+
      '<button class="sample" data-intent="Build a single-page landing site for this project: hero section, feature grid, dark mode toggle"><b>Try:</b> a landing page with dark mode</button>'+
      '</div></div></div>';
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
      '<p class="ov-sub">'+(open.length?'Press Launch to start agents on them.':
        'Add a task below to get the next one moving.')+'</p>';
    if(open.length){
      h+='<div class="cards">'+open.map(function(t){
        return '<button class="card" data-id="'+esc(t.id)+'"><div class="c-top">'+
          '<span class="tid">'+esc(t.id)+'</span></div><div class="c-t">'+esc(t.title)+'</div>'+
          '<div class="c-m">'+esc(routeLabel(t)||"not assigned yet")+'</div></button>';
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

/* ---------- logs ----------
   The run log streams over SSE: the server sends a tail, then only what gets appended,
   so text lands as the agent writes it. Polling stays as the fallback. */
function stopLog(){
  if(logTimer)clearInterval(logTimer);
  logTimer=null;
  if(logES){try{logES.close();}catch(e){} logES=null;}
}

function paintLog(){
  var box=el("logtail"); if(!box)return;
  var stick=box.scrollTop+box.clientHeight>=box.scrollHeight-24;
  var t=last&&sel?byId(last,sel):null;
  var next=renderMerged(t?t.notes:[], logBuf);
  if(box.innerHTML!==next)box.innerHTML=next;
  if(stick)box.scrollTop=box.scrollHeight;
}

function pollLog(file){
  if(logTimer)return; // already falling back
  var pull=function(){
    fetch("/api/log?file="+encodeURIComponent(file)).then(function(r){return r.json();}).then(function(d){
      if(selLog!==file)return;
      logBuf=d.tail||"";
      paintLog();
    }).catch(function(){});
  };
  pull();
  logTimer=setInterval(pull,1500);
}

function followLog(file){
  selLog=file;
  stopLog();
  logBuf="";
  try{
    logES=new EventSource("/api/log/stream?file="+encodeURIComponent(file));
    logES.onmessage=function(ev){
      if(selLog!==file)return;
      var d=JSON.parse(ev.data);
      if(d.chunk){logBuf+=d.chunk;paintLog();}
    };
    logES.onerror=function(){
      // the browser retries on its own; only fall back once it has clearly failed
      if(logES&&logES.readyState===2){logES=null;pollLog(file);}
    };
  }catch(e){pollLog(file);}
}

/* ---------- state ---------- */
function render(s){
  last=s;
  noticeChanges(s);
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
  sel=id; selLog=null; autoPicked=true; diffMode=false; diffCache=null;
  if(last)render(last);
  el("detail").scrollTop=0;
}

function loadDiff(id){
  fetch("/api/diff?ticket="+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
    if(!d.ok){toast(d.message||"could not read the changes",true);diffMode=false;if(last)render(last);return;}
    diffCache={ticket:id,stat:d.stat,patch:d.patch,truncated:d.truncated};
    if(last)render(last);
  }).catch(function(){toast("could not reach the connectr server",true);});
}

function doMerge(id){
  toast("merging "+id+"...");
  fetch("/api/merge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ticket:id})})
    .then(function(r){return r.json();})
    .then(function(d){
      toast(d.message||(d.ok?"merged":"merge failed"),!d.ok);
      if(d.ok){diffMode=false;diffCache=null;}
      refresh();
    })
    .catch(function(){toast("could not reach the connectr server",true);});
}

function doReopen(){
  fetch("/api/sweep",{method:"POST"}).then(function(r){return r.json();}).then(function(d){
    var n=(d.swept||[]).length;
    toast(n?("reopened "+n+" ticket"+(n===1?"":"s")+" - launch again to retry"):"nothing to reopen - the agent may still be alive");
    refresh();
  }).catch(function(){});
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
      if(!d.plan||!d.plan.length){toast("nothing queued to launch");return;}
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
    }).catch(function(){toast("launch failed",true);});
}

/* ---------- settings ----------
   A mode is only meaningful if you can see what it does, so the panel shows the flags
   every dispatchable tool will actually receive in whichever mode is selected. */
var setData=null, setPick=null;

function setOpen(){
  fetch("/api/settings").then(function(r){return r.json();}).then(function(d){
    setData=d; setPick=d.permissionMode;
    setRender();
    el("settings").hidden=false;
  }).catch(function(){toast("could not read settings",true);});
}
function setClose(){el("settings").hidden=true;}
function setRender(){
  if(!setData)return;
  el("modeList").innerHTML=setData.modes.map(function(m){
    return '<div class="mode'+(m.id===setPick?" on":"")+'" data-mode="'+esc(m.id)+'">'+
      '<span class="dotr"></span><span><span class="m-t">'+esc(m.title)+
      (m.id===setData.permissionMode?" &middot; current":"")+'</span>'+
      '<div class="m-b">'+esc(m.blurb)+"</div></span></div>";
  }).join("");
  el("modeFlags").innerHTML=setData.tools.map(function(t){
    var f=(t.flags[setPick]||[]).join(" ");
    return '<div class="flagrow"><span class="ft">'+esc(t.tool)+'</span>'+
      '<span class="ff">'+esc(f||"no extra flags")+"</span></div>";
  }).join("")||'<div class="flagrow"><span class="ff">no launchable tools</span></div>';
  el("autoBtn").className="switch"+(setData.autoContinue?" on":"");
}
function autoToggle(){
  if(!setData)return;
  var want=!setData.autoContinue;
  fetch("/api/settings",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({autoContinue:want})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){toast(d.error,true);return;}
      setData=d; setRender();
      toast(d.autoContinue?"auto-continue on - queued tasks will launch on their own"
        :"auto-continue off - nothing launches until you press Launch");
      refresh();
    }).catch(function(){toast("could not save the setting",true);});
}
function setApply(mode){
  setPick=mode; setRender();
  fetch("/api/settings",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({permissionMode:mode})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error){toast(d.error,true);return;}
      setData=d; setPick=d.permissionMode; setRender();
      toast("permission mode is now "+d.permissionMode+" - every tool you launch follows it");
      refresh();
    }).catch(function(){toast("could not save the mode",true);});
}
el("modeList").addEventListener("click",function(e){
  var row=e.target.closest?e.target.closest(".mode"):null;
  if(row)setApply(row.getAttribute("data-mode"));
});
el("settings").addEventListener("click",function(e){if(e.target===el("settings"))setClose();});
el("autoBtn").addEventListener("click",autoToggle);
el("autoTag").addEventListener("click",setOpen);
el("mode").addEventListener("click",setOpen);
el("mode").classList.add("clickable");
el("mode").title="Permission mode - click to change";

/* ---------- desktop shell ----------
   The Electron preload exposes window.connectr to whatever page it loads, including this
   one - so the dashboard can offer a way back to the picker and a Ctrl+K switcher when it
   is running inside the app, and stay a plain web page when it is not. */
var SHELL=!!(window.connectr&&window.connectr.listProjects&&window.connectr.openProject);
var palAll=[], palShown=[], palIdx=0;

function palOpen(){
  if(!SHELL){toast("switching projects needs the ConnectR desktop app");return;}
  window.connectr.listProjects().then(function(ps){
    palAll=ps||[]; palIdx=0;
    el("palInput").value="";
    palRender();
    el("palette").hidden=false;
    el("palInput").focus();
  }).catch(function(){toast("could not read your projects",true);});
}
function palClose(){el("palette").hidden=true;}
function palRender(){
  var q=el("palInput").value.toLowerCase();
  palShown=palAll.filter(function(p){return (p.name+" "+p.path).toLowerCase().indexOf(q)>=0;});
  if(palIdx>=palShown.length)palIdx=Math.max(0,palShown.length-1);
  el("palList").innerHTML=palShown.map(function(p,i){
    return '<div class="pal-i'+(i===palIdx?" on":"")+'" data-pi="'+i+'">'+
      '<span class="pal-n">'+esc(p.name)+'</span>'+
      '<span class="pal-p">'+esc(p.path)+'</span></div>';
  }).join("")||'<div class="pal-none">no projects match</div>';
}
function palChoose(i){
  var p=palShown[i];
  if(!p)return;
  palClose();
  toast("opening "+p.name+"\\u2026");
  window.connectr.openProject(p.path).then(function(r){
    if(r&&r.ok===false)toast(r.error||"could not open that project",true);
  }).catch(function(){});
}

if(SHELL){
  document.body.classList.add("shell");
  el("homeBtn").onclick=function(){window.connectr.goHome();};
  el("palInput").addEventListener("input",palRender);
  el("palInput").addEventListener("keydown",function(e){
    if(e.key==="ArrowDown"){e.preventDefault();palIdx=Math.min(palIdx+1,palShown.length-1);palRender();}
    else if(e.key==="ArrowUp"){e.preventDefault();palIdx=Math.max(palIdx-1,0);palRender();}
    else if(e.key==="Enter"){e.preventDefault();palChoose(palIdx);}
    else if(e.key==="Escape"){e.preventDefault();palClose();}
  });
  el("palList").addEventListener("click",function(e){
    var row=e.target.closest?e.target.closest(".pal-i"):null;
    if(row)palChoose(Number(row.getAttribute("data-pi")));
  });
  el("palette").addEventListener("click",function(e){if(e.target===el("palette"))palClose();});
}

/* ---------- wiring ---------- */
el("mark").innerHTML=I.logo;
paintBell();
el("bell").addEventListener("click",bellClick);
el("pfx").innerHTML=I.chev;
el("planBtn").innerHTML=I.spark+"Plan it";
el("addBtn").innerHTML=I.plus+"Add as one task";
el("dispatchBtn").innerHTML=I.play+"Launch";
el("planBtn").onclick=planIt;
el("addBtn").onclick=addTask;
el("dispatchBtn").onclick=armDispatch;
el("confirmGo").onclick=doDispatch;
el("confirmNo").onclick=function(){el("confirm").style.display="none";pending=null;toast("launch cancelled");};
el("task").addEventListener("keydown",function(e){
  // Enter is the conversational path; shift+enter is the literal one.
  if(e.key==="Enter")e.shiftKey?addTask():planIt();
  if(e.key==="Escape")el("task").blur();
});
document.addEventListener("click",function(e){
  var tg=e.target; if(!tg||!tg.closest)return;
  var sm=tg.closest(".sample");
  if(sm){el("task").value=sm.getAttribute("data-intent")||"";planIt();return;}
  var rt=tg.closest(".rt");
  if(rt){selLog=rt.getAttribute("data-f");if(last)render(last);return;}
  var node=tg.closest("[data-id]");
  if(node)select(node.getAttribute("data-id"));
});
document.addEventListener("keydown",function(e){
  var typing=document.activeElement&&document.activeElement.tagName==="INPUT";
  if((e.ctrlKey||e.metaKey)&&(e.key==="k"||e.key==="K")){e.preventDefault();palOpen();return;}
  if((e.ctrlKey||e.metaKey)&&(e.key===","||e.key==="<")){e.preventDefault();setOpen();return;}
  if(!el("settings").hidden){if(e.key==="Escape")setClose();return;}
  if((e.ctrlKey||e.metaKey)&&(e.key==="o"||e.key==="O")&&SHELL){e.preventDefault();window.connectr.goHome();return;}
  if(!el("palette").hidden)return; // the palette owns the keyboard while it is open
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
