export const PRODUCT_UPDATE_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MatchShift Product Update</title>
  <style>
    :root{color-scheme:dark;--b:#071018;--p:#101b26;--l:#263646;--t:#f6f8fa;--m:#9aabba;--a:#5ce1c2}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#12312f 0,transparent 38rem),var(--b);color:var(--t);font-family:Inter,system-ui,sans-serif;line-height:1.55}
    .w{width:min(1180px,calc(100% - 28px));margin:auto}header,footer{display:flex;justify-content:space-between;gap:18px;padding:22px 0;border-bottom:1px solid var(--l)}
    footer{border:0;border-top:1px solid var(--l);color:var(--m);font-size:12px}.brand{font-weight:900;font-size:21px}.muted{color:var(--m)}
    .hero{padding:70px 0 40px;display:grid;grid-template-columns:1fr 340px;gap:32px;align-items:end}.ey{color:var(--a);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em}
    h1{margin:10px 0;font-size:clamp(42px,6vw,72px);line-height:.97;letter-spacing:-.05em}.box,article,.metric,.node{border:1px solid var(--l);border-radius:18px;background:rgba(16,27,38,.93)}
    .box{padding:22px}.box a{display:inline-flex;margin-top:14px;padding:11px 14px;border-radius:10px;background:var(--a);color:#062019;text-decoration:none;font-weight:800}
    .note{margin:0 0 30px;padding:17px;border:1px solid #685a32;border-radius:14px;background:#201d13}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:30px 0 60px}
    .metric{padding:18px}.metric b{font-size:30px}.metric span{display:block;color:var(--m);font-size:12px}.story{display:grid;gap:24px}
    article{padding:22px}article h2{margin:6px 0}article p{color:#c5d0da}.shot{display:block;max-width:960px;margin:18px auto 0}.shot:focus-visible{outline:3px solid var(--a);outline-offset:4px;border-radius:12px}article img{display:block;width:100%;height:auto;border:1px solid #31505e;border-radius:12px;cursor:zoom-in}.zoom{max-width:960px;margin:10px auto 0;color:var(--m);font-size:12px}
    .times{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:55px 0}.times .box b{color:var(--a);font-size:22px}.arch{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:25px 0 55px}
    .node{padding:16px}.node b{display:block;margin-top:7px}.node p{font-size:12px;color:var(--m)}
    @media(max-width:800px){.hero{grid-template-columns:1fr}.metrics,.arch{grid-template-columns:1fr 1fr}}@media(max-width:520px){.metrics,.times,.arch{grid-template-columns:1fr}header,footer{flex-direction:column}}
  </style>
</head>
<body>
  <div class="w">
    <header><div class="brand">MatchShift</div><div class="muted">Consumer &amp; Fan Experiences by TxODDS · Product update</div></header>
    <main>
      <section class="hero">
        <div><div class="ey">Post-submission update · July 21, 2026</div><h1>Watch the match on your time — with no future knowledge.</h1><p class="muted">A richer Spain vs Argentina completed-match replay built from authenticated TxLINE data and protected by a server-side per-viewer cursor.</p></div>
        <aside class="box"><div class="ey">Quick review</div><h2>Four screens tell the story.</h2><p>Kickoff, independent cursor, the 106′ goal and full time.</p><a href="/">Open live app</a></aside>
      </section>
      <div class="note"><b>Transparency note.</b> The original submission already contained the working spoiler-safe core, authenticated TxLINE integration, public deployment and narrated demo video. This page documents later refinements in the same public repository.</div>
      <section class="metrics"><div class="metric"><b>206</b><span>sanitized events</span></div><div class="metric"><b>15</b><span>historical 1X2 snapshots</span></div><div class="metric"><b>2</b><span>isolated viewer sessions</span></div><div class="metric"><b>0</b><span>raw provider IDs exposed</span></div></section>
      <div class="ey">Product walkthrough</div><h2>From kickoff to full time</h2>
      <section class="story">
        <article><div><small>01</small><h2>Start from kickoff</h2><p>Match clock 0′ and replay elapsed 00:00 begin from the same spoiler-safe baseline.</p></div><a class="shot" href="/product-update/images/1.webp" target="_blank" rel="noopener noreferrer"><img src="/product-update/images/1.webp" alt="Start from kickoff"></a><p class="zoom">Open screenshot at full size ↗</p></article>
        <article><div><small>02</small><h2>Independent personal cursor</h2><p>At match clock 70′, the viewer receives only state already visible at that cursor.</p></div><a class="shot" href="/product-update/images/2.webp" target="_blank" rel="noopener noreferrer"><img src="/product-update/images/2.webp" alt="Independent personal cursor"></a><p class="zoom">Open screenshot at full size ↗</p></article>
        <article><div><small>03</small><h2>Goal revealed at 106′</h2><p>The 1–0 score, match clock 106′ and the Spain goal appear together.</p></div><a class="shot" href="/product-update/images/3.webp" target="_blank" rel="noopener noreferrer"><img src="/product-update/images/3.webp" alt="Goal revealed at 106 minutes"></a><p class="zoom">Open screenshot at full size ↗</p></article>
        <article><div><small>04</small><h2>Full time and server-side proof</h2><p>At FT, the completed timeline and the no-client-side-hiding boundary remain visible.</p></div><a class="shot" href="/product-update/images/4.webp" target="_blank" rel="noopener noreferrer"><img src="/product-update/images/4.webp" alt="Full time and server-side proof"></a><p class="zoom">Open screenshot at full size ↗</p></article>
      </section>
      <section class="times"><div class="box"><div class="ey">Football truth</div><b>Match clock</b><p>The latest visible football event: 70′, 106′, 120+4′ or FT.</p></div><div class="box"><div class="ey">Replay transport</div><b>Replay elapsed</b><p>Source-timeline distance including intervals, stoppages and timing gaps.</p></div></section>
      <div class="ey">Spoiler-safe architecture</div><h2>No client-side hiding</h2>
      <section class="arch"><div class="node"><small>01</small><b>Ingest</b><p>TxLINE or replay.</p></div><div class="node"><small>02</small><b>Normalize</b><p>Safe product records.</p></div><div class="node"><small>03</small><b>Buffer</b><p>Ordered timeline.</p></div><div class="node"><small>04</small><b>Gate</b><p>Per-viewer cursor.</p></div><div class="node"><small>05</small><b>Explain</b><p>Visible state only.</p></div></section>
      <section class="box"><div class="ey">Historical probability context</div><h2>Market snapshots remain historical — not invented.</h2><p>At full time, the last available odds remain timestamped and are not presented as a final prediction.</p></section>
    </main>
    <footer><span>MatchShift · Consumer &amp; Fan Experience track</span><span>Live data without future knowledge.</span></footer>
  </div>
</body>
</html>`;
