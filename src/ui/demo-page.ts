export const DEMO_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="MatchShift — spoiler-safe rich match replay with server-side visibility gates." />
  <title>MatchShift — Live data without future knowledge</title>
  <style>
    :root { color-scheme: dark; --bg:#070b10; --panel:#111923; --line:rgba(255,255,255,.1); --text:#f7f9fb; --muted:#96a3b2; --accent:#55e6c1; --gold:#f9bd4a; --danger:#ff6b7a; --safe:#63e6be; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 12% 5%,rgba(85,230,193,.13),transparent 30rem),linear-gradient(160deg,#070b10,#0a1017 55%,#06090d); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    button,input,select { font:inherit; }
    button { cursor:pointer; }
    .shell { width:min(1380px,calc(100% - 28px)); margin:auto; padding-bottom:56px; }
    .topbar { min-height:72px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:center; gap:11px; font-size:20px; font-weight:850; }
    .mark { width:34px; height:34px; display:grid; place-items:center; border-radius:11px; color:#07110e; background:linear-gradient(135deg,var(--accent),#b4ffeb); }
    .top-status { color:var(--muted); font-size:13px; }
    .hero { padding:54px 0 28px; display:grid; grid-template-columns:minmax(0,1fr) minmax(290px,.42fr); gap:34px; align-items:end; }
    .eyebrow { display:inline-flex; padding:7px 11px; border:1px solid rgba(85,230,193,.26); border-radius:999px; color:var(--accent); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:20px 0 16px; font-size:clamp(40px,6vw,72px); line-height:.96; letter-spacing:-.06em; }
    .hero-copy { max-width:760px; color:#c4ccd6; font-size:clamp(16px,2vw,20px); line-height:1.55; }
    .hero-card,.demo-frame { border:1px solid var(--line); background:rgba(12,18,25,.88); box-shadow:0 24px 80px rgba(0,0,0,.4); }
    .hero-card { padding:22px; border-radius:22px; }
    .hero-card strong { display:block; margin-bottom:8px; }
    .hero-card p { color:var(--muted); font-size:14px; line-height:1.5; }
    .primary,.secondary,.quiet { border:0; border-radius:12px; min-height:42px; padding:0 16px; font-weight:780; }
    .primary { width:100%; color:#06110e; background:linear-gradient(135deg,var(--accent),#a8ffe7); }
    .secondary { color:var(--text); border:1px solid var(--line); background:rgba(255,255,255,.05); }
    .quiet { color:var(--muted); border:1px solid var(--line); background:transparent; }
    button:disabled { opacity:.55; cursor:wait; }
    .proof-strip { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:24px; }
    .proof-item { padding:14px 16px; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,.025); }
    .proof-item span { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
    .proof-item strong { display:block; margin-top:6px; font-size:13px; }
    .error-banner { display:none; margin-bottom:12px; padding:12px 14px; border:1px solid rgba(255,107,122,.3); border-radius:12px; color:#ffd7dc; background:rgba(255,107,122,.08); }
    .error-banner.visible { display:block; }
    .demo-frame { overflow:hidden; border-radius:26px; }
    .demo-header { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:20px 22px; border-bottom:1px solid var(--line); }
    .match-title { font-size:18px; font-weight:850; }
    .match-meta { margin-top:4px; color:var(--muted); font-size:12px; }
    .shield { color:var(--safe); border:1px solid rgba(99,230,190,.24); background:rgba(99,230,190,.07); padding:8px 11px; border-radius:999px; font-size:12px; font-weight:780; }
    .toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:12px 22px; border-bottom:1px solid var(--line); background:rgba(255,255,255,.018); }
    .filter-group { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; }
    select { color:var(--text); background:#111923; border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
    .compare-grid { display:grid; grid-template-columns:1fr 1fr; }
    .viewer { min-width:0; padding:22px; }
    .viewer + .viewer { border-left:1px solid var(--line); }
    .viewer-heading { display:flex; justify-content:space-between; gap:16px; margin-bottom:17px; }
    .viewer-kicker,.section-label { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.09em; }
    .viewer-heading h2 { margin:5px 0 0; font-size:21px; }
    .badge { padding:7px 10px; border-radius:999px; font-size:11px; font-weight:850; }
    .badge.live { color:#fff; background:rgba(255,77,103,.18); border:1px solid rgba(255,77,103,.32); }
    .badge.personal { color:var(--accent); background:rgba(85,230,193,.08); border:1px solid rgba(85,230,193,.24); }
    .badge.hold { color:var(--gold); background:rgba(249,189,74,.08); border:1px solid rgba(249,189,74,.25); }
    .score-card { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:14px; padding:18px; border:1px solid var(--line); border-radius:17px; background:rgba(255,255,255,.035); }
    .team { color:#d3dae3; font-size:13px; }
    .team:last-child { text-align:right; }
    .score { font-size:36px; font-weight:880; letter-spacing:-.06em; }
    .minute { margin-top:7px; color:var(--muted); text-align:center; font-size:11px; }
    .section-label { display:flex; justify-content:space-between; margin:18px 0 9px; }
    .odds-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
    .odd { padding:10px; text-align:center; border:1px solid var(--line); border-radius:11px; background:rgba(255,255,255,.025); }
    .odd span { display:block; color:var(--muted); font-size:10px; }
    .odd strong { display:block; margin-top:4px; font-size:15px; }
    .stats-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
    .stat { padding:9px 5px; text-align:center; border:1px solid var(--line); border-radius:10px; background:rgba(255,255,255,.022); }
    .stat span { display:block; color:var(--muted); font-size:9px; }
    .stat strong { display:block; margin-top:3px; font-size:13px; }
    .timeline { max-height:520px; min-height:120px; overflow:auto; display:grid; gap:7px; padding-right:3px; }
    .event { display:grid; grid-template-columns:52px 1fr auto; gap:10px; align-items:start; padding:10px 11px; border:1px solid var(--line); border-radius:11px; background:rgba(255,255,255,.025); }
    .event.key { border-color:rgba(249,189,74,.26); background:rgba(249,189,74,.045); }
    .event.flow { opacity:.76; }
    .event-time { color:var(--accent); font-size:11px; font-weight:800; }
    .event-copy { font-size:12px; line-height:1.35; }
    .event-detail { margin-top:3px; color:var(--muted); font-size:10px; }
    .event-tag { color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.06em; }
    .empty { color:var(--muted); font-size:12px; padding:16px 3px; }
    .explanation { min-height:58px; padding:12px 13px; border:1px solid rgba(85,230,193,.16); border-radius:12px; background:rgba(85,230,193,.045); color:#d8eee8; font-size:12px; line-height:1.45; }
    .controls { padding:18px 22px 22px; border-top:1px solid var(--line); }
    .control-top { display:flex; justify-content:space-between; margin-bottom:10px; }
    .cursor-readout { color:var(--accent); font-size:13px; }
    input[type=range] { width:100%; accent-color:var(--accent); }
    .control-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:13px; }
    .boundary-note { margin-top:15px; padding:12px 13px; border:1px solid rgba(249,189,74,.17); border-radius:12px; color:#e5d8ba; background:rgba(249,189,74,.045); font-size:11px; line-height:1.45; }
    .architecture { margin-top:24px; display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
    .node { padding:13px; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,.025); }
    .node span { color:var(--accent); font-size:9px; text-transform:uppercase; }
    .node strong { display:block; margin-top:6px; font-size:12px; }
    footer { display:flex; justify-content:space-between; gap:16px; padding-top:28px; color:var(--muted); font-size:11px; }
    .loading .demo-frame { opacity:.72; }
    @media(max-width:980px){ .hero{grid-template-columns:1fr}.compare-grid{grid-template-columns:1fr}.viewer+.viewer{border-left:0;border-top:1px solid var(--line)}.proof-strip{grid-template-columns:1fr}.architecture{grid-template-columns:1fr 1fr}.stats-grid{grid-template-columns:repeat(3,1fr)} }
    @media(max-width:560px){ .shell{width:calc(100% - 16px)}.demo-header{align-items:flex-start;flex-direction:column}.viewer,.controls,.demo-header,.toolbar{padding-left:14px;padding-right:14px}.architecture{grid-template-columns:1fr}.event{grid-template-columns:44px 1fr}.event-tag{display:none}footer{flex-direction:column} }
  </style>
</head>
<body>
  <main class="shell" id="app">
    <header class="topbar"><div class="brand"><span class="mark">M</span> MatchShift</div><div class="top-status" id="source-status">Synthetic replay ready</div></header>
    <section class="hero">
      <div><span class="eyebrow">Spoiler-safe by architecture</span><h1>Watch on your time.<br />Not the internet’s.</h1><p class="hero-copy">One live match. Two viewers. Each person receives only the score, events, statistics and market context that existed at their own viewing minute.</p></div>
      <aside class="hero-card"><strong>60-second judge demo</strong><p>Start two isolated server-side sessions: one at the live edge and one six minutes behind. Then move the personal cursor and watch information unlock in order.</p><button class="primary" id="start-demo">Start spoiler-safe demo</button></aside>
    </section>
    <section class="proof-strip"><div class="proof-item"><span>Judge access</span><strong>No login · no wallet · no payment</strong></div><div class="proof-item"><span>Rich replay</span><strong>Score · VAR · cards · shots · restarts · odds</strong></div><div class="proof-item"><span>Isolation</span><strong>Server-side cursor gate</strong></div></section>
    <div class="error-banner" id="error-banner" role="alert"></div>
    <section class="demo-frame" id="demo-frame">
      <header class="demo-header"><div><div class="match-title" id="match-title">Northbridge vs Southport</div><div class="match-meta" id="match-meta">Synthetic replay · press Start to create isolated sessions</div></div><div class="shield">◆ Spoiler shield active</div></header>
      <div class="toolbar"><div class="filter-group"><strong>Timeline view</strong><select id="timeline-filter"><option value="KEY">Key events</option><option value="HIGHLIGHTS" selected>Highlights</option><option value="FULL">Full timeline</option></select></div><div class="filter-group"><span id="event-count">0 visible events</span></div></div>
      <div class="compare-grid">
        <article class="viewer">
          <div class="viewer-heading"><div><div class="viewer-kicker">Viewer A</div><h2>Live edge</h2></div><span class="badge live" id="live-badge">● LIVE</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="live-score">– : –</div><div class="minute" id="live-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label"><span>Visible probabilities</span></div><div class="odds-grid" id="live-odds"></div>
          <div class="section-label"><span>Visible match stats</span></div><div class="stats-grid" id="live-stats"></div>
          <div class="section-label"><span>Visible timeline</span><span id="live-event-count">0</span></div><div class="timeline" id="live-events"><div class="empty">Start the demo to load the live viewer.</div></div>
          <div class="section-label"><span>Timeline-aware explanation</span></div><div class="explanation" id="live-explanation">Only information visible at this viewer’s cursor is passed to the explanation layer.</div>
        </article>
        <article class="viewer">
          <div class="viewer-heading"><div><div class="viewer-kicker">Viewer B</div><h2>Personal timeline</h2></div><span class="badge personal" id="personal-badge">DELAYED</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="personal-score">– : –</div><div class="minute" id="personal-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label"><span>Visible probabilities</span></div><div class="odds-grid" id="personal-odds"></div>
          <div class="section-label"><span>Visible match stats</span></div><div class="stats-grid" id="personal-stats"></div>
          <div class="section-label"><span>Visible timeline</span><span id="personal-event-count">0</span></div><div class="timeline" id="personal-events"><div class="empty">Future events stay absent from this response.</div></div>
          <div class="section-label"><span>Timeline-aware explanation</span></div><div class="explanation" id="personal-explanation">The delayed viewer cannot retrieve the live viewer’s future score, goal or odds.</div>
        </article>
      </div>
      <div class="controls"><div class="control-top"><div><strong>Personal viewing cursor</strong></div><div class="cursor-readout" id="cursor-readout">43:00</div></div><input id="cursor" type="range" min="0" max="52" step="0.1666667" value="43" disabled aria-label="Personal viewing minute" /><div class="control-row"><button class="secondary" id="advance-one" disabled>+1 minute</button><button class="secondary" id="pause" disabled>Pause</button><button class="secondary" id="resume" disabled>Resume</button><button class="secondary" id="catch-up" disabled>Catch up to live</button><button class="quiet" id="reset">Reset demo</button></div><div class="boundary-note"><strong>No client-side hiding.</strong> Every state is rebuilt on the server from records at or before that session’s effective cursor. Future records are omitted from the API response itself.</div></div>
    </section>
    <section class="architecture"><div class="node"><span>01 · ingest</span><strong>TxLINE or deterministic replay</strong></div><div class="node"><span>02 · normalize</span><strong>Lifecycle-clean event model</strong></div><div class="node"><span>03 · enrich</span><strong>Stats, momentum and odds</strong></div><div class="node"><span>04 · gate</span><strong>Per-session visibility cursor</strong></div><div class="node"><span>05 · explain</span><strong>Visible state only</strong></div></section>
    <footer><span>MatchShift · Consumer & Fan Experience track</span><span>Live data without future knowledge.</span></footer>
  </main>
  <script>
    (function () {
      "use strict";
      var model = {
        fixture: null,
        live: null,
        personal: null,
        busy: false
      };
      model.timelineFilter = "HIGHLIGHTS";
      var ids = [
        "start-demo", "cursor", "advance-one", "pause", "resume", "catch-up",
        "reset", "error-banner", "source-status", "match-title", "match-meta",
        "live-badge", "live-score", "live-minute", "live-odds", "live-events",
        "live-explanation", "personal-badge", "personal-score", "personal-minute",
        "personal-odds", "personal-events", "personal-explanation", "cursor-readout",
        "timeline-filter", "event-count", "live-event-count", "personal-event-count",
        "live-stats", "personal-stats"
      ];
      var el = {};
      ids.forEach(function (id) { el[id] = document.getElementById(id); });
      function escapeHtml(value) { return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
      function api(url, options) { var init=options||{}; init.headers=Object.assign({"Content-Type":"application/json"},init.headers||{}); return fetch(url,init).then(function(response){ return response.json().catch(function(){return {};}).then(function(body){ if(!response.ok) throw new Error(body.error||"Request failed with status "+response.status); return body; }); }); }
      function setBusy(value) {
        model.busy = value;
        document.body.classList.toggle("loading", value);
        [el["start-demo"], el.cursor, el["advance-one"], el.pause, el.resume, el["catch-up"]]
          .forEach(function (button) { if (button) button.disabled = value || model.personal === null; });
        el["start-demo"].disabled = value;
      }
      function showError(error){ el["error-banner"].textContent=error instanceof Error?error.message:String(error); el["error-banner"].classList.add("visible"); }
      function clearError(){ el["error-banner"].textContent=""; el["error-banner"].classList.remove("visible"); }
      function minuteLabel(value){ var whole=Math.floor(value),seconds=Math.round((value-whole)*60); if(seconds===60){whole+=1;seconds=0;} return String(whole).padStart(2,"0")+":"+String(seconds).padStart(2,"0"); }
      function probabilityCard(label,value){ var safe=Number.isFinite(value)?Math.round(value*100)+"%":"—"; return '<div class="odd"><span>'+escapeHtml(label)+'</span><strong>'+safe+'</strong></div>'; }
      function renderOdds(target,p){ target.innerHTML=p?probabilityCard("Home",p.homeWin)+probabilityCard("Draw",p.draw)+probabilityCard("Away",p.awayWin):probabilityCard("Home",NaN)+probabilityCard("Draw",NaN)+probabilityCard("Away",NaN); }
      function statCard(label,home,away){ return '<div class="stat"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(home)+"–"+escapeHtml(away)+'</strong></div>'; }
      function renderStats(target,stats){ if(!stats){target.innerHTML=statCard("Shots",0,0)+statCard("On target",0,0)+statCard("Corners",0,0)+statCard("Cards",0,0)+statCard("Subs",0,0);return;} target.innerHTML=statCard("Shots",stats.home.shots,stats.away.shots)+statCard("On target",stats.home.shotsOnTarget,stats.away.shotsOnTarget)+statCard("Corners",stats.home.corners,stats.away.corners)+statCard("YC / RC",stats.home.yellowCards+"/"+stats.home.redCards,stats.away.yellowCards+"/"+stats.away.redCards)+statCard("Subs",stats.home.substitutions,stats.away.substitutions); }
      function filteredEvents(events){ return (events||[]).filter(function(event){ if(model.timelineFilter==="KEY") return event.importance==="KEY"; if(model.timelineFilter==="HIGHLIGHTS") return event.importance!=="FLOW"; return true; }); }
      function renderEvents(target, events) {
        var visible=filteredEvents(events);
        if (!visible || visible.length === 0) { target.innerHTML = '<div class="empty">No match event is visible at this cursor for this filter.</div>'; return; }
        target.innerHTML = visible.slice(-80).map(function (event) {
          var copy = event.eventType === "GOAL"
            ? (event.team === "HOME" ? "Northbridge goal" : "Southport goal")
            : "Kickoff";
          copy=event.label||copy;
          var clock=event.clockLabel||String(event.minute)+"′";
          var detail=event.detail?'<div class="event-detail">'+escapeHtml(event.detail)+'</div>':"";
          return '<div class="event '+String(event.importance||"STANDARD").toLowerCase()+'"><div class="event-time">'+escapeHtml(clock)+'</div><div class="event-copy">'+escapeHtml(copy)+detail+'</div><div class="event-tag">'+escapeHtml(event.category||event.eventType)+'</div></div>';
        }).join("");
      }
      function renderViewer(prefix,payload){ var state=payload&&payload.state?payload.state:null,session=payload&&payload.session?payload.session:null; if(!state||!session)return; el[prefix+"-score"].textContent=state.score.home+" : "+state.score.away;
        el[prefix + "-minute"].textContent = "Viewer minute " + state.session.viewerMinute;
        renderOdds(el[prefix+"-odds"],state.impliedProbabilities); renderStats(el[prefix+"-stats"],state.statistics); renderEvents(el[prefix+"-events"],state.events); el[prefix+"-event-count"].textContent=filteredEvents(state.events).length+" shown / "+state.events.length+" visible"; el[prefix+"-explanation"].textContent=state.latestExplanation||(state.safety.active?"Information is held until a trusted sequence baseline is restored.":"No new visible event requires an explanation at this cursor."); var badge=el[prefix+"-badge"]; badge.textContent=state.safety.active?"SAFE HOLD":state.session.statusBadge; badge.className="badge "+(state.safety.active?"hold":prefix==="live"?"live":"personal"); }
      function render(){
        if (model.fixture) {
          el["match-title"].textContent = "Northbridge vs Southport";
          el["match-meta"].textContent = model.fixture.provenance + " replay · two independent server sessions";
        }
        renderViewer("live",model.live); renderViewer("personal",model.personal); var total=(model.personal&&model.personal.state?model.personal.state.events.length:0); el["event-count"].textContent=total+" events visible at personal cursor"; if(model.personal&&model.fixture){var cursorMinute=(model.personal.session.visibilityCursor-model.fixture.kickoffTimestamp)/60000; el.cursor.value=String(Math.max(0,Math.min(model.fixture.maxMinute,cursorMinute))); el["cursor-readout"].textContent=minuteLabel(cursorMinute);} }
      function startDemo() {
        clearError(); setBusy(true);
        api("/api/demo/start", { method: "POST", body: "{}" })
          .then(function(payload){ model.fixture=payload.fixture; model.live=payload.live; model.personal=payload.personal; el.cursor.max=String(payload.fixture.maxMinute); render(); })
          .catch(showError).finally(function(){setBusy(false);});
      }
      function patchPersonal(command){ if(!model.personal)return Promise.resolve(); clearError(); setBusy(true); return api("/api/sessions/"+encodeURIComponent(model.personal.session.sessionId),{method:"PATCH",body:JSON.stringify(command)}).then(function(payload){model.personal=payload;render();}).catch(showError).finally(function(){setBusy(false);}); }
      function setCursorFromSlider(){ if(!model.fixture)return; var minute=Number(el.cursor.value); el["cursor-readout"].textContent=minuteLabel(minute); patchPersonal({type:"ADVANCE_TO",cursorMs:model.fixture.kickoffTimestamp+Math.round(minute*60000)}); }
      el["start-demo"].addEventListener("click", startDemo);
      el.cursor.addEventListener("input",function(){el["cursor-readout"].textContent=minuteLabel(Number(el.cursor.value));});
      el.cursor.addEventListener("change",setCursorFromSlider);
      el["timeline-filter"].addEventListener("change",function(){model.timelineFilter=el["timeline-filter"].value;render();});
      el["advance-one"].addEventListener("click",function(){if(!model.personal||!model.fixture)return;patchPersonal({type:"ADVANCE_TO",cursorMs:Math.min(model.fixture.liveEdgeTimestamp,model.personal.session.visibilityCursor+60000)});});
      el.pause.addEventListener("click",function(){patchPersonal({type:"PAUSE"});}); el.resume.addEventListener("click",function(){patchPersonal({type:"RESUME"});}); el["catch-up"].addEventListener("click",function(){patchPersonal({type:"CATCH_UP"});});
      el.reset.addEventListener("click", startDemo);
      renderOdds(el["live-odds"],null);renderOdds(el["personal-odds"],null);renderStats(el["live-stats"],null);renderStats(el["personal-stats"],null);
      api("/api/data-source/status").then(function(status){el["source-status"].textContent=status.mode==="synthetic"?"Synthetic judge replay ready":"Optional "+status.mode+" backend · judge replay remains synthetic";})
        .catch(function () {
          el["source-status"].textContent = "Judge replay ready";
        });
    })();
  </script>
</body>
</html>`;
