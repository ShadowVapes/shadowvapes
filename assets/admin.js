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
    shas: { products: null, sales: null },
    // hogy a public oldal biztosan megtalálja a RAW forrást (telefonon is)
    forceSourceSync: false,
    clientId: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
    filters: {
      productsCat: "all",
      salesCat: "all",
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
  }


  function normalizeReservations(list){
    if(!Array.isArray(list)) return [];
    const out = [];
    for(const r of list){
      if(!r) continue;
      const id = String(r.id || r._id || r.resId || "");
      if(!id) continue;

      const confirmed = !!r.confirmed;
      const createdAt = Number(r.createdAt || r.ts || 0) || 0;

      let expiresAt = null;
      if(!confirmed){
        const ex = (r.expiresAt === null || r.expiresAt === undefined || r.expiresAt === "") ? null : Number(r.expiresAt || 0) || null;
        expiresAt = ex;
      }

      const items = Array.isArray(r.items) ? r.items.map(it => ({
        productId: String(it.productId || it.pid || it.product || ""),
        qty: Math.max(1, Number(it.qty || it.quantity || 1) || 1),
        unitPrice: Math.max(0, Number(it.unitPrice || it.price || 0) || 0),
      })).filter(it => it.productId) : [];

      out.push({
        id,
        publicCode: String(r.publicCode || r.code || ""),
        createdAt,
        expiresAt,
        confirmed,
        modified: !!r.modified,
        modifiedAt: Number(r.modifiedAt || 0) || 0,
        items
      });
    }
    return out;
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

        // reservations.json lehet, hogy még nincs a repo-ban → ilyenkor induljunk üres foglalásokkal
        let r = null;
        let reservations = [];
        try{
          r = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/reservations.json" });
          reservations = JSON.parse(r.content || "[]");
        }catch(e){
          if(Number(e?.status || 0) === 404){
            r = { sha: null };
            reservations = [];
          }else{
            throw e;
          }
        }

        const doc = JSON.parse(p.content);

        cfg.branch = br;
        saveCfg(cfg);

        state.doc = doc;
        state.sales = sales;
        state.reservations = normalizeReservations(reservations);
        state.shas.products = p.sha;
        state.shas.sales = s ? (s.sha || null) : null;
        state.shas.reservations = r ? (r.sha || null) : null;
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
      console.error(r.err);
      setSaveStatus("bad", "Betöltés hiba: " + String(r.err?.message || ""));
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
    // refresh sha, ha nincs
    const pOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/products.json" });
    state.shas.products = pOld.sha;
  }

  if(wantSales && !state.shas.sales){
    try{
      const sOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/sales.json" });
      state.shas.sales = sOld.sha;
    }catch(e){
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
    const payload = { doc: state.doc, sales: state.sales, reservations: state.reservations, ts: Date.now() };
    localStorage.setItem("sv_live_payload", JSON.stringify(payload));
    try{ new BroadcastChannel("sv_live").postMessage(payload); }catch{}
  }catch{}

  // ✅ ne reloadoljunk minden autosave után (lassú) — a state már friss
  state.dirtyProducts = false;
  state.dirtySales = false;
  state.dirtyReservations = false;

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

      if(tab === "chart") drawChart();
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
        <td style="width:110px;text-align:center;"><input type="checkbox" data-cid="${escapeHtml(c.id)}" data-k="visible"${c.visible===false?"":" checked"}></td>
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
          <tr><th>ID</th><th>HU</th><th>EN</th><th>Alap ár (Ft)</th><th>Látható</th><th>Felkapott</th><th></th></tr>
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
            basePrice: Math.max(0, Number($("#newCprice").value||0)),
            visible: true,
            featuredEnabled: true
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
        else if(k === "visible") c.visible = !!inp.checked;
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
      const img = (p.image || "").trim();

      return `
        <div class="rowline table">
          <div class="left">
            <div class="admin-prod-left">
              <img class="admin-prod-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.style.display='none'">
              <div>
                <div style="font-weight:900;">${escapeHtml(p.name_hu||p.name_en||"—")} <span class="small-muted">• ${escapeHtml(p.flavor_hu||p.flavor_en||"")}</span></div>
                <div class="small-muted">
                  Kategória: <b>${escapeHtml(c ? (c.label_hu||c.id) : "—")}</b>
                  • Ár: <b>${eff.toLocaleString("hu-HU")} Ft</b>
                  • Készlet: <b>${p.status==="soon" ? "—" : p.stock}</b>
                  ${p.status==="soon" && p.soonEta ? `• Várható: <b>${escapeHtml(p.soonEta)}</b>` : ""}
                </div>
              </div>
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

  function renderSales(){
    const cats = [{id:"all", label:"Mind"}, ...state.doc.categories.map(c=>({id:c.id,label:c.label_hu||c.id}))];

    const filterCat = state.filters.salesCat;
    const q = (state.filters.salesSearch || "").toLowerCase();

    let list = [...state.sales].sort((a,b)=> String(b.date).localeCompare(String(a.date)));
    if(q){
      list = list.filter(s => (`${s.name} ${s.payment}`).toLowerCase().includes(q));
    }
    if(filterCat !== "all"){
      list = list.filter(s => saleTotals(s, filterCat).hit);
    }

    const rows = list.map(s => {
      const tot = saleTotals(s, filterCat);
      const itemsCount = s.items.reduce((acc,it)=> acc + Number(it.qty||0), 0);

      return `
        <div class="rowline">
          <div class="left">
            <div style="font-weight:900;">
              ${escapeHtml(s.date)} • ${escapeHtml(s.name || "—")}
              <span class="small-muted">• ${escapeHtml(s.payment || "")}</span>
            </div>
            <div class="small-muted">Tételek: <b>${itemsCount}</b> • Bevétel: <b>${tot.revenue.toLocaleString("hu-HU")} Ft</b></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="ghost" data-view="${escapeHtml(s.id)}">Megnéz</button>
            <button class="danger" data-delsale="${escapeHtml(s.id)}">Töröl (rollback)</button>
          </div>
        </div>
      `;
    }).join("");

    $("#panelSales").innerHTML = `
      <div class="admin-sales-embedwrap">
        <iframe class="admin-sales-embed" src="./?sv_admin=1" loading="lazy" referrerpolicy="no-referrer"></iframe>
      </div>
      ${renderReservationsSection()}
      <div class=\"actions table" style="align-items:center;">
        <button class="primary" id="btnAddSale">+ Eladás</button>
        <select id="salesCat">
          ${cats.map(c => `<option value="${escapeHtml(c.id)}"${c.id===filterCat?" selected":""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
        <input id="salesSearch" placeholder="Keresés név / mód szerint..." value="${escapeHtml(state.filters.salesSearch)}" style="flex:1;min-width:220px;">
        <div class="small-muted">Szűrés kategóriára: csak az adott kategória tételeit számolja.</div>
      </div>
      <div style="margin-top:10px;">${rows || `<div class="small-muted">Nincs eladás.</div>`}</div>
    `;

    $("#salesCat").onchange = () => { state.filters.salesCat = $("#salesCat").value; renderSales(); drawChart(); };
    $("#salesSearch").oninput = () => { state.filters.salesSearch = $("#salesSearch").value; renderSales(); };

    $("#btnAddSale").onclick = () => openSaleModal();

    $("#panelSales").querySelectorAll("button[data-delsale]").forEach(b => {
      b.onclick = () => deleteSale(b.dataset.delsale);
    });
    $("#panelSales").querySelectorAll("button[data-view]").forEach(b => {
      b.onclick = () => viewSale(b.dataset.view);
    });

    // reservation handlers
    $("#panelSales").querySelectorAll("button[data-res-del]").forEach(b=>{ b.onclick = () => deleteReservation(b.dataset.resDel); });
    $("#panelSales").querySelectorAll("button[data-res-confirm]").forEach(b=>{ b.onclick = () => confirmReservation(b.dataset.resConfirm); });
    $("#panelSales").querySelectorAll("button[data-res-edit]").forEach(b=>{ b.onclick = () => openReservationEditModal(b.dataset.resEdit); });
    $("#panelSales").querySelectorAll("button[data-res-sale]").forEach(b=>{ b.onclick = () => saleFromReservation(b.dataset.resSale); });

    startReservationTicker();
  }


function prodLabel(p){
  const n = (p && (p.name_hu || p.name_en)) || "—";
  const f = (p && (p.flavor_hu || p.flavor_en)) || "";
  return n + (f ? " • " + f : "");
}

function openProductPicker(opts = {}){
  const title = opts.title || "Válassz terméket";
  const allowSoon = !!opts.allowSoon;

  return new Promise((resolve) => {
    const body = document.createElement("div");
    body.innerHTML = `
      <input class="picker-search" id="pp_q" placeholder="Keresés (név / íz)...">
      <div id="pp_list" style="margin-top:12px;"></div>
    `;

    const qEl = body.querySelector("#pp_q");
    const listEl = body.querySelector("#pp_list");

    const cats = [...state.doc.categories].sort((a,b)=> (a.label_hu||a.id).localeCompare(b.label_hu||b.id,"hu"));

    const render = () => {
      const q = String(qEl.value || "").trim().toLowerCase();

      let prods = state.doc.products
        .filter(p => p && p.id)
        .filter(p => allowSoon ? true : (p.status !== "soon"));

      if(q){
        prods = prods.filter(p => (prodLabel(p).toLowerCase()).includes(q));
      }

      const byCat = new Map();
      for(const c of cats) byCat.set(String(c.id), []);
      byCat.set("_other", []);

      for(const p of prods){
        const k = byCat.has(String(p.categoryId)) ? String(p.categoryId) : "_other";
        byCat.get(k).push(p);
      }

      const sections = [];

      const renderGroup = (title, arr) => {
        if(!arr || !arr.length) return;
        arr.sort((a,b)=> prodLabel(a).localeCompare(prodLabel(b),"hu"));
        const items = arr.map(p => {
          const img = (p.image || "").trim();
          const thumb = img
            ? `<img class="picker-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="picker-thumb ph">SV</div>`;
          const eff = effectivePrice(p);
          const stockTxt = (p.status === "out") ? "Elfogyott" : (p.status === "soon" ? "Hamarosan" : `Készlet: ${Number(p.stock||0)}`);
          return `
            <button type="button" class="picker-item" data-pid="${escapeHtml(p.id)}">
              ${thumb}
              <div>
                <div class="picker-name">${escapeHtml(prodLabel(p))}</div>
                <div class="picker-sub">${escapeHtml(stockTxt)}</div>
              </div>
              <div class="picker-right"><b>${eff.toLocaleString("hu-HU")} Ft</b></div>
            </button>
          `;
        }).join("");
        sections.push(`
          <div class="picker-cat">${escapeHtml(title)}</div>
          <div class="picker-list">${items}</div>
        `);
      };

      for(const c of cats){
        renderGroup(c.label_hu || c.id, byCat.get(String(c.id)));
      }
      renderGroup("Egyéb", byCat.get("_other"));

      listEl.innerHTML = sections.length ? sections.join("") : `<div class="small-muted">Nincs találat.</div>`;
    };

    qEl.oninput = render;
    render();

    listEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pid]");
      if(!b) return;
      const pid = String(b.dataset.pid || "");
      closeModal();
      resolve(pid || null);
    });

    openModal(title, "Képes lista, kategóriánként", body, [
      { label:"Mégse", kind:"ghost", onClick: () => { closeModal(); resolve(null); } }
    ]);

    setTimeout(()=>{ try{ qEl.focus(); }catch{} }, 60);
  });
}

  function openSaleModal(pre){
    const preDate = (pre && pre.date) ? String(pre.date) : todayISO();
    const preName = (pre && pre.name) ? String(pre.name) : "";
    const prePay  = (pre && pre.payment) ? String(pre.payment) : "";
    const preItems = (pre && Array.isArray(pre.items)) ? pre.items : [];
    const title = (pre && pre.title) ? String(pre.title) : "Új eladás";

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="grid2">
        <div class="field"><label>Dátum (YYYY-MM-DD)</label><input id="s_date" type="text" value="${escapeHtml(preDate)}"></div>
        <div class="field"><label>Név (opcionális)</label><input id="s_name" type="text" value="${escapeHtml(preName)}"></div>
      </div>
      <div class="field" style="margin-top:10px;"><label>Fizetési mód (opcionális)</label><input id="s_pay" type="text" value="${escapeHtml(prePay)}"></div>
      <div class="field" style="margin-top:10px;">
        <label>Tételek</label>
        <div id="s_items"></div>
      </div>
      <div class="actions">
        <button class="ghost" id="btnAddItem">+ Tétel</button>
      </div>
    `;

    const itemsRoot = body.querySelector("#s_items");


const addItemRow = (pref = {}) => {
  const row = document.createElement("div");
  row.className = "rowline table";
  row.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%;">
      <img class="it-thumb" alt="" />
      <button type="button" class="it-pick-btn it_pick">Válassz terméket…</button>
      <input type="hidden" class="it_prod" value="">
      <input class="it_qty" type="number" min="1" value="1" style="width:110px;">
      <input class="it_price" type="number" min="0" value="0" style="width:150px;">
      <button class="danger it_del" type="button">Töröl</button>
    </div>
  `;

  const pidInp = row.querySelector(".it_prod");
  const pickBtn = row.querySelector(".it_pick");
  const qtyInp = row.querySelector(".it_qty");
  const priceInp = row.querySelector(".it_price");
  const thumb = row.querySelector(".it-thumb");

  const syncThumb = (p) => {
    const img = p && (p.image || "").trim();
    if(!thumb) return;
    if(img){
      thumb.src = img;
      thumb.style.visibility = "visible";
    }else{
      thumb.removeAttribute("src");
      thumb.style.visibility = "hidden";
    }
  };

  const applyPid = (pid, setPrice = true) => {
    pidInp.value = String(pid || "");
    const p = prodById(pidInp.value);
    pickBtn.textContent = p ? prodLabel(p) : "Válassz terméket…";
    if(setPrice){
      priceInp.value = String(p ? effectivePrice(p) : 0);
    }
    syncThumb(p);
  };

  pickBtn.onclick = async () => {
    const pid = await openProductPicker({ title: "Válassz terméket" });
    if(pid) applyPid(pid, true);
  };

  row.querySelector(".it_del").onclick = () => row.remove();

  if(pref && pref.productId){
    applyPid(pref.productId, false);
    qtyInp.value = String(Math.max(1, Number(pref.qty || 1) || 1));
    const p = prodById(pidInp.value);
    if(pref.unitPrice !== undefined && pref.unitPrice !== null && String(pref.unitPrice) !== ""){
      priceInp.value = String(Math.max(0, Number(pref.unitPrice) || 0));
    }else{
      priceInp.value = String(p ? effectivePrice(p) : 0);
    }
    syncThumb(p);
  }else{
    applyPid("", true);
    priceInp.value = "0";
  }

  itemsRoot.appendChild(row);
};

    if(preItems && preItems.length){
      for(const it of preItems) addItemRow(it);
    }else{
      addItemRow();
    }

    body.querySelector("#btnAddItem").onclick = () => addItemRow();

    openModal(title, "Név + dátum + mód + több termék", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const date = ((document.querySelector('#s_date')?.value)||"").trim();
        const name = ((document.querySelector('#s_name')?.value)||"").trim();
        const payment = ((document.querySelector('#s_pay')?.value)||"").trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

        const rows = [...itemsRoot.querySelectorAll('.rowline')];
        const items = [];
        for(const r of rows){
          const pid = r.querySelector('.it_prod').value;
          if(!pid) continue;
          const qty = Math.max(1, Number(r.querySelector('.it_qty').value || 1) || 1);
          const unitPrice = Math.max(0, Number(r.querySelector('.it_price').value || 0) || 0);
          items.push({ productId: pid, qty, unitPrice });
        }
        if(!items.length) return;

        for(const it of items){
          const p = prodById(it.productId);
          if(!p) return;
          if(p.status === 'soon') return;
          if(p.stock < it.qty) return;
        }

        for(const it of items){
          const p = prodById(it.productId);
          p.stock = Math.max(0, p.stock - it.qty);
          if(p.stock <= 0) p.status = 'out';
        }

        state.sales.push({
          id: "s_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16),
          date,
          name,
          payment,
          items
        });

        if(pre && pre.fromReservationId){
          state.reservations = (state.reservations || []).filter(x => String(x.id) !== String(pre.fromReservationId));
          markDirty({ reservations:true });
        }

        closeModal();
        renderAll();
        markDirty({ products:true, sales:true, reservations: !!(pre && pre.fromReservationId) });
      }}
    ]);
  }


  function viewSale(id){
    const s = state.sales.find(x => x.id === id);
    if(!s) return;

    const body = document.createElement("div");
    const lines = s.items.map(it => {
      const p = prodById(it.productId);
      const n = p ? (p.name_hu||p.name_en||"—") : "—";
      const f = p ? (p.flavor_hu||p.flavor_en||"") : "";
      const sum = Number(it.qty||0) * Number(it.unitPrice||0);
      return `<tr>
        <td>${escapeHtml(n)} <span class="small-muted">${escapeHtml(f? "• "+f:"")}</span></td>
        <td><b>${it.qty}</b></td>
        <td>${Number(it.unitPrice||0).toLocaleString("hu-HU")} Ft</td>
        <td><b>${sum.toLocaleString("hu-HU")} Ft</b></td>
      </tr>`;
    }).join("");

    const tot = saleTotals(s, "all").revenue;

    body.innerHTML = `
      <div class="small-muted">${escapeHtml(s.date)} • ${escapeHtml(s.name)} • ${escapeHtml(s.payment)}</div>
      <div style="margin-top:6px;font-weight:900;">Összesen: ${tot.toLocaleString("hu-HU")} Ft</div>
      <table class="table" style="margin-top:10px;">
        <thead><tr><th>Termék</th><th>Db</th><th>Egységár</th><th>Összeg</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
    `;

    openModal("Eladás", "", body, [
      { label:"Bezár", kind:"primary", onClick: closeModal }
    ]);
  }

  


  function isReservationExpired(r){
    if(!r) return true;
    if(r.confirmed) return false;
    const ex = Number(r.expiresAt || 0) || 0;
    if(!ex) return false;
    return Date.now() >= ex;
  }

  function formatRemaining(ms){
    const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const hh = String(h).padStart(2,"0");
    const mm = String(m).padStart(2,"0");
    const ss = String(s).padStart(2,"0");
    return (d > 0 ? `${d}n ` : "") + `${hh}:${mm}:${ss}`;
  }

  function reservationTotals(r){
    let qty = 0;
    let sum = 0;
    for(const it of (r.items || [])){
      const q = Number(it.qty || 0) || 0;
      const up = Number(it.unitPrice || 0) || 0;
      qty += q;
      sum += q * up;
    }
    return { qty, sum };
  }

  function renderReservationsSection(){
    const list = (state.reservations || [])
      .filter(r => r && (r.confirmed || !isReservationExpired(r)))
      .sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    if(!list.length){
      return `<div class="small-muted" style="margin:10px 0;">Nincs aktív foglalás.</div>`;
    }

    const rows = list.map(r => {
      const code = r.publicCode || "—";
      const dateTxt = r.createdAt ? new Date(Number(r.createdAt)).toLocaleString("hu-HU") : "—";
      const { qty, sum } = reservationTotals(r);

      const ex = (!r.confirmed && r.expiresAt) ? Number(r.expiresAt) : 0;
      const timerTxt = r.confirmed ? "Megerősítve" : (ex ? formatRemaining(ex - Date.now()) : "—");

      return `
        <div class="rowline table reservation-row" style="align-items:center;">
          <div class="left" style="min-width:0;">
            <div style="font-weight:950;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <span>Foglalás <b>#${escapeHtml(code)}</b></span>
              <span class="small-muted">• ${escapeHtml(dateTxt)}</span>
              <span class="small-muted">• ID: <b>${escapeHtml(r.id)}</b></span>
            </div>
            <div class="small-muted" style="margin-top:2px;">
              Tételek: <b>${qty}</b> • Összeg: <b>${Number(sum || 0).toLocaleString("hu-HU")} Ft</b>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
            ${r.confirmed ? `<span class="res-timer">—</span>` : `<span class="res-timer" data-expires="${escapeHtml(ex)}">${escapeHtml(timerTxt)}</span>`}
            <button class="ghost" data-res-edit="${escapeHtml(r.id)}">Szerkesztés</button>
            ${r.confirmed ? "" : `<button class="primary" data-res-confirm="${escapeHtml(r.id)}">Megerősítés</button>`}
            <button class="primary" data-res-sale="${escapeHtml(r.id)}">Eladás rögzítése</button>
            <button class="danger" data-res-del="${escapeHtml(r.id)}">Törlés</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div style="margin:12px 0 6px;font-weight:950;">Foglalások</div>
      ${rows}
    `;
  }

  function purgeExpiredReservations(){
    const before = (state.reservations || []).length;
    if(!before) return;
    const now = Date.now();
    const kept = (state.reservations || []).filter(r => {
      if(!r) return false;
      if(r.confirmed) return true;
      const ex = Number(r.expiresAt || 0) || 0;
      if(!ex) return true;
      return ex > now;
    });
    if(kept.length !== before){
      state.reservations = kept;
      markDirty({ reservations:true });
      renderAll();
    }
  }

  let _resTick = null;
  function startReservationTicker(){
    try{ if(_resTick) clearInterval(_resTick); }catch{}
    _resTick = setInterval(() => {
      try{ purgeExpiredReservations(); }catch{}
      document.querySelectorAll('.res-timer[data-expires]').forEach(el => {
        const ex = Number(el.dataset.expires||0) || 0;
        const ms = ex - Date.now();
        if(ms <= 0){
          el.textContent = 'LEJÁRT';
        }else{
          el.textContent = formatRemaining(ms);
        }
      });
    }, 1000);
  }

  function findReservation(id){
    return (state.reservations || []).find(r => String(r.id) === String(id));
  }

  function deleteReservation(id){
    const r = findReservation(id);
    if(!r) return;
    if(!confirm('Biztos törlöd ezt a foglalást?')) return;
    state.reservations = (state.reservations || []).filter(x => String(x.id) !== String(id));
    renderAll();
    markDirty({ reservations:true });
  }

  function confirmReservation(id){
    const r = findReservation(id);
    if(!r) return;
    r.confirmed = true;
    r.expiresAt = null;
    renderAll();
    markDirty({ reservations:true });
  }

  function reservedByOthers(pid, excludeId){
    let sum = 0;
    for(const r of (state.reservations||[])){
      if(!r) continue;
      if(String(r.id) === String(excludeId)) continue;
      if(isReservationExpired(r)) continue;
      for(const it of (r.items||[])){
        if(String(it.productId) === String(pid)) sum += Number(it.qty||0)||0;
      }
    }
    return sum;
  }

  function openReservationEditModal(id){
    const r = findReservation(id);
    if(!r) return;

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="small-muted">#${escapeHtml(r.publicCode||'---')} • ID: ${escapeHtml(r.id)}</div>
      <div class="small-muted" style="margin-top:6px;">${r.confirmed ? 'Megerősítve' : ('Lejárat: ' + (r.expiresAt ? new Date(Number(r.expiresAt)).toLocaleString('hu-HU') : '—'))}</div>
      <div class="field" style="margin-top:12px;">
        <label>Tételek</label>
        <div id="r_items"></div>
      </div>
      <div class="actions">
        <button class="ghost" id="btnAddResItem">+ Tétel</button>
      </div>
    `;

    const itemsRoot = body.querySelector('#r_items');


const addRow = (pref) => {
  const row = document.createElement('div');
  row.className = 'rowline table';
  row.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%;">
      <img class="it-thumb" alt="" />
      <button type="button" class="it-pick-btn it_pick">Válassz terméket…</button>
      <input type="hidden" class="it_prod" value="">
      <input class="it_qty" type="number" min="1" value="1" style="width:110px;">
      <button class="danger it_del" type="button">Töröl</button>
    </div>
  `;

  const pidInp = row.querySelector('.it_prod');
  const pickBtn = row.querySelector('.it_pick');
  const qtyInp = row.querySelector('.it_qty');
  const thumb = row.querySelector('.it-thumb');

  const syncThumb = (p) => {
    const img = p && (p.image||'').trim();
    if(!thumb) return;
    if(img){
      thumb.src = img;
      thumb.style.visibility = 'visible';
    }else{
      thumb.removeAttribute('src');
      thumb.style.visibility = 'hidden';
    }
  };

  const applyPid = (pid) => {
    pidInp.value = String(pid || '');
    const p = prodById(pidInp.value);
    pickBtn.textContent = p ? prodLabel(p) : 'Válassz terméket…';
    syncThumb(p);
  };

  pickBtn.onclick = async () => {
    const pid = await openProductPicker({ title: "Válassz terméket" });
    if(pid) applyPid(pid);
  };

  row.querySelector('.it_del').onclick = () => row.remove();

  if(pref && pref.productId){
    applyPid(pref.productId);
    qtyInp.value = String(Math.max(1, Number(pref.qty||1)||1));
  }else{
    applyPid('');
  }

  itemsRoot.appendChild(row);
};

    for(const it of (r.items||[])) addRow({ productId: it.productId, qty: it.qty });
    body.querySelector('#btnAddResItem').onclick = () => addRow();

    openModal('Foglalás szerkesztése', 'Tételek módosítása', body, [
      { label:'Mégse', kind:'ghost', onClick: closeModal },
      { label:'Mentés', kind:'primary', onClick: () => {
        const rows = [...itemsRoot.querySelectorAll('.rowline')];
        const items = [];
        for(const rr of rows){
          const pid = rr.querySelector('.it_prod').value;
          if(!pid) continue;
          const qty = Math.max(1, Number(rr.querySelector('.it_qty').value||1));
          const p = prodById(pid);
          if(!p || p.status === 'soon') return;
          items.push({ productId: pid, qty, unitPrice: effectivePrice(p) });
        }
        if(!items.length) return;

        for(const it of items){
          const p = prodById(it.productId);
          const other = reservedByOthers(it.productId, r.id);
          if((Number(p.stock||0) - other) < it.qty){
            alert('Nincs elég raktárkészlet ehhez a módosításhoz.');
            return;
          }
        }

        r.items = items;
        r.modified = true;
        r.modifiedAt = Date.now();
        closeModal();
        renderAll();
        markDirty({ reservations:true });
      }}
    ]);
  }

  function saleFromReservation(id){
    const r = findReservation(id);
    if(!r) return;
    const preItems = (r.items||[]).map(it => ({ productId: it.productId, qty: it.qty, unitPrice: it.unitPrice }));
    openSaleModal({
      title: `Eladás rögzítése (foglalás #${r.publicCode||'---'})`,
      date: todayISO(),
      name: '',
      payment: '',
      items: preItems,
      fromReservationId: r.id
    });
  }
function deleteSale(id){
    const idx = state.sales.findIndex(x => x.id === id);
    if(idx < 0) return;
    const s = state.sales[idx];

    // rollback stock
    for(const it of s.items){
      const p = prodById(it.productId);
      if(!p) continue;
      p.stock = Math.max(0, Number(p.stock||0) + Number(it.qty||0));
      if(p.stock > 0 && p.status === "out") p.status = "ok";
    }

    state.sales.splice(idx, 1);
    renderAll();
    markDirty({ products:true, sales:true });
  }

  function renderChartPanel(){
  const cats = [{id:"all", label:"Mind"}, ...state.doc.categories.map(c=>({id:c.id,label:c.label_hu||c.id}))];

  $("#panelChart").innerHTML = `
    <div class="actions table" style="align-items:center;justify-content:space-between;gap:12px;">
      <div class="small-muted">Bevétel diagrammok (eladások alapján)</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        <div class="small-muted">Kategória:</div>
        <select id="chartCat">
          ${cats.map(c => `<option value="${escapeHtml(c.id)}"${c.id===state.filters.chartCat?" selected":""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="kpi" style="margin-top:10px;">
      <div class="box" style="min-width:170px;">
        <div class="t">Összesen</div>
        <div class="v" id="kpi_all">0 Ft</div>
      </div>
      <div class="box" style="min-width:170px;">
        <div class="t">Év</div>
        <div class="v" id="kpi_year">0 Ft</div>
      </div>
      <div class="box" style="min-width:170px;">
        <div class="t">Hónap</div>
        <div class="v" id="kpi_month">0 Ft</div>
      </div>
      <div class="box" style="min-width:170px;">
        <div class="t">Hét</div>
        <div class="v" id="kpi_week">0 Ft</div>
      </div>
      <div class="box" style="min-width:170px;">
        <div class="t">Ma</div>
        <div class="v" id="kpi_day">0 Ft</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Összesen</div>
          <div class="small-muted">Havi bontás (teljes időszak)</div>
        </div>
      </div>
      <canvas id="revAll" height="220"></canvas>
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Évi</div>
          <div class="small-muted">Havi bontás (idén)</div>
        </div>
      </div>
      <canvas id="revYear" height="220"></canvas>
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Havi</div>
          <div class="small-muted">Napi bontás (ebben a hónapban)</div>
        </div>
      </div>
      <canvas id="revMonth" height="220"></canvas>
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Heti</div>
          <div class="small-muted">Napi bontás (utolsó 7 nap)</div>
        </div>
      </div>
      <canvas id="revWeek" height="220"></canvas>
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Napi</div>
          <div class="small-muted">Ma + tegnap</div>
        </div>
      </div>
      <canvas id="revDay" height="220"></canvas>
    </div>
  `;

  $("#chartCat").onchange = () => {
    state.filters.chartCat = $("#chartCat").value;
    drawChart();
  };

  drawChart();
}




  /* ---------- Popups (Új termékek) ---------- */
  function renderPopups(){
    const panel = $("#panelPopups");
    if(!panel) return;

    const popups = [...(state.doc.popups||[])].sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));

    const rows = popups.map(pp => {
      const cats = (pp.categoryIds||[]).map(id => (catById(id)?.label_hu || id)).join(", ");
      const prods = (pp.productIds||[]).length;
      return `
        <div class="rowline table">
          <div class="left">
            <div style="font-weight:900;">${escapeHtml(pp.title_hu || "Új termékek")} <span class="small-muted">• ID: <b>${escapeHtml(pp.id)}</b></span></div>
            <div class="small-muted">Kategóriák: <b>${escapeHtml(cats || "—")}</b> • Kézi termékek: <b>${prods}</b> • Rev: <b>${Number(pp.rev||0)}</b></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label class="chk"><input type="checkbox" data-pp="${escapeHtml(pp.id)}" data-k="enabled"${pp.enabled===false?"":" checked"}> Aktív</label>
            <button class="ghost" data-editpp="${escapeHtml(pp.id)}">Szerkeszt</button>
            <button class="danger" data-delpp="${escapeHtml(pp.id)}">Töröl</button>
          </div>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="actions">
        <button class="primary" id="btnAddPopup">+ Új pop-up</button>
        <div class="small-muted">Pop-up-ok: sorrend = létrehozás szerint (legújabb elöl). "Ne mutasd többször" a public oldalon popup ID + rev alapján működik.</div>
      </div>
      <div style="margin-top:10px;">${rows || `<div class="small-muted">Nincs pop-up.</div>`}</div>
    `;

    $("#btnAddPopup").onclick = () => openPopupModal(null);

    panel.querySelectorAll('input[data-pp][data-k="enabled"]').forEach(ch => {
      ch.addEventListener("change", () => {
        const id = ch.dataset.pp;
        const pp = (state.doc.popups||[]).find(x=>x.id===id);
        if(!pp) return;
        pp.enabled = !!ch.checked;
        pp.updatedAt = Date.now();
        pp.rev = Date.now();
        markDirty({ products:true });
      });
    });

    panel.querySelectorAll("button[data-editpp]").forEach(b => b.onclick = () => openPopupModal(b.dataset.editpp));
    panel.querySelectorAll("button[data-delpp]").forEach(b => b.onclick = () => {
      const id = b.dataset.delpp;
      const pp = (state.doc.popups||[]).find(x=>x.id===id);
      if(!pp) return;
      const body = document.createElement("div");
      body.innerHTML = `<div class="small-muted">Biztos törlöd ezt a pop-upot? ID: <b>${escapeHtml(id)}</b></div>`;
      openModal("Pop-up törlése", "", body, [
        {label:"Mégse", kind:"ghost", onClick: closeModal},
        {label:"Törlés", kind:"danger", onClick: () => {
          state.doc.popups = (state.doc.popups||[]).filter(x=>x.id!==id);
          closeModal();
          renderPopups();
          markDirty({ products:true });
        }}
      ]);
    });
  }

  function openPopupModal(id){
    const editing = id ? (state.doc.popups||[]).find(x=>x.id===id) : null;
    const pp = editing ? {...editing} : {
      id: "popup_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16),
      enabled: true,
      rev: Date.now(),
      title_hu: "Új termékek elérhetőek",
      title_en: "Új termékek elérhetőek",
      categoryIds: [],
      productIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // ✅ EN nem kell külön – legyen ugyanaz
    pp.title_en = pp.title_en || pp.title_hu || "";

    const body = document.createElement("div");
    const cats = [...state.doc.categories].sort((a,b)=>(a.label_hu||a.id).localeCompare((b.label_hu||b.id),"hu"));
    const catMap = new Map(cats.map(c => [String(c.id), c]));

    // ✅ POPUP TERMÉKEK RENDEZETTEN: kategória > név > íz
    const prods = [...state.doc.products].sort((a,b) => {
      // Kategória szerint
      const catA = catMap.get(String(a.categoryId||""))?.label_hu || "";
      const catB = catMap.get(String(b.categoryId||""))?.label_hu || "";
      if (catA !== catB) return catA.localeCompare(catB, "hu");
      
      // Név szerint
      const nameA = a.name_hu || a.name_en || "";
      const nameB = b.name_hu || b.name_en || "";
      if (nameA !== nameB) return nameA.localeCompare(nameB, "hu");
      
      // Íz szerint
      const flavorA = a.flavor_hu || a.flavor_en || "";
      const flavorB = b.flavor_hu || b.flavor_en || "";
      return flavorA.localeCompare(flavorB, "hu");
    });

    body.innerHTML = `
      <div class="form-grid">
        <div class="field third"><label>ID</label><input id="pp_id" value="${escapeHtml(pp.id)}" ${editing?"disabled":""}></div>
        <div class="field third"><label>Aktív</label><label class="chk"><input type="checkbox" id="pp_enabled" ${pp.enabled===false?"":"checked"}> Bekapcsolva</label></div>
        <div class="field third"><label>Rev (auto)</label><input id="pp_rev" value="${Number(pp.rev||0)}" disabled></div>

        <div class="field third"><label>Cím</label><input id="pp_thu" value="${escapeHtml(pp.title_hu||"")}"></div>
        <div class="field third"><label></label><div class="small-muted">Mentéskor rev frissül → újra feldobható.</div></div>
        <div class="field third"><label></label></div>

        <div class="field full"><label>Kategóriák (ha bejelölöd: az összes termék abból a kategóriából)</label>
          <div class="check-grid">
            ${cats.map(c => `
              <label class="chk"><input type="checkbox" class="pp_cat" value="${escapeHtml(c.id)}"${(pp.categoryIds||[]).includes(c.id)?" checked":""}> ${escapeHtml(c.label_hu||c.id)}</label>
            `).join("")}
          </div>
        </div>

        <div class="field full"><label>Kézi termékek (opcionális)</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
            <input id="pp_search" placeholder="Keresés..." style="flex:1;min-width:240px;">
            <select id="pp_catfilter" style="width:240px;">
              <option value="all">Összes kategória</option>
              ${cats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label_hu||c.id)}</option>`).join("")}
            </select>
          </div>

          <div class="check-grid" id="pp_prod_list">
            ${prods.map(p => {
              const cid = String(p.categoryId||"");
              const c = catMap.get(cid);
              const cname = c ? (c.label_hu||c.id) : cid;
              return `
                <label class="chk" data-cat="${escapeHtml(cid)}" style="display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" class="pp_prod" value="${escapeHtml(p.id)}"${(pp.productIds||[]).includes(p.id)?" checked":""}>
                    <div>
                      <div style="font-weight:bold;">${escapeHtml(p.name_hu||p.name_en||"—")}</div>
                      <div style="font-size:12px;color:var(--muted);">${escapeHtml(p.flavor_hu||p.flavor_en||"")}</div>
                    </div>
                  </div>
                  <div style="font-size:11px;color:var(--brand2);margin-top:4px;">[${escapeHtml(cname||"—")}]</div>
                </label>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    // filter (search + category)
    setTimeout(() => {
      const inp = $("#pp_search");
      const sel = $("#pp_catfilter");
      const list = $("#pp_prod_list");
      if(!inp || !sel || !list) return;

      const apply = () => {
        const q = (inp.value||"").toLowerCase().trim();
        const cf = String(sel.value||"all");
        list.querySelectorAll("label.chk").forEach(lab => {
          const txt = (lab.textContent||"").toLowerCase();
          const cat = String(lab.getAttribute("data-cat")||"");
          const ok = (!q || txt.includes(q)) && (cf==="all" || cat===cf);
          lab.style.display = ok ? "" : "none";
        });
      };

      inp.oninput = apply;
      sel.onchange = apply;
      apply();
    }, 0);

    openModal(editing ? "Popup szerkesztése" : "Új popup", "", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const nid = ($("#pp_id").value||"").trim();
        if(!nid) return;

        const title = ($("#pp_thu").value||"").trim() || "Új termékek elérhetőek";

        const next = {
          id: nid,
          enabled: !!$("#pp_enabled").checked,
          title_hu: title,
          title_en: title, // ✅ EN nem kell külön
          categoryIds: Array.from(document.querySelectorAll(".pp_cat:checked")).map(x=>String(x.value)),
          productIds: Array.from(document.querySelectorAll(".pp_prod:checked")).map(x=>String(x.value)),
          createdAt: editing ? Number(editing.createdAt||Date.now()) : Date.now(),
          updatedAt: Date.now(),
          rev: Date.now()
        };

        if(editing){
          state.doc.popups = (state.doc.popups||[]).map(x => x.id===editing.id ? next : x);
        }else{
          state.doc.popups = [...(state.doc.popups||[]), next];
        }

        closeModal();
        renderAll();
        markDirty({ products:true });
      }}
    ]);
  }

function drawChart(){
  const cat = state.filters.chartCat || "all";

  const css = getComputedStyle(document.documentElement);
  const accent = (css.getPropertyValue("--brand2") || "#4aa3ff").trim();
  const grid = "rgba(255,255,255,.08)";
  const text = "rgba(255,255,255,.82)";
  const muted = "rgba(255,255,255,.55)";

  const fmtFt = (n) => `${Math.round(n).toLocaleString("hu-HU")} Ft`;

  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  };
  const parseISO = (s) => new Date(`${s}T00:00:00`);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };

  const today = new Date();
  const todayIso = iso(today);
  const yearStartIso = `${today.getFullYear()}-01-01`;
  const monthStartIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-01`;

  const dayMap = new Map(); // iso -> revenue
  let allTotal = 0, yearTotal = 0, monthTotal = 0, weekTotal = 0, dayTotal = 0;

  const dYearStart = parseISO(yearStartIso);
  const dMonthStart = parseISO(monthStartIso);
  const dWeekStart = addDays(today, -6); // utolsó 7 nap

  for(const s of (state.sales || [])){
    const dt = String(s.date || "").slice(0,10);
    if(!dt) continue;

    const tot = saleTotals(s, cat);
    const rev = Number(tot.revenue || 0);
    if(!rev) continue;

    dayMap.set(dt, (dayMap.get(dt) || 0) + rev);

    allTotal += rev;

    const d = parseISO(dt);
    if(d >= dYearStart) yearTotal += rev;
    if(d >= dMonthStart) monthTotal += rev;
    if(d >= parseISO(iso(dWeekStart))) weekTotal += rev;
    if(dt === todayIso) dayTotal += rev;
  }

  const setKpi = (id, val) => { const el = $(id); if(el) el.textContent = fmtFt(val); };
  setKpi("#kpi_all", allTotal);
  setKpi("#kpi_year", yearTotal);
  setKpi("#kpi_month", monthTotal);
  setKpi("#kpi_week", weekTotal);
  setKpi("#kpi_day", dayTotal);

  const buildDailySeries = (startIso, endIso) => {
    const s = parseISO(startIso);
    const e = parseISO(endIso);
    const arr = [];
    for(let d = new Date(s); d <= e; d = addDays(d,1)){
      const key = iso(d);
      arr.push({ label: key, rev: Number(dayMap.get(key) || 0) });
    }
    return arr;
  };

  const buildMonthlySeries = (startIso, endIso) => {
    const s = parseISO(startIso);
    const e = parseISO(endIso);
    const m = new Map(); // YYYY-MM -> rev
    for(const [k, v] of dayMap.entries()){
      const d = parseISO(k);
      if(d < s || d > e) continue;
      const ym = k.slice(0,7);
      m.set(ym, (m.get(ym) || 0) + Number(v||0));
    }
    // ensure continuous months
    const arr = [];
    const cur = new Date(s);
    cur.setDate(1);
    const end = new Date(e);
    end.setDate(1);
    while(cur <= end){
      const ym = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}`;
      arr.push({ label: ym, rev: Number(m.get(ym) || 0) });
      cur.setMonth(cur.getMonth()+1);
    }
    return arr;
  };

  const drawLine = (canvas, points) => {
    if(!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    const padL = 44, padR = 14, padT = 18, padB = 32;
    const pw = Math.max(1, w - padL - padR);
    const ph = Math.max(1, h - padT - padB);

    const max = Math.max(1, ...points.map(p=>Number(p.rev||0)));
    const n = points.length;

    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    for(let i=0;i<=4;i++){
      const y = padT + (ph * i/4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + pw, y);
      ctx.stroke();
    }

    // y labels
    ctx.fillStyle = muted;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for(let i=0;i<=4;i++){
      const v = Math.round(max * (1 - i/4));
      const y = padT + (ph * i/4);
      ctx.fillText(fmtFt(v).replace(" Ft",""), padL - 8, y);
    }

    const xAt = (i) => {
      if(n <= 1) return padL + pw/2;
      return padL + (pw * (i/(n-1)));
    };
    const yAt = (v) => padT + ph - (ph * (Number(v||0)/max));

    // line
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p,i)=>{
      const x = xAt(i);
      const y = yAt(p.rev);
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // points
    ctx.fillStyle = accent;
    points.forEach((p,i)=>{
      const x = xAt(i);
      const y = yAt(p.rev);
      ctx.beginPath();
      ctx.arc(x,y,3.2,0,Math.PI*2);
      ctx.fill();
    });

    // x labels (first, middle, last)
    ctx.fillStyle = text;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const labels = [];
    if(n === 1){
      labels.push({i:0, t: points[0].label});
    }else if(n === 2){
      labels.push({i:0, t: points[0].label});
      labels.push({i:1, t: points[1].label});
    }else{
      labels.push({i:0, t: points[0].label});
      labels.push({i:Math.floor((n-1)/2), t: points[Math.floor((n-1)/2)].label});
      labels.push({i:n-1, t: points[n-1].label});
    }

    labels.forEach(o=>{
      const t = String(o.t || "");
      ctx.fillText(t, xAt(o.i), padT + ph + 10);
    });
  };

  // ranges
  const allDates = [...dayMap.keys()].sort();
  const allStart = allDates[0] || todayIso;
  const allEnd = allDates[allDates.length-1] || todayIso;

  const seriesAll = buildMonthlySeries(allStart, allEnd);
  const seriesYear = buildMonthlySeries(yearStartIso, todayIso);
  const seriesMonth = buildDailySeries(monthStartIso, todayIso);
  const seriesWeek = buildDailySeries(iso(addDays(today, -6)), todayIso);
  const seriesDay = buildDailySeries(iso(addDays(today, -1)), todayIso);

  drawLine($("#revAll"), seriesAll);
  drawLine($("#revYear"), seriesYear);
  drawLine($("#revMonth"), seriesMonth);
  drawLine($("#revWeek"), seriesWeek);
  drawLine($("#revDay"), seriesDay);
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

    // reservation expiry ticker (safe even before load)
    startReservationTicker();

    // Cart -> Sale (iframe) bridge
    window.addEventListener("message", (ev)=>{
      const d = ev && ev.data;
      if(!d || d.type !== "sv_admin_cart_sale") return;
      const items = Array.isArray(d.items) ? d.items : [];
      if(!items.length) return;
      try{ document.querySelector('#tabs button[data-tab="sales"]')?.click(); }catch{}
      openSaleModal({ items });
    });

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