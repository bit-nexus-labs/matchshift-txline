export const DEMO_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="MatchShift spoiler-safe match replay" />
  <title>MatchShift — Live data without future knowledge</title>
  <style>
    :root { color-scheme: dark; --bg:#071018; --panel:#101b26; --line:#263646; --text:#f6f8fa; --muted:#9aabba; --accent:#5ce1c2; --gold:#f6bf52; --danger:#ff7180; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at top left,#12312f 0,transparent 38rem),var(--bg); color:var(--text); font-family:Inter,system-ui,sans-serif; }
    button,input,select { font:inherit; }
    button { cursor:pointer; }
    button:disabled { cursor:wait; opacity:.55; }
    .shell { width:min(1240px,calc(100% - 28px)); margin:auto; padding:0 0 48px; }
    .topbar { min-height:68px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
    .brand { font-size:20px; font-weight:850; }
    .status { color:var(--muted); font-size:13px; }
    .hero { display:grid; grid-template-columns:1fr minmax(280px,.38fr); gap:28px; padding:48px 0 26px; align-items:end; }
    h1 { margin:0 0 14px; font-size:clamp(40px,6vw,68px); line-height:.98; letter-spacing:-.05em; }
    .hero p { max-width:760px; color:#c3ced8; line-height:1.55; }
    .card,.demo { border:1px solid var(--line); background:rgba(16,27,38,.93); border-radius:20px; box-shadow:0 22px 70px rgba(0,0,0,.32); }
    .card { padding:20px; }
    .primary,.secondary,.quiet { min-height:42px; padding:0 15px; border-radius:11px; font-weight:780; }
    .primary { width:100%; border:0; color:#062019; background:linear-gradient(135deg,var(--accent),#b9ffed); }
    .secondary,.quiet { color:var(--text); border:1px solid var(--line); background:#172431; }
    .quiet { background:transparent; color:var(--muted); }
    .demo { overflow:hidden; }
    .demo-head,.toolbar,.controls { padding:16px 20px; }
    .demo-head { display:flex; justify-content:space-between; gap:16px; border-bottom:1px solid var(--line); }
    .match-title { font-size:18px; font-weight:850; }
    .match-meta { margin-top:4px; color:var(--muted); font-size:12px; }
    .shield { color:var(--accent); font-size:12px; font-weight:800; }
    .toolbar { display:flex; justify-content:space-between; gap:12px; align-items:center; border-bottom:1px solid var(--line); }
    select { padding:8px 10px; color:var(--text); border:1px solid var(--line); border-radius:9px; background:#14212d; }
    .compare { display:grid; grid-template-columns:1fr 1fr; }
    .viewer { min-width:0; padding:20px; }
    .viewer + .viewer { border-left:1px solid var(--line); }
    .viewer-head { display:flex; justify-content:space-between; align-items:center; }
    .viewer h2 { margin:0; font-size:20px; }
    .badge { padding:6px 9px; border:1px solid var(--line); border-radius:999px; font-size:11px; }
    .score-card { margin-top:14px; display:grid; grid-template-columns:1fr auto 1fr; gap:12px; align-items:center; padding:15px; border:1px solid var(--line); border-radius:14px; }
    .team { color:#d4dde5; font-size:13px; }
    .team:last-child { text-align:right; }
    .score { font-size:34px; font-weight:860; }
    .minute { color:var(--muted); text-align:center; font-size:11px; }
    .section-label { margin:16px 0 8px; color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
    .odds-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
    .odd,.stat { padding:9px; text-align:center; border:1px solid var(--line); border-radius:10px; }
    .odd span,.stat span { display:block; color:var(--muted); font-size:9px; }
    .odd strong,.stat strong { display:block; margin-top:4px; }
    .stats-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; }
    .timeline { min-height:110px; max-height:430px; overflow:auto; display:grid; gap:6px; }
    .event { display:grid; grid-template-columns:52px 1fr auto; gap:9px; padding:9px 10px; border:1px solid var(--line); border-radius:10px; }
    .event.key { border-color:#705d2e; background:#241f13; }
    .event.flow { opacity:.74; }
    .event-time { color:var(--accent); font-size:11px; font-weight:800; }
    .event-copy { font-size:12px; }
    .event-detail,.event-tag,.empty { color:var(--muted); font-size:10px; }
    .explanation { min-height:54px; padding:11px; border:1px solid #245146; border-radius:11px; color:#d8eee8; font-size:12px; }
    .controls { border-top:1px solid var(--line); }
    .control-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    input[type=range] { width:100%; accent-color:var(--accent); }
    .error { display:none; margin:0 0 12px; padding:11px; border:1px solid #713541; border-radius:10px; color:#ffd8dd; }
    .error.visible { display:block; }
    @media(max-width:900px){ .hero,.compare{grid-template-columns:1fr}.viewer+.viewer{border-left:0;border-top:1px solid var(--line)} }
    @media(max-width:560px){ .shell{width:calc(100% - 16px)}.stats-grid{grid-template-columns:repeat(3,1fr)}.event{grid-template-columns:45px 1fr}.event-tag{display:none} }
  </style>
</head>
<body>
  <main class="shell" id="app">
    <header class="topbar"><div class="brand">MatchShift</div><div class="status" id="source-status">Synthetic replay ready</div></header>
    <section class="hero">
      <div><h1>Watch on your time.<br />Not the internet’s.</h1><p>One match, two independent viewers. Each receives only the score, events, statistics and probability context visible at that viewer’s own cursor.</p></div>
      <aside class="card"><strong>60-second judge demo</strong><p>Start two isolated server-side sessions: one at the live edge and one six minutes behind. Move the personal cursor to reveal information in order.</p><button class="primary" id="start-demo">Start spoiler-safe demo</button></aside>
    </section>
    <div class="error" id="error-banner" role="alert"></div>
    <section class="demo" id="demo-frame">
      <header class="demo-head"><div><div class="match-title" id="match-title">Northbridge vs Southport</div><div class="match-meta" id="match-meta">Synthetic replay · two independent server sessions</div></div><div class="shield">◆ Spoiler shield active</div></header>
      <div class="toolbar"><label>Timeline view <select id="timeline-filter"><option value="KEY">Key events</option><option value="HIGHLIGHTS" selected>Highlights</option><option value="FULL">Full timeline</option></select></label><span id="event-count">0 visible events</span></div>
      <div class="compare">
        <article class="viewer">
          <div class="viewer-head"><h2>Live edge</h2><span class="badge" id="live-badge">LIVE</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="live-score">– : –</div><div class="minute" id="live-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label">Visible probabilities</div><div class="odds-grid" id="live-odds"></div>
          <div class="section-label">Visible match stats</div><div class="stats-grid" id="live-stats"></div>
          <div class="section-label">Visible timeline · <span id="live-event-count">0</span></div><div class="timeline" id="live-events"><div class="empty">Start the demo.</div></div>
          <div class="section-label">Timeline-aware explanation</div><div class="explanation" id="live-explanation">Only visible information reaches the explanation layer.</div>
        </article>
        <article class="viewer">
          <div class="viewer-head"><h2>Personal timeline</h2><span class="badge" id="personal-badge">DELAYED</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="personal-score">– : –</div><div class="minute" id="personal-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label">Visible probabilities</div><div class="odds-grid" id="personal-odds"></div>
          <div class="section-label">Visible match stats</div><div class="stats-grid" id="personal-stats"></div>
          <div class="section-label">Visible timeline · <span id="personal-event-count">0</span></div><div class="timeline" id="personal-events"><div class="empty">Future events remain absent.</div></div>
          <div class="section-label">Timeline-aware explanation</div><div class="explanation" id="personal-explanation">The delayed viewer cannot retrieve future state.</div>
        </article>
      </div>
      <div class="controls"><div id="cursor-readout">43:00</div><input id="cursor" type="range" min="0" max="52" step="0.1666667" value="43" disabled aria-label="Personal viewing minute" /><div class="control-row"><button class="secondary" id="advance-one" disabled>+1 minute</button><button class="secondary" id="pause" disabled>Pause</button><button class="secondary" id="resume" disabled>Resume</button><button class="secondary" id="catch-up" disabled>Catch up to live</button><button class="quiet" id="reset">Reset demo</button></div></div>
    </section>
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
      function api(url, options) { var init=options||{}; init.headers=Object.assign({"Content-Type":"application/json"},init.headers||{}); return fetch(url,init).then(function(response){return response.json().catch(function(){return {};}).then(function(body){if(!response.ok)throw new Error(body.error||"Request failed");return body;});}); }
      function minuteLabel(value) { var whole=Math.floor(value),seconds=Math.round((value-whole)*60); if(seconds===60){whole+=1;seconds=0;} return String(whole).padStart(2,"0")+":"+String(seconds).padStart(2,"0"); }
      function showError(error) { el["error-banner"].textContent=error instanceof Error?error.message:String(error); el["error-banner"].classList.add("visible"); }
      function clearError() { el["error-banner"].textContent=""; el["error-banner"].classList.remove("visible"); }
      function setBusy(value) {
        model.busy = value;
        [el["start-demo"], el.cursor, el["advance-one"], el.pause, el.resume, el["catch-up"]]
          .forEach(function (button) { if (button) button.disabled = value || model.personal === null; });
        el["start-demo"].disabled = value;
      }
      function probabilityCard(label,value){return '<div class="odd"><span>'+escapeHtml(label)+'</span><strong>'+(Number.isFinite(value)?Math.round(value*100)+"%":"—")+'</strong></div>';}
      function renderOdds(target,p){target.innerHTML=p?probabilityCard("Home",p.homeWin)+probabilityCard("Draw",p.draw)+probabilityCard("Away",p.awayWin):probabilityCard("Home",NaN)+probabilityCard("Draw",NaN)+probabilityCard("Away",NaN);}
      function statCard(label,home,away){return '<div class="stat"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(home)+"–"+escapeHtml(away)+'</strong></div>';}
      function renderStats(target,stats){if(!stats){target.innerHTML=statCard("Shots",0,0)+statCard("On target",0,0)+statCard("Corners",0,0)+statCard("Cards",0,0)+statCard("Subs",0,0);return;}target.innerHTML=statCard("Shots",stats.home.shots,stats.away.shots)+statCard("On target",stats.home.shotsOnTarget,stats.away.shotsOnTarget)+statCard("Corners",stats.home.corners,stats.away.corners)+statCard("YC / RC",stats.home.yellowCards+"/"+stats.home.redCards,stats.away.yellowCards+"/"+stats.away.redCards)+statCard("Subs",stats.home.substitutions,stats.away.substitutions);}
      function filteredEvents(events){return(events||[]).filter(function(event){if(model.timelineFilter==="KEY")return event.importance==="KEY";if(model.timelineFilter==="HIGHLIGHTS")return event.importance!=="FLOW";return true;});}
      function renderEvents(target, events) {
        var visible = filteredEvents(events);
        if (!visible.length) { target.innerHTML = '<div class="empty">No match event is visible at this cursor.</div>'; return; }
        target.innerHTML = visible.slice(-80).map(function (event) {
          var copy = event.eventType === "GOAL"
            ? (event.team === "HOME" ? "Northbridge goal" : "Southport goal")
            : "Kickoff";
          copy = event.label || copy;
          var detail = event.detail ? '<div class="event-detail">'+escapeHtml(event.detail)+'</div>' : "";
          return '<div class="event '+String(event.importance||"STANDARD").toLowerCase()+'"><div class="event-time">'+escapeHtml(event.clockLabel||String(event.minute)+"′")+'</div><div class="event-copy">'+escapeHtml(copy)+detail+'</div><div class="event-tag">'+escapeHtml(event.category||event.eventType)+'</div></div>';
        }).join("");
      }
      function renderViewer(prefix,payload) {
        var state=payload&&payload.state?payload.state:null,session=payload&&payload.session?payload.session:null;
        if(!state||!session)return;
        el[prefix+"-score"].textContent=state.score.home+" : "+state.score.away;
        el[prefix + "-minute"].textContent = "Viewer minute " + state.session.viewerMinute;
        renderOdds(el[prefix+"-odds"],state.impliedProbabilities);
        renderStats(el[prefix+"-stats"],state.statistics);
        renderEvents(el[prefix+"-events"],state.events);
        el[prefix+"-event-count"].textContent=filteredEvents(state.events).length+" shown / "+state.events.length+" visible";
        el[prefix+"-explanation"].textContent=state.latestExplanation||"No new visible event requires an explanation.";
        var badge=el[prefix+"-badge"];
        badge.textContent = state.safety.active ? "SAFE HOLD" : state.session.statusBadge;
      }
      function render() {
        if (model.fixture) {
          el["match-title"].textContent = "Northbridge vs Southport";
          el["match-meta"].textContent = model.fixture.provenance + " replay · two independent server sessions";
        }
        renderViewer("live",model.live);
        renderViewer("personal",model.personal);
        var total=model.personal&&model.personal.state?model.personal.state.events.length:0;
        el["event-count"].textContent=total+" events visible at personal cursor";
        if(model.personal&&model.fixture){var cursorMinute=(model.personal.session.visibilityCursor-model.fixture.kickoffTimestamp)/60000;el.cursor.value=String(Math.max(0,Math.min(model.fixture.maxMinute,cursorMinute)));el["cursor-readout"].textContent=minuteLabel(cursorMinute);}
      }
      function startDemo() {
        clearError(); setBusy(true);
        api("/api/demo/start", { method: "POST", body: "{}" })
          .then(function (payload) {
            model.fixture = payload.fixture;
            model.live=payload.live; model.personal=payload.personal; el.cursor.max=String(payload.fixture.maxMinute); render();
          })
          .catch(showError).finally(function(){setBusy(false);});
      }
      function patchPersonal(command){if(!model.personal)return Promise.resolve();clearError();setBusy(true);return api("/api/sessions/"+encodeURIComponent(model.personal.session.sessionId),{method:"PATCH",body:JSON.stringify(command)}).then(function(payload){model.personal=payload;render();}).catch(showError).finally(function(){setBusy(false);});}
      el["start-demo"].addEventListener("click", startDemo);
      el.cursor.addEventListener("change",function(){if(!model.fixture)return;var minute=Number(el.cursor.value);patchPersonal({type:"ADVANCE_TO",cursorMs:model.fixture.kickoffTimestamp+Math.round(minute*60000)});});
      el["timeline-filter"].addEventListener("change",function(){model.timelineFilter=el["timeline-filter"].value;render();});
      el["advance-one"].addEventListener("click",function(){if(!model.personal||!model.fixture)return;patchPersonal({type:"ADVANCE_TO",cursorMs:Math.min(model.fixture.liveEdgeTimestamp,model.personal.session.visibilityCursor+60000)});});
      el.pause.addEventListener("click",function(){patchPersonal({type:"PAUSE"});});
      el.resume.addEventListener("click",function(){patchPersonal({type:"RESUME"});});
      el["catch-up"].addEventListener("click",function(){patchPersonal({type:"CATCH_UP"});});
      el.reset.addEventListener("click", startDemo);
      renderOdds(el["live-odds"],null); renderOdds(el["personal-odds"],null); renderStats(el["live-stats"],null); renderStats(el["personal-stats"],null);
      api("/api/data-source/status").then(function(status){el["source-status"].textContent=status.mode==="synthetic"?"Synthetic judge replay ready":"Optional "+status.mode+" backend";})
        .catch(function () {
          el["source-status"].textContent = "Judge replay ready";
        });
    })();
  </script>
</body>
</html>`;
