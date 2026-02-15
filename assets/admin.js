(() => {
  const $ = (s) => document.querySelector(s);

  const LS = {
    owner: "sv_owner",
    repo: "sv_repo",
    branch: "sv_branch",
    token: "sv_token",
  };

  const state = {
    doc: { categories: [], products: [] },
    sales: [],
    reservations: [],
    dirtyReservations: false,
    loaded: false,
    saving: false,
    saveQueued: false,
    dirty: false,
    dirtyProducts: false,
    dirtySales: false,
    saveTimer: null,
    shas: { products: null, sales: null, reservations: null },
    // hogy a public oldal biztosan megtalálja a RAW forrást (telefonon is)
    forceSourceSync: false,
    clientId: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
    filters: {
      productsCat: "all",
      salesCat: "all",
      salesMode: "pos",
      chartCat: "all",
      productsSearch: "",
      salesSearch: ""
    }
  };

  /* ---------- UI helpers ---------- */
  function setSaveStatus(type, text){
    const dot = $("#saveDot");
    dot.classList.remove("ok","busy","bad");
    dot.classList.add(type);
    $("#saveText").textContent = text;
  }

  function openModal(title, sub, bodyEl, actions){
    $("#modalTitle").textContent = title;
    $("#modalSub").textContent = sub || "";
    const body = $("#modalBody");
    body.innerHTML = "";
    body.appendChild(bodyEl);

    const act = $("#modalActions");
    act.innerHTML = "";
    actions.forEach(a => {
      const b = document.createElement("button");
      b.textContent = a.label;
      b.className = a.kind === "primary" ? "primary" : (a.kind === "danger" ? "danger" : "ghost");
      b.onclick = a.onClick;
      act.appendChild(b);
    });

    $("#modalBg").style.display = "flex";
  }
  function closeModal(){
    $("#modalBg").style.display = "none";
  }

  function todayISO(){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  }

  /* ---------- Cross-tab save lock (ugyanazon böngészőben) ---------- */
  const LOCK_KEY = "sv_save_lock";
  function readLock(){
    try{ return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); }catch{ return null; }
  }
  function lockValid(lock){
    return !!(lock && lock.id && (Date.now() - Number(lock.ts || 0)) < 15000);
  }
  function acquireLock(){
    try{
      const cur = readLock();
      if(lockValid(cur) && cur.id !== state.clientId) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify({ id: state.clientId, ts: Date.now() }));
      return true;
    }catch{
      // ha a localStorage valamiért tiltott/tele van, inkább mentsünk, mint hogy szétálljon az admin
      return true;
    }
  }
  function releaseLock(){
    try{
      const cur = readLock();
      if(cur && cur.id === state.clientId) localStorage.removeItem(LOCK_KEY);
    }catch{}
  }
  // ha crash/bezárás: engedjük el
  window.addEventListener("beforeunload", releaseLock);


  /* ---------- Settings ---------- */
  function getCfg(){
    return {
      owner: ($("#cfgOwner")?.value || "").trim(),
      repo: ($("#cfgRepo")?.value || "").trim(),
      branch: ($("#cfgBranch")?.value || "main").trim() || "main",
      token: ($("#cfgToken")?.value || "").trim()
    };
  }
  function loadCfg(){
    const owner = localStorage.getItem(LS.owner) || "";
    const repo = localStorage.getItem(LS.repo) || "";
    const branch = localStorage.getItem(LS.branch) || "main";
    const token = localStorage.getItem(LS.token) || "";

    return { owner, repo, branch, token };
  }
  function saveCfg(cfg){
    localStorage.setItem(LS.owner, cfg.owner);
    localStorage.setItem(LS.repo, cfg.repo);
    localStorage.setItem(LS.branch, cfg.branch);
    localStorage.setItem(LS.token, cfg.token);
  }

  /* ---------- Data logic ---------- */
  function normalizeDoc(){
    if(Array.isArray(state.doc)) state.doc = { categories: [], products: state.doc };
    if(!state.doc || typeof state.doc !== "object") state.doc = { categories: [], products: [] };
    if(!Array.isArray(state.doc.categories)) state.doc.categories = [];
    if(!Array.isArray(state.doc.products)) state.doc.products = [];
    if(!Array.isArray(state.doc.popups)) state.doc.popups = [];
    if(!Array.isArray(state.sales)) state.sales = [];
    if(!Array.isArray(state.reservations)) state.reservations = [];

    state.doc.categories = state.doc.categories
      .filter(c => c && c.id)
      .map(c => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id,
        basePrice: Number(c.basePrice || 0),
        featuredEnabled: (c.featuredEnabled === false) ? false : true
      }));

    state.doc.products = state.doc.products.map(p => ({
      id: String(p.id || ""),
      categoryId: String(p.categoryId || ""),
      status: (p.status === "ok" || p.status === "out" || p.status === "soon") ? p.status : "ok",
      stock: Math.max(0, Number(p.stock || 0)),
      visible: (p.visible === false) ? false : true,
      // price lehet null/üres => kategória alapár
      price: (p.price === "" || p.price === null || p.price === undefined) ? null : Number(p.price || 0),
      image: p.image || "",
      name_hu: p.name_hu || "",
      name_en: p.name_en || "",
      flavor_hu: p.flavor_hu || "",
      flavor_en: p.flavor_en || "",
      // ✅ Csak hónap formátum: YYYY-MM
      soonEta: String(p.soonEta || p.eta || "").replace(/^(\d{4}-\d{2}).*$/, "$1")
    })).filter(p => p.id);

    // Popups normalize
    state.doc.popups = (state.doc.popups || []).map(pp => ({
      id: String(pp.id || ""),
      enabled: (pp.enabled === false) ? false : true,
      // rev: ha változik, a "ne mutasd többször" újra feloldódik
      rev: Number(pp.rev || pp.updatedAt || pp.createdAt || 0) || 0,
      title_hu: pp.title_hu || "Új termékek elérhetőek",
      title_en: pp.title_en || "New products available",
      categoryIds: Array.isArray(pp.categoryIds) ? pp.categoryIds.map(x=>String(x)) : [],
      productIds: Array.isArray(pp.productIds) ? pp.productIds.map(x=>String(x)) : [],
      createdAt: Number(pp.createdAt || 0) || 0,
      updatedAt: Number(pp.updatedAt || 0) || 0
    })).filter(pp => pp.id);

    // Sales normalize (kompatibilis a régi formátummal is)
state.sales = state.sales.map(s => {
  const legacyPid = s.productId || s.pid || s.product || "";
  const legacyQty = s.qty || s.quantity || 1;
  const legacyPrice = s.unitPrice || s.price || s.amount || 0;

  const items = Array.isArray(s.items)
    ? s.items.map(it => ({
        productId: String(it.productId || it.pid || ""),
        qty: Math.max(1, Number.parseFloat(it.qty || it.quantity || 1) || 1),
        unitPrice: Math.max(0, Number.parseFloat(it.unitPrice || it.price || 0) || 0)
      })).filter(it => it.productId)
    : (legacyPid ? [{
        productId: String(legacyPid),
        qty: Math.max(1, Number.parseFloat(legacyQty) || 1),
        unitPrice: Math.max(0, Number.parseFloat(legacyPrice) || 0)
      }] : []);

  return {
    id: String(s.id || ""),
    date: String(s.date || s.day || s.createdAt || ""),
    name: s.name || "",
    payment: s.payment || s.method || "",
    items
  };
}).filter(s => s.id);

// reservations normalize + expiry
state.reservations = state.reservations.map(r => {
  const items = Array.isArray(r.items) ? r.items.map(it => ({
    productId: String(it.productId || ""),
    qty: Math.max(1, Number.parseFloat(it.qty || 0) || 0),
    price: Math.max(0, Number.parseFloat(it.price || it.unitPrice || 0) || 0),
    name: String(it.name || ""),
    flavor: String(it.flavor || ""),
    image: String(it.image || "")
  })).filter(it => it.productId && it.qty>0) : [];
  const status = String(r.status || "active");
  const exp = r.expiresAt ? Date.parse(r.expiresAt) : 0;
  const now = Date.now();
  const finalStatus = (status==="active" && exp && exp <= now) ? "expired" : status;
  return {
    id: String(r.id || ""),
    publicCode: String(r.publicCode || ""),
    createdAt: r.createdAt || null,
    expiresAt: r.expiresAt || null,
    status: finalStatus,
    modified: !!r.modified,
    modifiedAck: !!r.modifiedAck,
    replacedBy: r.replacedBy ? String(r.replacedBy) : null,
    previousId: r.previousId ? String(r.previousId) : null,
    items
  };
}).filter(r => r.id);
  }

  function catById(id){
    return state.doc.categories.find(c => c.id === String(id)) || null;
  }
  function prodById(id){
    return state.doc.products.find(p => p.id === String(id)) || null;
  }

  function effectivePrice(p){
    if(p.price !== null && p.price !== undefined && Number.isFinite(Number(p.price)) && Number(p.price) > 0){
      return Number(p.price);
    }
    const c = catById(p.categoryId);
    const bp = c ? Number(c.basePrice || 0) : 0;
    return Number.isFinite(bp) ? bp : 0;
  }

  function saleTotals(sale, catFilterId){
    // catFilterId: "all" or category id -> csak az adott kategória tételeit számoljuk
    let revenue = 0;
    let qty = 0;
    let hit = false;

    for(const it of sale.items){
      const p = prodById(it.productId);
      if(!p) continue;
      if(catFilterId !== "all" && p.categoryId !== catFilterId) continue;
      hit = true;
      revenue += Number(it.unitPrice || 0) * Number(it.qty || 0);
      qty += Number(it.qty || 0);
    }

    return { revenue, qty, hit };
  }

  /* ---------- GitHub load/save ---------- */
  async function tryLoadFromGithub(cfg){
    // branch fallback main/master automatikusan, ha "No commit found for the ref ..."
    const branchesToTry = [cfg.branch, "main", "master"].filter((v,i,a)=> v && a.indexOf(v)===i);

    let lastErr = null;
    for(const br of branchesToTry){
      try{
        const p = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/products.json" });
        // sales.json lehet, hogy még nincs a repo-ban → ilyenkor induljunk üres eladásokkal
        let s = null;
        let sales = [];
        try{
          s = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/sales.json" });
          sales = JSON.parse(s.content || "[]");
        }catch(e){
          if(Number(e?.status || 0) === 404){
            s = { sha: null };
            sales = [];
          }else{
            throw e;
          }
        }

        const doc = JSON.parse(p.content);

        cfg.branch = br;
        saveCfg(cfg);

        state.doc = doc;
        state.sales = sales;
        // reservations.json lehet hogy még nincs
        let rr = null;
        let reservations = [];
        try{
          rr = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/reservations.json" });
          reservations = JSON.parse(rr.content || "[]");
        }catch(e){
          if(Number(e?.status || 0) === 404){
            rr = { sha: null };
            reservations = [];
          }else{ throw e; }
        }

        state.reservations = reservations;
        state.shas.reservations = rr ? (rr.sha || null) : null;

        state.shas.products = p.sha;
        state.shas.sales = s ? (s.sha || null) : null;
        normalizeDoc();
        state.loaded = true;
        state.forceSourceSync = true;

        return { ok:true };
      }catch(e){
        lastErr = e;
      }
    }
    return { ok:false, err:lastErr };
  }

  async function loadData(){
    const cfg = getCfg();
    saveCfg(cfg);

    if(!cfg.owner || !cfg.repo || !cfg.token){
      setSaveStatus("bad","Hiányzó GH beállítás");
      return;
    }

    setSaveStatus("busy","Betöltés...");
    const r = await tryLoadFromGithub(cfg);
    if(!r.ok){
      setSaveStatus("bad","Betöltés hiba");
      return;
    }

    setSaveStatus("ok","Kész");
    renderAll();
  }

  async function saveDataNow(){
    if(!state.loaded) return;

    // ✅ MENTÉS GYORSÍTÁS: Csak akkor mentünk, ha tényleges változás van
    if (!state.dirtyProducts && !state.dirtySales && !state.dirtyReservations) {
      setSaveStatus("ok","Nincs változás");
      return;
    }

    // Ne fusson párhuzamos mentés (különben SHA mismatch)
    if(state.saving){
      state.saveQueued = true;
      state.dirty = true;
      setSaveStatus("busy","Mentés sorban…");
      return;
    }

    const cfg = getCfg();
    saveCfg(cfg);
    if(!cfg.owner || !cfg.repo || !cfg.token){
      setSaveStatus("bad","Hiányzó GH beállítás");
      return;
    }

    // ugyanazon böngészőben: csak 1 admin tab mentsen
    if(!acquireLock()){
      state.saveQueued = true;
      state.dirty = true;
      setSaveStatus("busy","Másik admin tab ment…");
      setTimeout(() => saveDataNow(), 1200 + Math.random()*400);
      return;
    }

    state.saving = true;
    state.saveQueued = false;
    state.dirty = false;
    setSaveStatus("busy","Mentés...");

    // biztos rend
    normalizeDoc();

    for(const p of (state.doc.products||[])){
      if(p && p.status === "out") p.stock = 0;
      if(p && (!p.name_en || String(p.name_en).trim()==="")) p.name_en = p.name_hu || "";
    }
    // _meta.rev: public old cache ne tudja felülírni a friss mentést
    if(state.dirtyProducts){
      state.doc._meta = {
        ...(state.doc._meta || {}),
        rev: Date.now(),
        updatedAt: new Date().toISOString(),
      };
    }

    const productsText = JSON.stringify(state.doc, null, 2);
    const salesText = JSON.stringify(state.sales, null, 2);
    const reservationsText = JSON.stringify(state.reservations, null, 2);

    
let ok = false;
const wantProducts = !!state.dirtyProducts;
const wantSales = !!state.dirtySales;
const wantReservations = !!state.dirtyReservations;

try{
  // SHA csak akkor kell, ha még nincs meg (a putFileSafe úgyis frissít konflikt esetén)
  if(wantProducts && !state.shas.products){
    const pOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/products.json" });
    state.shas.products = pOld.sha;
  }
  if(wantSales && !state.shas.sales){
    try{
      const sOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/sales.json" });
      state.shas.sales = sOld.sha;
    }catch(e){
      // ha még nem létezik, mentés sha nélkül fogja létrehozni
      if(Number(e?.status || 0) === 404) state.shas.sales = null;
      else throw e;
    }
  }

  if(wantReservations && !state.shas.reservations){
    try{
      const rOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/reservations.json" });
      state.shas.reservations = rOld.sha;
    }catch(e){
      if(Number(e?.status || 0) === 404) state.shas.reservations = null;
      else throw e;
    }
  }

  const tasks = [];

  if(wantProducts){
    tasks.push(
      ShadowGH.putFileSafe({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
        path: "data/products.json",
        message: "Update products.json",
        content: productsText,
        sha: state.shas.products
      }).then((pRes) => {
        state.shas.products = pRes?.content?.sha || state.shas.products;
      })
    );
  }

  if(wantSales){
    tasks.push(
      ShadowGH.putFileSafe({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
        path: "data/sales.json",
        message: "Update sales.json",
        content: salesText,
        sha: state.shas.sales
      }).then((sRes) => {
        state.shas.sales = sRes?.content?.sha || state.shas.sales;
      })
    );
  }



  if(wantReservations){
    tasks.push(
      ShadowGH.putFileSafe({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
        path: "data/reservations.json",
        message: "Update reservations.json",
        content: reservationsText,
        sha: state.shas.reservations
      }).then((rRes) => {
        state.shas.reservations = rRes?.content?.sha || state.shas.reservations;
      })
    );
  }


  // ✅ sv_source.json (custom domain + telefon): a public oldal ebből találja meg a RAW forrást
  try{
    const srcObj = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch };
    const srcText = JSON.stringify(srcObj, null, 2);
    const prev = localStorage.getItem("sv_source_json") || "";
    if(state.forceSourceSync || prev !== srcText){
      state.forceSourceSync = false;
      try{ localStorage.setItem("sv_source_json", srcText); }catch{}
      tasks.push(
        ShadowGH.putFileSafe({
          token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
          path: "data/sv_source.json",
          message: "Update sv_source.json",
          content: srcText
        })
      );
    }
  }catch{}

  // ha nincs mit menteni, ne üssük a GH-t
  if(!tasks.length){
    ok = true;
    setSaveStatus("ok","Nincs változás");
    return;
  }

  await Promise.all(tasks);
  ok = true;

  // ✅ azonnali update a katalógus tabnak (ha nyitva van ugyanabban a böngészőben)
  try{
    const payload = { doc: state.doc, sales: state.sales, ts: Date.now() };
    localStorage.setItem("sv_live_payload", JSON.stringify(payload));
    try{ new BroadcastChannel("sv_live").postMessage(payload); }catch{}
  }catch{}

  // ✅ ne reloadoljunk minden autosave után (lassú) — a state már friss
  state.dirtyProducts = false;
  state.dirtySales = false;

  setSaveStatus("ok","Mentve ✅");
}catch(e){
      console.error(e);
      setSaveStatus("bad", `Mentés hiba: ${String(e?.message || e)}`);
      // hagyjuk dirty-n, de nem loopolunk végtelenbe
      state.dirty = true;
    }finally{
      state.saving = false;
      releaseLock();

      // Ha mentés közben jött új változás, és ez a mentés OK volt, futtassuk le még egyszer
      if(ok && (state.saveQueued || state.dirty)){
        state.saveQueued = false;
        if(state.saveTimer) clearTimeout(state.saveTimer);
        setTimeout(() => saveDataNow(), 350);
      }
    }
  }


function markDirty(flags){
  const f = flags || {};
  if(f.products) state.dirtyProducts = true;
  if(f.sales) state.dirtySales = true;
  if(f.reservations) state.dirtyReservations = true;
  queueAutoSave();
}

  function queueAutoSave(){
    state.dirty = true;
    if(state.saving){
      state.saveQueued = true;
      setSaveStatus("busy","Mentés folyamatban…");
      return;
    }
    if(state.saveTimer) clearTimeout(state.saveTimer);
    setSaveStatus("busy","Változás…");
    // ✅ MENTÉS GYORSÍTÁS: növelt alapérték 1000 ms
    const ms = Math.max(200, Math.min(2000, Number(localStorage.getItem("sv_autosave_ms") || 1000)));
    state.saveTimer = setTimeout(() => {
      saveDataNow();
    }, ms);
  }

  /* ---------- Rendering ---------- */
  function renderTabs(){
    $("#tabs").onclick = (e) => {
      const b = e.target.closest("button[data-tab]");
      if(!b) return;
      $("#tabs").querySelectorAll("button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");

      const tab = b.dataset.tab;
      $("#panelProducts").style.display = tab === "products" ? "block" : "none";
      $("#panelCategories").style.display = tab === "categories" ? "block" : "none";
      $("#panelSales").style.display = tab === "sales" ? "block" : "none";
      $("#panelChart").style.display = tab === "chart" ? "block" : "none";
      $("#panelPopups").style.display = tab === "popups" ? "block" : "none";
      $("#panelSettings").style.display = tab === "settings" ? "block" : "none";

      if(tab === "chart"){ if(!state._chartInited){ renderChartPanel(); state._chartInited=true; } drawChart(); }
      if(tab === "popups") renderPopups();
    };
  }

  function renderSettings(){
    const cfg = loadCfg();
    $("#panelSettings").innerHTML = `
      <div class="small-muted">GitHub mentés (token localStorage-ben). Branch: ha rossz, automatikusan próbál main/master.</div>
      <div class="form-grid" style="margin-top:12px;">
        <div class="field third"><label>Owner</label><input id="cfgOwner" value="${escapeHtml(cfg.owner)}" placeholder="pl. tesouser" /></div>
        <div class="field third"><label>Repo</label><input id="cfgRepo" value="${escapeHtml(cfg.repo)}" placeholder="pl. shadowvapes" /></div>
        <div class="field third"><label>Branch</label><input id="cfgBranch" value="${escapeHtml(cfg.branch)}" placeholder="main" /></div>
        <div class="field full"><label>Token</label><input id="cfgToken" value="${escapeHtml(cfg.token)}" type="password" placeholder="ghp_..." /></div>
      </div>
      <div class="actions">
        <button class="ghost" id="btnLoad">Betöltés</button>
        <button class="primary" id="btnSave">Mentés most</button>
      </div>

      <div class="form-grid" style="margin-top:12px;">
        <div class="field third">
          <label>Auto-mentés késleltetés</label>
          <select id="cfgAutosave">
            <option value="350">350 ms (gyors)</option>
            <option value="550">550 ms</option>
            <option value="650">650 ms</option>
            <option value="850">850 ms</option>
            <option value="1000" selected>1000 ms (alap)</option>
          </select>
        </div>
        <div class="field full">
          <div class="small-muted">Minél nagyobb, annál kevesebb GitHub hívás (mobilon stabilabb).</div>
        </div>
      </div>

      <div class="small-muted" style="margin-top:10px;">
        Tipp: public oldalon RAW-ból töltünk, ezért a frissítés gyorsabb lesz (nem vársz 6 percet).
      </div>

      <div class="small-muted" style="margin-top:14px;">Telefon / másik eszköz gyorsítás: nyisd meg ezt a linket egyszer, és onnantól a katalógus RAW-ról tölt (gyors frissülés).</div>
      <div class="actions table" style="margin-top:10px;align-items:center;">
        <input id="syncUrl" readonly value="" style="min-width:280px;width:100%;" />
        <button class="ghost" id="btnCopySync">Link másolás</button>
      </div>
    `;

    $("#btnLoad").onclick = loadData;
    $("#btnSave").onclick = saveDataNow;

    // Sync link generálás (katalógus URL + query paramok)
    try{
      const basePath = location.pathname.replace(/\/admin\.html.*$/,"/"); // /repo/ vagy /
      const base = location.origin + basePath;
      const u = new URL(base);
      if(cfg.owner) u.searchParams.set("sv_owner", cfg.owner);
      if(cfg.repo) u.searchParams.set("sv_repo", cfg.repo);
      if(cfg.branch) u.searchParams.set("sv_branch", cfg.branch);
      const link = u.toString();

      const inp = $("#syncUrl");
      if(inp) inp.value = link;

      const btn = $("#btnCopySync");
      if(btn) btn.onclick = async () => {
        try{
          await navigator.clipboard.writeText(link);
          setSaveStatus("ok","Sync link másolva ✅");
        }catch{
          // fallback
          try{
            inp.select();
            document.execCommand("copy");
            setSaveStatus("ok","Sync link másolva ✅");
          }catch{}
        }
      };
    }catch{}
    ["cfgOwner","cfgRepo","cfgBranch","cfgToken"].forEach(id => {
      $("#"+id).addEventListener("input", () => saveCfg(getCfg()));
    });

    // Auto-mentés késleltetés (lokális beállítás)
    try{
      const sel = $("#cfgAutosave");
      if(sel){
        const cur = Number(localStorage.getItem("sv_autosave_ms") || 1000);
        sel.value = String(cur);
        sel.onchange = () => {
          const ms = Math.max(200, Math.min(2000, Number(sel.value || 1000)));
          localStorage.setItem("sv_autosave_ms", String(ms));
          setSaveStatus("ok","Auto-mentés beállítva ✅");
        };
      }
    }catch{}

  }

  function renderCategories(){
    const cats = [...state.doc.categories].sort((a,b)=> (a.label_hu||a.id).localeCompare(b.label_hu||b.id,"hu"));

    let rows = cats.map(c => `
      <tr>
        <td><b>${escapeHtml(c.id)}</b></td>
        <td><input data-cid="${escapeHtml(c.id)}" data-k="label_hu" value="${escapeHtml(c.label_hu)}"></td>
        <td><input data-cid="${escapeHtml(c.id)}" data-k="label_en" value="${escapeHtml(c.label_en)}"></td>
        <td style="width:160px;"><input data-cid="${escapeHtml(c.id)}" data-k="basePrice" type="number" min="0" value="${Number(c.basePrice||0)}"></td>
        <td style="width:120px;text-align:center;"><input type="checkbox" data-cid="${escapeHtml(c.id)}" data-k="featuredEnabled"${c.featuredEnabled===false?"":" checked"}></td>
        <td style="width:110px;"><button class="danger" data-delcat="${escapeHtml(c.id)}">Töröl</button></td>
      </tr>
    `).join("");

    $("#panelCategories").innerHTML = `
      <div class="actions">
        <button class="primary" id="btnAddCat">+ Kategória</button>
        <div class="small-muted">Ha terméknél az ár üres/null → kategória alap árát használja.</div>
      </div>
      <table class="table">
        <thead>
          <tr><th>ID</th><th>HU</th><th>EN</th><th>Alap ár (Ft)</th><th>Felkapott</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    $("#btnAddCat").onclick = () => {
      const body = document.createElement("div");
      body.innerHTML = `
        <div class="form-grid">
          <div class="field third"><label>ID (pl. elf)</label><input id="newCid" placeholder="elf"></div>
          <div class="field third"><label>HU</label><input id="newChu" placeholder="ELF"></div>
          <div class="field third"><label>Alap ár</label><input id="newCprice" type="number" min="0" value="0"></div>
        </div>
      `;
      openModal("Új kategória", "Nem prompt, rendes modal 😄", body, [
        { label:"Mégse", kind:"ghost", onClick: closeModal },
        { label:"Létrehozás", kind:"primary", onClick: () => {
          const id = ($("#newCid").value||"").trim();
          if(!id) return;
          if(state.doc.categories.some(x => x.id === id)) return;

          const hu = ($("#newChu").value||"").trim() || id;

          state.doc.categories.push({
            id,
            label_hu: hu,
            label_en: hu, // ✅ EN nem kell külön, maradjon HU
            basePrice: Math.max(0, Number($("#newCprice").value||0))
          });
          closeModal();
          renderAll();
          markDirty({ products:true });
        }}
      ]);
    };

    $("#panelCategories").querySelectorAll("input[data-cid]").forEach(inp => {
      const apply = () => {
        const id = inp.dataset.cid;
        const k = inp.dataset.k;
        const c = catById(id);
        if(!c) return;
        if(k === "basePrice") c.basePrice = Math.max(0, Number(inp.value||0));
        else if(k === "featuredEnabled") c.featuredEnabled = !!inp.checked;
        else c[k] = inp.value;
        markDirty({ products:true });
      };
      // checkbox → change, a többi → input
      if(inp.type === "checkbox") inp.onchange = apply;
      else inp.oninput = apply;
    });

    $("#panelCategories").querySelectorAll("button[data-delcat]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.delcat;
        // ha használja termék, ne engedjük
        if(state.doc.products.some(p => p.categoryId === id)) return;
        state.doc.categories = state.doc.categories.filter(c => c.id !== id);
        renderAll();
        markDirty({ products:true });
      };
    });
  }

  function renderProducts(){
    const cats = [{id:"all", label:"Mind"}, ...state.doc.categories.map(c=>({id:c.id,label:c.label_hu||c.id}))];

    const filterCat = state.filters.productsCat;
    const q = (state.filters.productsSearch || "").toLowerCase();

    let list = [...state.doc.products];
    if(filterCat !== "all"){
      list = list.filter(p => p.categoryId === filterCat);
    }
    if(q){
      list = list.filter(p => (`${p.name_hu} ${p.name_en} ${p.flavor_hu} ${p.flavor_en}`).toLowerCase().includes(q));
    }

    // rend: ok, soon, out (admin nézethez)
    const rank = (s) => s === "ok" ? 0 : (s === "soon" ? 1 : 2);
    list.sort((a,b) => {
      const ra = rank(a.status), rb = rank(b.status);
      if(ra !== rb) return ra - rb;
      return (a.name_hu||a.name_en||"").localeCompare((b.name_hu||b.name_en||""),"hu");
    });

    const rows = list.map(p => {
      const c = catById(p.categoryId);
      const eff = effectivePrice(p);

      return `
        <div class="rowline table">
          <div class="left">
            <div style="font-weight:900;">${escapeHtml(p.name_hu||p.name_en||"—")} <span class="small-muted">• ${escapeHtml(p.flavor_hu||p.flavor_en||"")}</span></div>
            <div class="small-muted">
              Kategória: <b>${escapeHtml(c ? (c.label_hu||c.id) : "—")}</b>
              • Ár: <b>${eff.toLocaleString("hu-HU")} Ft</b>
              • Készlet: <b>${p.status==="soon" ? "—" : p.stock}</b>
              ${p.status==="soon" && p.soonEta ? `• Várható: <b>${escapeHtml(p.soonEta)}</b>` : ""}
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label class="chk"><input type="checkbox" data-pid="${escapeHtml(p.id)}" data-k="visible"${p.visible===false?"":" checked"}> Látható</label>
            <select data-pid="${escapeHtml(p.id)}" data-k="categoryId">
              ${state.doc.categories.map(cc => `<option value="${escapeHtml(cc.id)}"${cc.id===p.categoryId?" selected":""}>${escapeHtml(cc.label_hu||cc.id)}</option>`).join("")}
            </select>
            <select data-pid="${escapeHtml(p.id)}" data-k="status">
              <option value="ok"${p.status==="ok"?" selected":""}>ok</option>
              <option value="out"${p.status==="out"?" selected":""}>out</option>
              <option value="soon"${p.status==="soon"?" selected":""}>soon</option>
            </select>
            <input data-pid="${escapeHtml(p.id)}" data-k="stock" type="number" min="0" value="${p.stock}" style="width:110px;">
            <input data-pid="${escapeHtml(p.id)}" data-k="price" type="number" min="0" value="${p.price===null? "" : p.price}" placeholder="(kategória ár)" style="width:150px;">
            <button class="ghost" data-edit="${escapeHtml(p.id)}">Szerkeszt</button>
            <button class="danger" data-del="${escapeHtml(p.id)}">Töröl</button>
          </div>
        </div>
      `;
    }).join("");

    $("#panelProducts").innerHTML = `
      <div class="actions table" style="align-items:center;">
        <button class="primary" id="btnAddProd">+ Termék</button>
        <select id="prodCat">
          ${cats.map(c => `<option value="${escapeHtml(c.id)}"${c.id===filterCat?" selected":""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
        <input id="prodSearch" placeholder="Keresés..." value="${escapeHtml(state.filters.productsSearch)}" style="flex:1;min-width:220px;">
        <div class="small-muted">Out termékek a public oldalon automatikusan leghátul.</div>
      </div>
      <div style="margin-top:10px;">${rows || `<div class="small-muted">Nincs találat.</div>`}</div>
    `;

    $("#prodCat").onchange = () => { state.filters.productsCat = $("#prodCat").value; renderProducts(); };
    $("#prodSearch").oninput = () => { state.filters.productsSearch = $("#prodSearch").value; renderProducts(); };

    $("#btnAddProd").onclick = () => openProductModal(null);

    $("#panelProducts").querySelectorAll("[data-pid]").forEach(el => {
      const apply = () => {
        const pid = el.dataset.pid;
        const k = el.dataset.k;
        const p = prodById(pid);
        if(!p) return;

        if(k === "stock"){
          p.stock = Math.max(0, Number(el.value||0));
          if(p.stock <= 0 && p.status !== "soon") p.status = "out";
        }else if(k === "price"){
          p.price = (el.value === "" ? null : Math.max(0, Number(el.value||0)));
        }else if(k === "status"){
          p.status = el.value;
          if(p.status === "out") p.stock = 0;
        }else if(k === "categoryId"){
          p.categoryId = el.value;
        }else if(k === "visible"){
          p.visible = !!el.checked;
        }

        markDirty({ products:true });
      };

      const tag = String(el.tagName||"").toLowerCase();
      if(tag === "select" || el.type === "checkbox") el.onchange = apply;
      else el.oninput = apply;
    });

    $("#panelProducts").querySelectorAll("button[data-edit]").forEach(b => {
      b.onclick = () => openProductModal(b.dataset.edit);
    });
    $("#panelProducts").querySelectorAll("button[data-del]").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.del;
        // ha eladásban van, ne engedjük törölni
        if(state.sales.some(s => s.items.some(it => it.productId === id))) return;
        state.doc.products = state.doc.products.filter(p => p.id !== id);
        renderAll();
        markDirty({ products:true });
      };
    });
  }

  function openProductModal(id){
    const editing = id ? prodById(id) : null;
    const p = editing ? {...editing} : {
      id: "p_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16),
      categoryId: state.doc.categories[0]?.id || "",
      status: "ok",
      stock: 0,
      price: null,
      image: "",
      name_hu: "",
      name_en: "",
      flavor_hu: "",
      flavor_en: "",
      soonEta: "", // ✅ Csak hónap formátum
      visible: true
    };

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="form-grid">
        <div class="field third"><label>ID</label><input id="p_id" value="${escapeHtml(p.id)}" ${editing?"disabled":""}></div>
        <div class="field third"><label>Kategória</label>
          <select id="p_cat">
            ${state.doc.categories.map(c => `<option value="${escapeHtml(c.id)}"${c.id===p.categoryId?" selected":""}>${escapeHtml(c.label_hu||c.id)}</option>`).join("")}
          </select>
        </div>
        <div class="field third"><label>Status</label>
          <select id="p_status">
            <option value="ok"${p.status==="ok"?" selected":""}>ok</option>
            <option value="out"${p.status==="out"?" selected":""}>out</option>
            <option value="soon"${p.status==="soon"?" selected":""}>soon</option>
          </select>
        </div>

        <div class="field third"><label>Várható hónap (csak "soon")</label><input id="p_eta" type="month" value="${escapeHtml(p.soonEta||"")}" placeholder="YYYY-MM"></div>

        <div class="field third"><label>Látható</label><label class="chk" style="justify-content:flex-start;"><input type="checkbox" id="p_visible" ${p.visible===false?"":"checked"}> Megjelenjen</label></div>

        <div class="field third"><label>Készlet</label><input id="p_stock" type="number" min="0" value="${p.stock}"></div>
        <div class="field third"><label>Ár (Ft) — üres: kategória ár</label><input id="p_price" type="number" min="0" value="${p.price===null?"":p.price}"></div>
        <div class="field full"><label>Kép URL</label><input id="p_img" value="${escapeHtml(p.image)}"></div>

        <div class="field third"><label>Termék neve</label><input id="p_name" value="${escapeHtml(p.name_hu)}"></div>
        <div class="field third"><label>Íz HU</label><input id="p_fhu" value="${escapeHtml(p.flavor_hu)}"></div>
        <div class="field third"><label>Íz EN</label><input id="p_fen" value="${escapeHtml(p.flavor_en)}"></div>
      </div>
      <div class="small-muted" style="margin-top:10px;">
        soon → csak a "Hamarosan" tabban látszik. out/stock=0 → public oldalon leghátul + szürke.<br>
        Várható hónap formátum: ÉÉÉÉ-HH (pl. 2025-12)
      </div>
    `;

    openModal(editing ? "Termék szerkesztése" : "Új termék", "", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const np = {
          id: ($("#p_id").value||"").trim(),
          categoryId: $("#p_cat").value,
          status: $("#p_status").value,
          visible: !!$("#p_visible").checked,
          stock: Math.max(0, Number($("#p_stock").value||0)),
          price: ($("#p_price").value === "" ? null : Math.max(0, Number($("#p_price").value||0))),
          image: ($("#p_img").value||"").trim(),
          name_hu: ($("#p_name").value||"").trim(),
          name_en: ($("#p_name").value||"").trim(),
          flavor_hu: ($("#p_fhu").value||"").trim(),
          flavor_en: ($("#p_fen").value||"").trim(),
          // ✅ Csak hónap formátumot fogadunk el
          soonEta: ($("#p_eta").value||"").replace(/^(\d{4}-\d{2}).*$/, "$1")
        };
        if(np.status !== "soon") np.soonEta = "";
        if(!np.id) return;

        if(editing){
          Object.assign(editing, np);
        }else{
          state.doc.products.push(np);
        }
        closeModal();
        renderAll();
        markDirty({ products:true });
      }}
    ]);

    // out -> stock automatikusan 0 + lock
    const stSel = $("#p_status");
    const stInp = $("#p_stock");
    const syncStockLock = () => {
      if(!stSel || !stInp) return;
      if(stSel.value === "out"){
        stInp.value = "0";
        stInp.disabled = true;
      }else{
        stInp.disabled = false;
      }
    };
    if(stSel){
      stSel.addEventListener("change", syncStockLock);
    }
    syncStockLock();
  }

  function renderSalesPOS(){
    const panel = $("#panelSales");

    // build reservedMap from ACTIVE reservations (48h)
    const reservedMap = new Map();
    for(const r of (state.reservations||[])){
      if(String(r.status||"active") !== "active") continue;
      const exp = r.expiresAt ? Date.parse(r.expiresAt) : 0;
      if(exp && exp <= Date.now()) continue;
      for(const it of (r.items||[])){
        const pid = String(it.productId||"");
        if(!pid) continue;
        const q = Math.max(0, Number(it.qty||0) || 0);
        if(!q) continue;
        reservedMap.set(pid, (reservedMap.get(pid)||0) + q);
      }
    }

    // filters
    const cats = [{id:"all", label:"Összes termék"}, ...state.doc.categories.map(c=>({id:String(c.id), label:(c.label_hu||c.id)}))];
    const activeCat = state.filters.salesCat || "all";
    const q = (state.filters.salesSearch || "").trim().toLowerCase();

    // products list filter
    let list = [...(state.doc.products||[])].filter(p => p && (p.visible !== false));
    if(activeCat !== "all") list = list.filter(p => String(p.categoryId) === String(activeCat));
    if(q){
      list = list.filter(p => (`${p.name_hu||""} ${p.flavor_hu||""} ${p.name_en||""} ${p.flavor_en||""}`).toLowerCase().includes(q));
    }

    // cart
    const cart = state.posCart || (state.posCart = {});
    const cartCount = Object.values(cart).reduce((a,b)=>a+Number(b||0),0);

    panel.innerHTML = `
      <div class="pos-admin">
        <aside class="pos-side">
          <div class="brand" style="margin-bottom:10px;">Shadow<span>Vapes</span></div>

          <div class="field">
            <input id="posSearch" class="input" placeholder="Keresés..." value="${escapeHtml(state.filters.salesSearch||"")}" />
          </div>

          <div class="nav" id="posCats"></div>

          <div class="pos-side-bottom">
            <button class="ghost" id="posShowSales">
              Eladások ${state.badges?.sales ? `<span class="badge-dot">${state.badges.sales}</span>` : ``}
            </button>
          </div>
        </aside>

        <main class="pos-main">
          <div class="pos-grid" id="posGrid"></div>
          <div class="empty" id="posEmpty" style="display:none;">Nincs találat.</div>
        </main>

        <aside class="pos-cart">
          <div class="pos-cart-head">
            <div style="font-weight:900;">Kosár</div>
            <div class="small-muted">${cartCount} tétel</div>
          </div>

          <div class="pos-cart-list" id="posCartList"></div>

          <div class="pos-cart-foot">
            <button class="primary" id="posRecord" ${cartCount?"" : "disabled"}>Eladás rögzítése</button>
          </div>
        </aside>
      </div>
    `;

    // categories
    const catsEl = $("#posCats");
    catsEl.innerHTML = cats.map(c => `
      <button class="${String(c.id)===String(activeCat) ? "active" : ""}" data-cid="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>
    `).join("");

    catsEl.querySelectorAll("button[data-cid]").forEach(btn=>{
      btn.onclick = () => {
        state.filters.salesCat = btn.getAttribute("data-cid") || "all";
        renderSales();
      };
    });

    $("#posSearch").oninput = (e) => {
      state.filters.salesSearch = e.target.value || "";
      renderSales();
    };

    // show sales list
    $("#posShowSales").onclick = () => {
      state.filters.salesMode = "list";
      renderSales();
    };

    // grid
    const grid = $("#posGrid");
    grid.innerHTML = "";
    if(!list.length){
      $("#posEmpty").style.display = "block";
    }else{
      $("#posEmpty").style.display = "none";
    }

    const catById = (id) => state.doc.categories.find(c=>String(c.id)===String(id));

    for(const p of list){
      const pid = String(p.id);
      const c = catById(p.categoryId);
      const name = (p.name_hu||p.name_en||"—");
      const flavor = (p.flavor_hu||p.flavor_en||"");
      const price = effectivePrice(p);
      const baseStock = Math.max(0, Number(p.stock||0));
      const reserved = Number(reservedMap.get(pid) || 0);
      const status = String(p.status||"ok");
      const soon = status==="soon";
      const out = status==="out";
      const avail = (soon || out) ? 0 : Math.max(0, baseStock - reserved);

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="hero">
          <img src="${escapeHtml(p.image||"")}" alt="${escapeHtml(name)}" loading="lazy" />
          <div class="badges">
            ${soon ? `<div class="badge soon">Hamarosan</div>` : ``}
            ${out ? `<div class="badge out">Elfogyott</div>` : ``}
          </div>
          <div class="overlay-title">
            <div class="name">${escapeHtml(name)}</div>
            <div class="flavor">${escapeHtml(flavor)}</div>
          </div>
          <button class="addcart" title="Kosárba" ${avail<=0 ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6h15l-1.5 9h-12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 6l-2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 21a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/><path d="M18 21a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/></svg>
          </button>
        </div>
        <div class="card-body">
          <div class="meta-row">
            <div class="price">${Number(price||0).toLocaleString("hu-HU")} Ft</div>
            <div class="stock">Készlet: <b>${soon ? "—" : avail} db</b></div>
            <div class="reserved">Foglalt: <b>${soon ? "—" : reserved} db</b></div>
          </div>
        </div>
      `;

      const addBtn = card.querySelector(".addcart");
      addBtn.onclick = (e) => {
        e.stopPropagation();
        if(avail<=0) return;
        cart[pid] = Math.min(avail, (Number(cart[pid]||0)+1));
        renderSales(); // rerender for simplicity
      };

      grid.appendChild(card);
    }

    // cart list
    function renderCartList(){
      const el = $("#posCartList");
      const items = Object.entries(cart).filter(([,q])=>Number(q||0)>0).map(([pid,qty])=>{
        const p = state.doc.products.find(x=>String(x.id)===String(pid));
        if(!p) return null;
        const name = (p.name_hu||p.name_en||"—");
        const flavor = (p.flavor_hu||p.flavor_en||"");
        const price = effectivePrice(p);
        // max per product: available now
        const baseStock = Math.max(0, Number(p.stock||0));
        const reserved = Number(reservedMap.get(String(pid)) || 0);
        const status = String(p.status||"ok");
        const soon = status==="soon";
        const out = status==="out";
        const avail = (soon || out) ? 0 : Math.max(0, baseStock - reserved);
        const q = Math.min(avail, Math.max(0, Number(qty||0)));

        return { pid:String(pid), q, avail, name, flavor, price };
      }).filter(Boolean);

      if(!items.length){
        el.innerHTML = `<div class="small-muted" style="padding:10px 2px;">A kosár üres.</div>`;
        return;
      }

      el.innerHTML = items.map(it=>`
        <div class="pos-cart-item" data-pid="${escapeHtml(it.pid)}">
          <div class="ci-title">
            <div style="font-weight:900;">${escapeHtml(it.name)}</div>
            <div class="small-muted">${escapeHtml(it.flavor)}</div>
          </div>
          <div class="ci-ctrl">
            <button class="ghost" data-act="minus">−</button>
            <div class="ci-qty">${it.q}</div>
            <button class="ghost" data-act="plus" ${it.q>=it.avail ? "disabled":""}>+</button>
          </div>
          <div class="ci-sum">${(it.q*Number(it.price||0)).toLocaleString("hu-HU")} Ft</div>
        </div>
      `).join("");

      el.querySelectorAll(".pos-cart-item button[data-act]").forEach(b=>{
        b.onclick = () => {
          const row = b.closest(".pos-cart-item");
          const pid = row.getAttribute("data-pid");
          const act = b.getAttribute("data-act");
          const cur = Number(cart[pid]||0);
          if(act==="plus"){
            // find max
            const p = state.doc.products.find(x=>String(x.id)===String(pid));
            if(!p) return;
            const baseStock = Math.max(0, Number(p.stock||0));
            const reserved = Number(reservedMap.get(String(pid)) || 0);
            const status = String(p.status||"ok");
            const avail = (status==="soon" || status==="out") ? 0 : Math.max(0, baseStock - reserved);
            cart[pid] = Math.min(avail, cur+1);
          }else{
            const next = cur-1;
            if(next<=0) delete cart[pid];
            else cart[pid]=next;
          }
          renderSales();
        };
      });
    }

    renderCartList();

    // record sale
    $("#posRecord").onclick = () => {
      // modal uses state.posCart to auto-fill items
      openSaleModal({ fromPOS:true });
    };
  }
}


  function renderAll(){
    renderSettings();
    renderCategories();
    renderProducts();
    renderSales();
    renderChartPanel();
    renderPopups();
    drawChart();
  }

  /* ---------- init ---------- */
  function init(){
    renderTabs();
    $("#btnReload").onclick = () => location.reload();
    $("#modalBg").addEventListener("click", (e) => {
      if(e.target === $("#modalBg")) closeModal();
    });

    // first render panels + inject settings inputs ids
    renderSettings();

    // betöltés ha van config
    const cfg = loadCfg();

    // autoload, ha van minden
    if(cfg.owner && cfg.repo && cfg.token){
      // töltsük be az inputokba is
      $("#cfgOwner").value = cfg.owner;
      $("#cfgRepo").value = cfg.repo;
      $("#cfgBranch").value = cfg.branch || "main";
      $("#cfgToken").value = cfg.token;

      loadData();
    }else{
      setSaveStatus("bad","Add meg a GH adatokat");
    }
  }

  init();
})();