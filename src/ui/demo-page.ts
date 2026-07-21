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
    .demo { position:relative; }
    .demo-head,.toolbar { padding:16px 20px; }
    .demo-head { display:flex; justify-content:space-between; gap:16px; border-bottom:1px solid var(--line); border-radius:20px 20px 0 0; }
    .match-title { font-size:18px; font-weight:850; }
    .match-meta { margin-top:4px; color:var(--muted); font-size:12px; }
    .shield { color:var(--accent); font-size:12px; font-weight:800; }
    .toolbar { display:flex; justify-content:space-between; gap:12px; align-items:center; border-bottom:1px solid var(--line); }
    select { padding:8px 10px; color:var(--text); border:1px solid var(--line); border-radius:9px; background:#14212d; }
    .replay-dock { position:sticky; top:8px; z-index:20; margin:10px; padding:13px 14px; border:1px solid #315d55; border-radius:14px; background:rgba(10,24,31,.97); box-shadow:0 14px 38px rgba(0,0,0,.34); }
    .dock-top { display:flex; justify-content:space-between; gap:14px; align-items:center; }
    .dock-score { font-size:18px; font-weight:850; }
    .dock-context,.dock-latest { color:var(--muted); font-size:11px; }
    .dock-time { color:var(--accent); font-size:13px; font-weight:800; white-space:nowrap; }
    .dock-controls { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .dock-latest { margin-top:9px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    input[type=range] { width:100%; margin-top:9px; accent-color:var(--accent); }
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
    .odds-note { min-height:16px; margin-top:6px; color:var(--muted); font-size:10px; line-height:1.4; }
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
    .error { display:none; margin:0 0 12px; padding:11px; border:1px solid #713541; border-radius:10px; color:#ffd8dd; }
    .error.visible { display:block; }
    @media(max-width:900px){ .hero,.compare{grid-template-columns:1fr}.viewer+.viewer{border-left:0;border-top:1px solid var(--line)} }
    @media(max-width:560px){ .shell{width:calc(100% - 16px)}.stats-grid{grid-template-columns:repeat(3,1fr)}.event{grid-template-columns:45px 1fr}.event-tag{display:none}.dock-top{align-items:flex-start;flex-direction:column}.dock-controls button{flex:1 1 auto} }
  </style>
</head>
<body>
  <main class="shell" id="app">
    <header class="topbar"><div class="brand">MatchShift</div><div class="status" id="source-status">Synthetic replay ready</div></header>
    <section class="hero">
      <div><h1>Watch on your time.<br />Not the internet’s.</h1><p>One match, two independent viewers. Each receives only the score, events, statistics and probability context visible at that viewer’s own cursor.</p></div>
      <aside class="card"><strong>Choose a replay</strong><p>Start two isolated server-side sessions: one at the live edge and one at an earlier personal cursor. Then move the personal cursor to reveal information in order.</p><button class="primary" id="start-demo">Start synthetic judge demo</button><button class="secondary" id="start-curated" style="display:none;width:100%;margin-top:10px">Start curated real-match replay</button></aside>
    </section>
    <div class="error" id="error-banner" role="alert"></div>
    <section class="demo" id="demo-frame">
      <header class="demo-head"><div><div class="match-title" id="match-title">Choose a replay above</div><div class="match-meta" id="match-meta">The replay controls appear after a scenario starts.</div></div><div class="shield">◆ Spoiler shield active</div></header>
      <div class="toolbar"><label>Timeline view <select id="timeline-filter"><option id="filter-key" value="KEY" selected>Key events</option><option id="filter-highlights" value="HIGHLIGHTS">Highlights</option><option id="filter-full" value="FULL">Full timeline</option></select></label><span id="event-count">0 visible events</span></div>
      <section class="replay-dock" id="replay-dock" style="display:none" aria-live="polite">
        <div class="dock-top"><div><div class="dock-context" id="dock-context">Replay cursor</div><div class="dock-score" id="dock-score">– : –</div></div><div class="dock-time" id="cursor-readout">00:00</div></div>
        <input id="cursor" type="range" min="0" max="52" step="0.1666667" value="0" disabled aria-label="Personal viewing minute" />
        <div class="dock-controls"><button class="secondary" id="rewind-one" disabled>−1 minute</button><button class="secondary" id="advance-one" disabled>+1 minute</button><button class="secondary" id="pause" disabled>Pause</button><button class="secondary" id="resume" disabled>Resume</button><button class="secondary" id="catch-up" disabled>Catch up</button><button class="quiet" id="reset" disabled>Restart replay</button></div>
        <div class="dock-latest" id="dock-latest">Latest visible event: none</div>
      </section>
      <div class="compare">
        <article class="viewer">
          <div class="viewer-head"><h2>Live edge</h2><span class="badge" id="live-badge">LIVE</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="live-score">– : –</div><div class="minute" id="live-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label" id="live-odds-label">Visible probabilities</div><div class="odds-grid" id="live-odds"></div><div class="odds-note" id="live-odds-note"></div>
          <div class="section-label">Visible match stats</div><div class="stats-grid" id="live-stats"></div>
          <div class="section-label">Visible timeline · <span id="live-event-count">0</span></div><div class="timeline" id="live-events"><div class="empty">Start a replay.</div></div>
          <div class="section-label">Timeline-aware explanation</div><div class="explanation" id="live-explanation">Only visible information reaches the explanation layer.</div>
        </article>
        <article class="viewer">
          <div class="viewer-head"><h2>Personal timeline</h2><span class="badge" id="personal-badge">DELAYED</span></div>
          <div class="score-card"><div class="team">Northbridge</div><div><div class="score" id="personal-score">– : –</div><div class="minute" id="personal-minute">Waiting</div></div><div class="team">Southport</div></div>
          <div class="section-label" id="personal-odds-label">Visible probabilities</div><div class="odds-grid" id="personal-odds"></div><div class="odds-note" id="personal-odds-note"></div>
          <div class="section-label">Visible match stats</div><div class="stats-grid" id="personal-stats"></div>
          <div class="section-label">Visible timeline · <span id="personal-event-count">0</span></div><div class="timeline" id="personal-events"><div class="empty">Future events remain absent.</div></div>
          <div class="section-label">Timeline-aware explanation</div><div class="explanation" id="personal-explanation">The delayed viewer cannot retrieve future state.</div>
        </article>
      </div>
    </section>
  </main>
  <script>
    (function () {
      "use strict";
      var model = {
        fixture: null,
        live: null,
        personal: null,
        busy: false,
        demoEndpoint: "/api/demo/start",
        timelineFilter: "KEY"
      };
      var ids = [
        "start-demo", "start-curated", "cursor", "rewind-one", "advance-one", "pause", "resume", "catch-up",
        "reset", "error-banner", "source-status", "match-title", "match-meta", "replay-dock", "dock-context", "dock-score", "dock-latest",
        "live-badge", "live-score", "live-minute", "live-odds", "live-odds-label", "live-odds-note", "live-events",
        "live-explanation", "personal-badge", "personal-score", "personal-minute", "personal-odds", "personal-odds-label", "personal-odds-note",
        "personal-events", "personal-explanation", "cursor-readout", "timeline-filter", "event-count", "live-event-count", "personal-event-count",
        "live-stats", "personal-stats", "filter-key", "filter-highlights", "filter-full"
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
        [el.cursor, el["rewind-one"], el["advance-one"], el.pause, el.resume, el["catch-up"], el.reset]
          .forEach(function (control) { if (control) control.disabled = value || model.personal === null; });
        el["start-demo"].disabled = value;
        el["start-curated"].disabled = value;
      }
      function probabilityCard(label,value){return '<div class="odd"><span>'+escapeHtml(label)+'</span><strong>'+(Number.isFinite(value)?(value*100).toFixed(1)+"%":"—")+'</strong></div>';}
      function renderOdds(prefix,state){
        var target=el[prefix+"-odds"],label=el[prefix+"-odds-label"],note=el[prefix+"-odds-note"],p=state.impliedProbabilities;
        target.innerHTML=p?probabilityCard("Home",p.homeWin)+probabilityCard("Draw",p.draw)+probabilityCard("Away",p.awayWin):probabilityCard("Home",NaN)+probabilityCard("Draw",NaN)+probabilityCard("Away",NaN);
        var finalVisible=model.fixture&&model.fixture.demoKind==="CURATED"&&state.events.some(function(event){return event.eventType==="MATCH_FINAL";});
        label.textContent=finalVisible?"Last available market snapshot":"Visible probabilities";
        if(!p||!state.impliedProbabilitiesTimestamp||!model.fixture){note.textContent="No market snapshot is visible at this cursor.";return;}
        var snapshotMinute=minuteLabel((state.impliedProbabilitiesTimestamp-model.fixture.kickoffTimestamp)/60000);
        if(finalVisible){
          var result=state.score.home===state.score.away?"Draw confirmed":(state.score.home>state.score.away?model.fixture.homeLabel:model.fixture.awayLabel)+" won "+state.score.home+"–"+state.score.away;
          note.textContent="Snapshot at "+snapshotMinute+" · "+result+". Historical market snapshot, not a final prediction.";
        }else{
          note.textContent="Snapshot at "+snapshotMinute+" · latest market state visible at this cursor.";
        }
      }
      function statCard(label,home,away){return '<div class="stat"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(home)+"–"+escapeHtml(away)+'</strong></div>';}
      function renderStats(target,stats){if(!stats){target.innerHTML=statCard("Shots",0,0)+statCard("On target",0,0)+statCard("Corners",0,0)+statCard("Cards",0,0)+statCard("Subs",0,0);return;}target.innerHTML=statCard("Shots",stats.home.shots,stats.away.shots)+statCard("On target",stats.home.shotsOnTarget,stats.away.shotsOnTarget)+statCard("Corners",stats.home.corners,stats.away.corners)+statCard("YC / RC",stats.home.yellowCards+"/"+stats.home.redCards,stats.away.yellowCards+"/"+stats.away.redCards)+statCard("Subs",stats.home.substitutions,stats.away.substitutions);}
      function isHighlight(event){return event.importance==="KEY"||(event.eventType==="SHOT"&&event.outcome==="OnTarget")||event.eventType==="SUBSTITUTION"||event.eventType==="INJURY";}
      function filteredEvents(events){return (events||[]).filter(function(event){if(model.timelineFilter==="KEY")return event.importance==="KEY";if(model.timelineFilter==="HIGHLIGHTS")return isHighlight(event);return true;});}
      function updateFilterLabels(events){var all=events||[],key=all.filter(function(event){return event.importance==="KEY";}).length,highlights=all.filter(isHighlight).length;el["filter-key"].textContent="Key events · "+key;el["filter-highlights"].textContent="Highlights · "+highlights;el["filter-full"].textContent="Full timeline · "+all.length;}
      function renderEvents(target,events){
        var visible=filteredEvents(events);
        if(!visible.length){target.innerHTML='<div class="empty">No match event is visible at this cursor for this filter.</div>';return;}
        target.innerHTML=visible.map(function(event){
          var copy=event.eventType==="GOAL"?(event.team==="HOME"?model.fixture.homeLabel + " goal":model.fixture.awayLabel + " goal"):"Kickoff";
          copy=event.label||copy;
          var detail=event.detail?'<div class="event-detail">'+escapeHtml(event.detail)+'</div>':"";
          return '<div class="event '+String(event.importance||"STANDARD").toLowerCase()+'"><div class="event-time">'+escapeHtml(event.clockLabel||String(event.minute)+"′")+'</div><div class="event-copy">'+escapeHtml(copy)+detail+'</div><div class="event-tag">'+escapeHtml(event.category||event.eventType)+'</div></div>';
        }).join("");
      }
      function renderViewer(prefix,payload){
        var state=payload&&payload.state?payload.state:null,session=payload&&payload.session?payload.session:null;
        if(!state||!session)return;
        el[prefix+"-score"].textContent=state.score.home+" : "+state.score.away;
        var viewerTime=model.fixture?minuteLabel((session.visibilityCursor-model.fixture.kickoffTimestamp)/60000):String(state.session.viewerMinute).padStart(2,"0")+":00";
        el[prefix+"-minute"].textContent="Viewer time "+viewerTime;
        renderOdds(prefix,state);
        renderStats(el[prefix+"-stats"],state.statistics);
        renderEvents(el[prefix+"-events"],state.events);
        el[prefix+"-event-count"].textContent=filteredEvents(state.events).length+" shown / "+state.events.length+" visible";
        el[prefix+"-explanation"].textContent=state.latestExplanation||"No new visible event requires an explanation.";
        var badge=el[prefix+"-badge"];
        badge.textContent=state.safety.active?"SAFE HOLD":(prefix==="live"&&model.fixture&&model.fixture.demoKind==="CURATED"?"FINAL STATE":state.session.statusBadge);
      }
      function renderDock(){
        if(!model.fixture||!model.personal||!model.live)return;
        var personal=model.personal.state,live=model.live.state,last=personal.events.length?personal.events[personal.events.length-1]:null;
        el["dock-context"].textContent=(model.fixture.demoKind==="CURATED"?"Replay cursor":"Personal cursor")+" · "+model.fixture.homeLabel+" vs "+model.fixture.awayLabel;
        el["dock-score"].textContent=model.fixture.homeLabel+" "+personal.score.home+" : "+personal.score.away+" "+model.fixture.awayLabel+" · "+(model.fixture.demoKind==="CURATED"?"Final":"Live edge")+" "+live.score.home+" : "+live.score.away;
        el["dock-latest"].textContent="Latest visible event: "+(last?(last.label||last.eventType.replaceAll("_"," "))+" · "+(last.clockLabel||String(last.minute)+"′"):"none");
      }
      function render(){
        if(model.fixture){
          el["match-title"].textContent=model.fixture.homeLabel+" vs "+model.fixture.awayLabel;
          var partialCoverage=model.fixture.coverage&&model.fixture.coverage.scoreHistory === "PARTIAL_OPENING";
          var providerStartMinute=partialCoverage?minuteLabel((model.fixture.coverage.providerScoreStartTimestamp-model.fixture.kickoffTimestamp)/60000):"";
          el["match-meta"].textContent=model.fixture.demoKind==="CURATED"?(partialCoverage?"Authenticated TxLINE partial historical replay · local 0-0 kickoff baseline · provider score archive begins at "+providerStartMinute:"Authenticated TxLINE completed-match replay · two isolated server sessions"):model.fixture.provenance+" replay · two independent server sessions";
          var teams=document.querySelectorAll(".team");
          if(teams.length>=4){teams[0].textContent=model.fixture.homeLabel;teams[1].textContent=model.fixture.awayLabel;teams[2].textContent=model.fixture.homeLabel;teams[3].textContent=model.fixture.awayLabel;}
          var headings=document.querySelectorAll(".viewer-head h2");
          if(headings.length>=2){headings[0].textContent=model.fixture.demoKind==="CURATED"?"Completed edge":"Live edge";headings[1].textContent=model.fixture.demoKind==="CURATED"?"Replay from kickoff":"Personal timeline";}
        }
        renderViewer("live",model.live);
        renderViewer("personal",model.personal);
        updateFilterLabels(model.live&&model.live.state?model.live.state.events:[]);
        var total=model.personal&&model.personal.state?model.personal.state.events.length:0;
        el["event-count"].textContent=filteredEvents(model.personal&&model.personal.state?model.personal.state.events:[]).length+" shown / "+total+" visible";
        if(model.personal&&model.fixture){var cursorMinute=(model.personal.session.visibilityCursor-model.fixture.kickoffTimestamp)/60000;el.cursor.value=String(Math.max(0,Math.min(model.fixture.maxMinute,cursorMinute)));el["cursor-readout"].textContent=minuteLabel(cursorMinute);}
        renderDock();
      }
      function startDemo(endpoint){
        clearError();setBusy(true);
        api(endpoint,{method:"POST",body:"{}"}).then(function(payload){model.demoEndpoint=endpoint;model.fixture=payload.fixture;model.live=payload.live;model.personal=payload.personal;model.timelineFilter="KEY";el["timeline-filter"].value="KEY";el.cursor.max=String(payload.fixture.maxMinute);el["replay-dock"].style.display="block";render();}).catch(showError).finally(function(){setBusy(false);});
      }
      function patchPersonal(command){if(!model.personal)return Promise.resolve();clearError();setBusy(true);return api("/api/sessions/"+encodeURIComponent(model.personal.session.sessionId),{method:"PATCH",body:JSON.stringify(command)}).then(function(payload){model.personal=payload;render();}).catch(showError).finally(function(){setBusy(false);});}
      el["start-demo"].addEventListener("click",function(){startDemo("/api/demo/start");});
      el["start-curated"].addEventListener("click",function(){startDemo("/api/demo/curated/start");});
      el.cursor.addEventListener("input",function(){el["cursor-readout"].textContent=minuteLabel(Number(el.cursor.value));});
      el.cursor.addEventListener("change",function(){if(!model.fixture)return;var minute=Number(el.cursor.value);patchPersonal({type:"ADVANCE_TO",cursorMs:model.fixture.kickoffTimestamp+Math.round(minute*60000)});});
      el["timeline-filter"].addEventListener("change",function(){model.timelineFilter=el["timeline-filter"].value;render();});
      el["rewind-one"].addEventListener("click",function(){if(!model.personal||!model.fixture)return;patchPersonal({type:"ADVANCE_TO",cursorMs:Math.max(model.fixture.kickoffTimestamp,model.personal.session.visibilityCursor-60000)});});
      el["advance-one"].addEventListener("click",function(){if(!model.personal||!model.fixture)return;patchPersonal({type:"ADVANCE_TO",cursorMs:Math.min(model.fixture.liveEdgeTimestamp,model.personal.session.visibilityCursor+60000)});});
      el.pause.addEventListener("click",function(){patchPersonal({type:"PAUSE"});});
      el.resume.addEventListener("click",function(){patchPersonal({type:"RESUME"});});
      el["catch-up"].addEventListener("click",function(){patchPersonal({type:"CATCH_UP"});});
      el.reset.addEventListener("click",function(){startDemo(model.demoEndpoint);});
      renderOdds("live",{events:[]});renderOdds("personal",{events:[]});renderStats(el["live-stats"],null);renderStats(el["personal-stats"],null);setBusy(false);
      api("/api/data-source/status").then(function(status){el["source-status"].textContent=status.mode==="synthetic"?"Synthetic judge replay ready":"Optional "+status.mode+" backend";}).catch(function(){el["source-status"].textContent="Judge replay ready";});
      api("/api/demo/curated/status").then(function(status){if(!status.available)return;el["start-curated"].style.display="block";el["source-status"].textContent=status.fixture.coverage&&status.fixture.coverage.scoreHistory === "PARTIAL_OPENING"?"Synthetic judge demo + disclosed partial TxLINE replay ready":"Synthetic judge demo + curated TxLINE replay ready";}).catch(function(){el["start-curated"].style.display="none";});
    })();
  </script>
</body>
</html>`;
