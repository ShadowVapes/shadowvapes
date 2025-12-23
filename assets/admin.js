<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Admin • ShadowVapes</title>
  <link rel="stylesheet" href="assets/style.css" />
  <style>
    .adminWrap{margin-top:16px;display:grid;grid-template-columns:280px 1fr;gap:16px}
    .panel{border:1px solid var(--border);border-radius:16px;background:rgba(17,24,39,.55);padding:14px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
    .full{grid-column:1 / -1}
    label{font-size:12px;color:var(--muted);display:block;margin-bottom:6px}
    input,select,textarea{
      width:100%;padding:10px 10px;border-radius:12px;border:1px solid var(--border);
      background:rgba(0,0,0,.25);color:var(--text);outline:none;
    }
    textarea{min-height:90px;resize:vertical}
    .btn{
      border:1px solid var(--border);background:rgba(255,255,255,.05);
      padding:10px 12px;border-radius:12px;cursor:pointer;font-weight:800;
    }
    .btn:hover{background:rgba(255,255,255,.08)}
    .btn.primary{border-color:rgba(124,58,237,.55);background:rgba(124,58,237,.18)}
    .btn.danger{border-color:rgba(239,68,68,.55);background:rgba(239,68,68,.12)}
    .btn.ok{border-color:rgba(34,197,94,.55);background:rgba(34,197,94,.12)}
    .tabs{display:flex;gap:10px;flex-wrap:wrap}
    .small{font-size:12px;color:var(--muted)}
    .list{display:flex;flex-direction:column;gap:10px}
    .item{
      border:1px solid var(--border);border-radius:14px;padding:10px;background:rgba(0,0,0,.18)
    }
    .itemTop{display:flex;justify-content:space-between;gap:10px;align-items:center}
    .itemTitle{font-weight:900}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid var(--border);padding:8px;text-align:left;font-size:13px}
    canvas{width:100% !important;max-height:300px}
  </style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <div class="brand"><span id="shopName">ShadowVapes</span> <span style="color:var(--muted);font-weight:700">Admin</span></div>
      <div class="pillrow">
        <button id="saveBtn" class="btn primary">Mentés</button>
      </div>
    </div>

    <div class="adminWrap">
      <aside class="panel">
        <div class="tabs">
          <button class="btn" data-view="products">Termékek</button>
          <button class="btn" data-view="categories">Kategóriák</button>
          <button class="btn" data-view="sales">Eladás rögzítése</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
        <div class="small">GitHub mentés beállítás (csak nálad marad)</div>
        <div style="margin-top:10px">
          <label>Repo tulaj (username)</label>
          <input id="ghOwner" placeholder="pl. AdriVaok55" />
        </div>
        <div style="margin-top:10px">
          <label>Repo név</label>
          <input id="ghRepo" placeholder="pl. shadowvapes" />
        </div>
        <div style="margin-top:10px">
          <label>Branch</label>
          <input id="ghBranch" placeholder="main" />
        </div>
        <div style="margin-top:10px">
          <label>Token (Fine-grained PAT)</label>
          <input id="ghToken" placeholder="github_pat_..." />
        </div>
        <div class="small" style="margin-top:10px">Kell: Contents → Read & Write (arra a repóra).</div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button id="testBtn" class="btn ok" style="flex:1">Kapcsolat teszt</button>
          <button id="forgetBtn" class="btn danger">Törlés</button>
        </div>
        <div id="status" class="small" style="margin-top:10px"></div>
      </aside>

      <main class="panel">
        <div id="view-products" class="view"></div>
        <div id="view-categories" class="view" style="display:none"></div>
        <div id="view-sales" class="view" style="display:none"></div>
      </main>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="assets/admin.js"></script>
</body>
</html>
