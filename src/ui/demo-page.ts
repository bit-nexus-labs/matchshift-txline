export const DEMO_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="MatchShift — a spoiler-safe personal match timeline powered by server-side visibility gates." />
  <title>MatchShift — Live data without future knowledge</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b10;
      --panel: rgba(16, 23, 32, 0.86);
      --panel-strong: #111923;
      --line: rgba(255, 255, 255, 0.09);
      --text: #f7f9fb;
      --muted: #96a3b2;
      --accent: #55e6c1;
      --accent-2: #f9bd4a;
      --danger: #ff6b7a;
      --live: #ff4d67;
      --safe: #63e6be;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 12%, rgba(85, 230, 193, 0.14), transparent 30rem),
        radial-gradient(circle at 85% 4%, rgba(249, 189, 74, 0.12), transparent 32rem),
        linear-gradient(160deg, #070b10 0%, #0a1017 50%, #06090d 100%);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button, input { font: inherit; }
    button { cursor: pointer; }

    .shell {
      width: min(1220px, calc(100% - 32px));
      margin: 0 auto;
      padding-bottom: 72px;
    }

    .topbar {
      min-height: 76px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
      letter-spacing: -0.03em;
      font-size: 20px;
    }

    .mark {
      width: 34px;
      height: 34px;
      border-radius: 11px;
      display: grid;
      place-items: center;
      color: #07110e;
      background: linear-gradient(135deg, var(--accent), #b4ffeb);
      box-shadow: 0 10px 36px rgba(85, 230, 193, 0.25);
      font-size: 17px;
    }

    .top-status {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--muted);
      font-size: 13px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--safe);
      box-shadow: 0 0 0 5px rgba(99, 230, 190, 0.08);
    }

    .hero {
      padding: 70px 0 38px;
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.65fr);
      gap: 42px;
      align-items: end;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 11px;
      border: 1px solid rgba(85, 230, 193, 0.26);
      border-radius: 999px;
      color: var(--accent);
      background: rgba(85, 230, 193, 0.06);
      font-size: 12px;
      font-weight: 750;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1 {
      margin: 22px 0 18px;
      max-width: 760px;
      font-size: clamp(42px, 7vw, 78px);
      line-height: 0.96;
      letter-spacing: -0.065em;
    }

    .hero-copy {
      max-width: 680px;
      color: #c4ccd6;
      font-size: clamp(17px, 2vw, 21px);
      line-height: 1.55;
    }

    .hero-card {
      padding: 24px;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: linear-gradient(145deg, rgba(22, 31, 42, 0.92), rgba(10, 15, 21, 0.92));
      box-shadow: var(--shadow);
    }

    .hero-card strong { display: block; margin-bottom: 9px; font-size: 15px; }
    .hero-card p { margin: 0 0 20px; color: var(--muted); line-height: 1.55; font-size: 14px; }

    .primary,
    .secondary,
    .quiet {
      border: 0;
      border-radius: 12px;
      min-height: 44px;
      padding: 0 17px;
      font-weight: 760;
      transition: transform 150ms ease, opacity 150ms ease, background 150ms ease;
    }

    .primary {
      width: 100%;
      color: #06110e;
      background: linear-gradient(135deg, var(--accent), #a8ffe7);
      box-shadow: 0 10px 30px rgba(85, 230, 193, 0.18);
    }

    .secondary {
      color: var(--text);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.045);
    }

    .quiet {
      min-height: 36px;
      padding: 0 12px;
      color: var(--muted);
      border: 1px solid var(--line);
      background: transparent;
      font-size: 12px;
    }

    button:hover { transform: translateY(-1px); }
    button:disabled { cursor: wait; opacity: 0.55; transform: none; }

    .proof-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin: 6px 0 28px;
    }

    .proof-item {
      border: 1px solid var(--line);
      border-radius: 15px;
      padding: 15px 16px;
      background: rgba(255, 255, 255, 0.025);
    }

    .proof-item span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
    .proof-item strong { display: block; margin-top: 7px; font-size: 14px; }

    .demo-frame {
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 28px;
      background: rgba(8, 13, 18, 0.78);
      box-shadow: var(--shadow);
    }

    .demo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      padding: 22px 24px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.018);
    }

    .match-title { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
    .match-meta { margin-top: 4px; color: var(--muted); font-size: 12px; }

    .shield {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--safe);
      font-size: 12px;
      font-weight: 750;
      padding: 8px 11px;
      border-radius: 999px;
      border: 1px solid rgba(99, 230, 190, 0.23);
      background: rgba(99, 230, 190, 0.07);
    }

    .compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }

    .viewer {
      min-width: 0;
      padding: 24px;
    }

    .viewer + .viewer { border-left: 1px solid var(--line); }

    .viewer-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 22px;
    }

    .viewer-kicker { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
    .viewer-heading h2 { margin: 6px 0 0; font-size: 22px; letter-spacing: -0.03em; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }

    .badge.live { color: #fff; background: rgba(255, 77, 103, 0.18); border: 1px solid rgba(255, 77, 103, 0.32); }
    .badge.personal { color: var(--accent); background: rgba(85, 230, 193, 0.08); border: 1px solid rgba(85, 230, 193, 0.24); }
    .badge.hold { color: var(--accent-2); background: rgba(249, 189, 74, 0.08); border: 1px solid rgba(249, 189, 74, 0.25); }

    .score-card {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 18px;
      padding: 22px;
      border-radius: 19px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));
      border: 1px solid var(--line);
    }

    .team { font-size: 13px; color: #d3dae3; }
    .team:last-child { text-align: right; }
    .score { font-variant-numeric: tabular-nums; font-size: 38px; font-weight: 850; letter-spacing: -0.06em; }
    .minute { margin-top: 9px; text-align: center; color: var(--muted); font-size: 12px; }

    .section-label {
      margin: 22px 0 11px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .odds-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .odd {
      min-width: 0;
      padding: 12px 10px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.025);
      text-align: center;
    }
    .odd span { display: block; color: var(--muted); font-size: 10px; }
    .odd strong { display: block; margin-top: 5px; font-size: 16px; font-variant-numeric: tabular-nums; }

    .timeline {
      min-height: 104px;
      display: grid;
      gap: 8px;
    }

    .event {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      padding: 11px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid var(--line);
    }
    .event-time { color: var(--accent); font-weight: 760; font-size: 12px; }
    .event-copy { color: #dce2e9; font-size: 13px; }
    .empty { color: var(--muted); font-size: 13px; padding: 18px 4px; }

    .explanation {
      min-height: 62px;
      padding: 13px 14px;
      border-radius: 13px;
      border: 1px solid rgba(85, 230, 193, 0.16);
      background: rgba(85, 230, 193, 0.045);
      color: #d8eee8;
      font-size: 13px;
      line-height: 1.5;
    }

    .controls {
      padding: 20px 24px 24px;
      border-top: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.018);
    }

    .control-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 13px;
    }

    .control-title { font-weight: 780; font-size: 14px; }
    .cursor-readout { color: var(--accent); font-size: 13px; font-variant-numeric: tabular-nums; }

    input[type="range"] {
      width: 100%;
      accent-color: var(--accent);
    }

    .control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 15px;
    }

    .boundary-note {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      align-items: start;
      margin-top: 18px;
      padding: 14px;
      border-radius: 14px;
      background: rgba(249, 189, 74, 0.045);
      border: 1px solid rgba(249, 189, 74, 0.16);
      color: #e5d8ba;
      font-size: 12px;
      line-height: 1.5;
    }

    .architecture {
      margin-top: 28px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
    }

    .node {
      position: relative;
      padding: 15px;
      min-height: 86px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.025);
    }
    .node span { display: block; color: var(--accent); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
    .node strong { display: block; margin-top: 8px; font-size: 13px; line-height: 1.35; }
    .node:not(:last-child)::after {
      content: "→";
      position: absolute;
      right: -17px;
      top: 32px;
      color: #576270;
      z-index: 2;
    }

    .error-banner {
      display: none;
      margin-bottom: 14px;
      padding: 12px 14px;
      border-radius: 12px;
      color: #ffd7dc;
      border: 1px solid rgba(255, 107, 122, 0.28);
      background: rgba(255, 107, 122, 0.08);
      font-size: 13px;
    }
    .error-banner.visible { display: block; }

    .loading .demo-frame { opacity: 0.72; }

    footer {
      padding-top: 34px;
      color: var(--muted);
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
    }

    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; padding-top: 46px; }
      .proof-strip { grid-template-columns: 1fr; }
      .compare-grid { grid-template-columns: 1fr; }
      .viewer + .viewer { border-left: 0; border-top: 1px solid var(--line); }
      .architecture { grid-template-columns: 1fr 1fr; }
      .node::after { display: none; }
    }

    @media (max-width: 560px) {
      .shell { width: min(100% - 20px, 1220px); }
      .top-status { display: none; }
      .hero { padding-top: 38px; }
      .demo-header, .viewer, .controls { padding-left: 16px; padding-right: 16px; }
      .demo-header { align-items: flex-start; flex-direction: column; }
      .architecture { grid-template-columns: 1fr; }
      footer { flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell" id="app">
    <header class="topbar">
      <div class="brand"><span class="mark">M</span> MatchShift</div>
      <div class="top-status"><span class="status-dot"></span><span id="source-status">Synthetic replay ready</span></div>
    </header>

    <section class="hero">
      <div>
        <span class="eyebrow">Spoiler-safe by architecture</span>
        <h1>Watch on your time.<br />Not the internet’s.</h1>
        <p class="hero-copy">One live match. Two viewers. Each person receives only the score, events and market context that existed at their own viewing minute.</p>
      </div>
      <aside class="hero-card">
        <strong>60-second judge demo</strong>
        <p>Start two isolated server-side sessions: one at the live edge and one six minutes behind. Then move the personal cursor and watch information unlock in order.</p>
        <button class="primary" id="start-demo">Start spoiler-safe demo</button>
      </aside>
    </section>

    <section class="proof-strip" aria-label="Demo guarantees">
      <div class="proof-item"><span>Judge access</span><strong>No login · no wallet · no payment</strong></div>
      <div class="proof-item"><span>Data path</span><strong>Deterministic synthetic replay</strong></div>
      <div class="proof-item"><span>Isolation</span><strong>Server-side cursor gate</strong></div>
    </section>

    <div class="error-banner" id="error-banner" role="alert"></div>

    <section class="demo-frame" id="demo-frame" aria-live="polite">
      <header class="demo-header">
        <div>
          <div class="match-title" id="match-title">Northbridge vs Southport</div>
          <div class="match-meta" id="match-meta">Synthetic replay · press Start to create isolated sessions</div>
        </div>
        <div class="shield">◆ Spoiler shield active</div>
      </header>

      <div class="compare-grid">
        <article class="viewer">
          <div class="viewer-heading">
            <div><div class="viewer-kicker">Viewer A</div><h2>Live edge</h2></div>
            <span class="badge live" id="live-badge">● LIVE</span>
          </div>
          <div class="score-card">
            <div class="team">Northbridge</div>
            <div><div class="score" id="live-score">– : –</div><div class="minute" id="live-minute">Waiting</div></div>
            <div class="team">Southport</div>
          </div>
          <div class="section-label"><span>Visible probabilities</span><span id="live-odds-time">—</span></div>
          <div class="odds-grid" id="live-odds"></div>
          <div class="section-label"><span>Visible timeline</span></div>
          <div class="timeline" id="live-events"><div class="empty">Start the demo to load the live viewer.</div></div>
          <div class="section-label"><span>Timeline-aware explanation</span></div>
          <div class="explanation" id="live-explanation">Only information visible at this viewer’s cursor is passed to the explanation layer.</div>
        </article>

        <article class="viewer">
          <div class="viewer-heading">
            <div><div class="viewer-kicker">Viewer B</div><h2>Personal timeline</h2></div>
            <span class="badge personal" id="personal-badge">DELAYED</span>
          </div>
          <div class="score-card">
            <div class="team">Northbridge</div>
            <div><div class="score" id="personal-score">– : –</div><div class="minute" id="personal-minute">Waiting</div></div>
            <div class="team">Southport</div>
          </div>
          <div class="section-label"><span>Visible probabilities</span><span id="personal-odds-time">—</span></div>
          <div class="odds-grid" id="personal-odds"></div>
          <div class="section-label"><span>Visible timeline</span></div>
          <div class="timeline" id="personal-events"><div class="empty">Future events stay absent from this response.</div></div>
          <div class="section-label"><span>Timeline-aware explanation</span></div>
          <div class="explanation" id="personal-explanation">The delayed viewer cannot retrieve the live viewer’s future score, goal or odds.</div>
        </article>
      </div>

      <div class="controls">
        <div class="control-top">
          <div class="control-title">Personal viewing cursor</div>
          <div class="cursor-readout" id="cursor-readout">43:00</div>
        </div>
        <input id="cursor" type="range" min="0" max="52" step="0.1666667" value="43" disabled aria-label="Personal viewing minute" />
        <div class="control-row">
          <button class="secondary" id="advance-one" disabled>+1 minute</button>
          <button class="secondary" id="pause" disabled>Pause</button>
          <button class="secondary" id="resume" disabled>Resume</button>
          <button class="secondary" id="catch-up" disabled>Catch up to live</button>
          <button class="quiet" id="reset">Reset demo</button>
        </div>
        <div class="boundary-note">
          <span>◆</span>
          <div><strong>No client-side hiding.</strong> Every state shown above is rebuilt on the server from records at or before that session’s effective cursor. Future records are omitted from the API response itself.</div>
        </div>
      </div>
    </section>

    <section class="architecture" aria-label="Architecture">
      <div class="node"><span>01 · ingest</span><strong>TxLINE or deterministic replay</strong></div>
      <div class="node"><span>02 · normalize</span><strong>Score and odds records</strong></div>
      <div class="node"><span>03 · buffer</span><strong>Append-only source timeline</strong></div>
      <div class="node"><span>04 · gate</span><strong>Per-session visibility cursor</strong></div>
      <div class="node"><span>05 · explain</span><strong>Visible state only</strong></div>
    </section>

    <footer>
      <span>MatchShift · Consumer & Fan Experience track</span>
      <span>Live data without future knowledge.</span>
    </footer>
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

      var ids = [
        "start-demo", "cursor", "advance-one", "pause", "resume", "catch-up",
        "reset", "error-banner", "source-status", "match-title", "match-meta",
        "live-badge", "live-score", "live-minute", "live-odds", "live-events",
        "live-explanation", "personal-badge", "personal-score", "personal-minute",
        "personal-odds", "personal-events", "personal-explanation", "cursor-readout"
      ];
      var el = {};
      ids.forEach(function (id) { el[id] = document.getElementById(id); });

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function api(url, options) {
        var init = options || {};
        init.headers = Object.assign({ "Content-Type": "application/json" }, init.headers || {});
        return fetch(url, init).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok) {
              throw new Error(body.error || "Request failed with status " + response.status);
            }
            return body;
          });
        });
      }

      function setBusy(value) {
        model.busy = value;
        document.body.classList.toggle("loading", value);
        [el["start-demo"], el.cursor, el["advance-one"], el.pause, el.resume, el["catch-up"]]
          .forEach(function (button) {
            if (button) button.disabled = value || model.personal === null;
          });
        el["start-demo"].disabled = value;
      }

      function showError(error) {
        el["error-banner"].textContent = error instanceof Error ? error.message : String(error);
        el["error-banner"].classList.add("visible");
      }

      function clearError() {
        el["error-banner"].textContent = "";
        el["error-banner"].classList.remove("visible");
      }

      function minuteLabel(value) {
        var whole = Math.floor(value);
        var seconds = Math.round((value - whole) * 60);
        if (seconds === 60) { whole += 1; seconds = 0; }
        return String(whole).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }

      function probabilityCard(label, value) {
        var safe = Number.isFinite(value) ? Math.round(value * 100) + "%" : "—";
        return '<div class="odd"><span>' + escapeHtml(label) + '</span><strong>' + safe + '</strong></div>';
      }

      function renderOdds(target, probabilities) {
        if (!probabilities) {
          target.innerHTML = probabilityCard("Home", NaN) + probabilityCard("Draw", NaN) + probabilityCard("Away", NaN);
          return;
        }
        target.innerHTML =
          probabilityCard("Home", probabilities.homeWin) +
          probabilityCard("Draw", probabilities.draw) +
          probabilityCard("Away", probabilities.awayWin);
      }

      function renderEvents(target, events) {
        if (!events || events.length === 0) {
          target.innerHTML = '<div class="empty">No match event is visible at this cursor yet.</div>';
          return;
        }
        target.innerHTML = events.map(function (event) {
          var copy = event.eventType === "GOAL"
            ? (event.team === "HOME" ? "Northbridge goal" : "Southport goal")
            : "Kickoff";
          return '<div class="event"><div class="event-time">' + escapeHtml(event.minute) + "′</div><div class=\"event-copy\">" + escapeHtml(copy) + "</div></div>";
        }).join("");
      }

      function renderViewer(prefix, payload) {
        var state = payload && payload.state ? payload.state : null;
        var session = payload && payload.session ? payload.session : null;
        if (!state || !session) return;

        el[prefix + "-score"].textContent = state.score.home + " : " + state.score.away;
        el[prefix + "-minute"].textContent = "Viewer minute " + state.session.viewerMinute;
        renderOdds(el[prefix + "-odds"], state.impliedProbabilities);
        renderEvents(el[prefix + "-events"], state.events);
        el[prefix + "-explanation"].textContent = state.latestExplanation ||
          (state.safety.active
            ? "Information is held until a trusted sequence baseline is restored."
            : "No new visible event requires an explanation at this cursor.");

        var badge = el[prefix + "-badge"];
        badge.textContent = state.safety.active ? "SAFE HOLD" : state.session.statusBadge;
        badge.className = "badge " + (state.safety.active ? "hold" : prefix === "live" ? "live" : "personal");
      }

      function render() {
        if (model.fixture) {
          el["match-title"].textContent = "Northbridge vs Southport";
          el["match-meta"].textContent = model.fixture.provenance + " replay · two independent server sessions";
        }
        renderViewer("live", model.live);
        renderViewer("personal", model.personal);

        if (model.personal && model.fixture) {
          var cursorMinute = (model.personal.session.visibilityCursor - model.fixture.kickoffTimestamp) / 60000;
          el.cursor.value = String(Math.max(0, Math.min(model.fixture.maxMinute, cursorMinute)));
          el["cursor-readout"].textContent = minuteLabel(cursorMinute);
        }
      }

      function startDemo() {
        clearError();
        setBusy(true);
        api("/api/demo/start", { method: "POST", body: "{}" })
          .then(function (payload) {
            model.fixture = payload.fixture;
            model.live = payload.live;
            model.personal = payload.personal;
            el.cursor.max = String(payload.fixture.maxMinute);
            render();
          })
          .catch(showError)
          .finally(function () { setBusy(false); });
      }

      function patchPersonal(command) {
        if (!model.personal) return Promise.resolve();
        clearError();
        setBusy(true);
        return api("/api/sessions/" + encodeURIComponent(model.personal.session.sessionId), {
          method: "PATCH",
          body: JSON.stringify(command)
        })
          .then(function (payload) {
            model.personal = payload;
            render();
          })
          .catch(showError)
          .finally(function () { setBusy(false); });
      }

      function setCursorFromSlider() {
        if (!model.fixture) return;
        var minute = Number(el.cursor.value);
        el["cursor-readout"].textContent = minuteLabel(minute);
        patchPersonal({
          type: "ADVANCE_TO",
          cursorMs: model.fixture.kickoffTimestamp + Math.round(minute * 60000)
        });
      }

      el["start-demo"].addEventListener("click", startDemo);
      el.cursor.addEventListener("input", function () {
        el["cursor-readout"].textContent = minuteLabel(Number(el.cursor.value));
      });
      el.cursor.addEventListener("change", setCursorFromSlider);
      el["advance-one"].addEventListener("click", function () {
        if (!model.personal || !model.fixture) return;
        var next = Math.min(
          model.fixture.liveEdgeTimestamp,
          model.personal.session.visibilityCursor + 60000
        );
        patchPersonal({ type: "ADVANCE_TO", cursorMs: next });
      });
      el.pause.addEventListener("click", function () { patchPersonal({ type: "PAUSE" }); });
      el.resume.addEventListener("click", function () { patchPersonal({ type: "RESUME" }); });
      el["catch-up"].addEventListener("click", function () { patchPersonal({ type: "CATCH_UP" }); });
      el.reset.addEventListener("click", startDemo);

      renderOdds(el["live-odds"], null);
      renderOdds(el["personal-odds"], null);
      api("/api/data-source/status")
        .then(function (status) {
          el["source-status"].textContent = status.mode === "synthetic"
            ? "Synthetic judge replay ready"
            : "Optional " + status.mode + " backend · judge replay remains synthetic";
        })
        .catch(function () {
          el["source-status"].textContent = "Judge replay ready";
        });
    })();
  </script>
</body>
</html>`;
