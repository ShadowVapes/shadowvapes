(() => {
  const $ = (s) => document.querySelector(s);

  const LS = {
    owner: "sv_owner",
    repo: "sv_repo",
    branch: "sv_branch",
    token: "sv_token",
  };

  const state = {
    doc: { categories: [], products: [], popups: [] },
    sales: [],
    loaded: false,
    saving: false,
    saveQueued: false,
    dirty: false,
    dirtyProducts: false,
    dirtySales: false,
    saveTimer: null,
    shas: { products: null, sales: null },
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
    const cur = readLock();
    if(lockValid(cur) && cur.id !== state.clientId) return false;
    localStorage.setItem(LOCK_KEY, JSON.stringify({ id: state.clientId, ts: Date.now() }));
    return true;
  }
  function releaseLock(){
    const cur = readLock();
    if(cur && cur.id === state.clientId) localStorage.removeItem(LOCK_KEY);
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
    if(!Array.isArray(state.sales)) state.sales = [];

    state.doc.categories = state.doc.categories
      .filter(c => c && c.id)
      .map(c => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id,
        featuredEnabled: (c.featuredEnabled === false) ? false : true,
        basePrice: Number(c.basePrice || 0)
      }));

    state.doc.products = state.doc.products.map(p => ({
      id: String(p.id || ""),
      categoryId: String(p.categoryId || ""),
      status: (p.status === "ok" || p.status === "out" || p.status === "soon") ? p.status : "ok",
      stock: Math.max(0, Number(p.stock || 0)),
      // price lehet null/üres => kategória alapár
      price: (p.price === "" || p.price === null || p.price === undefined) ? null : Number(p.price || 0),
      image: p.image || "",
      visible: (p.visible === false) ? false : true,
      name_hu: p.name_hu || "",
      name_en: p.name_en || "",
      flavor_hu: p.flavor_hu || "",
      flavor_en: p.flavor_en || ""
    })).filter(p => p.id);

    // Popups normalize (külön fülön szerkeszthető)
    if(!Array.isArray(state.doc.popups)) state.doc.popups = [];
    state.doc.popups = state.doc.popups
      .filter(x => x && (x.id || x.title_hu || x.title_en || x.title))
      .map(x => {
        const id = String(x.id || ("pu_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16)));
        const updatedAt = Number(x.updatedAt || x.rev || Date.now());
        const createdAt = Number(x.createdAt || x.rev || updatedAt || Date.now());
        const rev = Number(x.rev || updatedAt || Date.now());
        const catIds = Array.isArray(x.categoryIds) ? x.categoryIds.map(v => String(v)) : [];
        const prodIds = Array.isArray(x.productIds) ? x.productIds.map(v => String(v)) : [];
        return {
          id,
          enabled: (x.enabled === false) ? false : true,
          rev,
          title_hu: String(x.title_hu || x.title || ""),
          title_en: String(x.title_en || x.title_hu || x.title || ""),
          categoryIds: catIds.filter(Boolean),
          productIds: prodIds.filter(Boolean),
          createdAt,
          updatedAt
        };
      })
      .filter(x => x.id);

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
    // branch fallback main/master automatikusan, ha “No commit found for the ref ...”
    const branchesToTry = [cfg.branch, "main", "master"].filter((v,i,a)=> v && a.indexOf(v)===i);

    let lastErr = null;
    for(const br of branchesToTry){
      try{
        const p = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/products.json" });
        const s = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/sales.json" });
        const doc = JSON.parse(p.content);
        const sales = JSON.parse(s.content);

        cfg.branch = br;
        saveCfg(cfg);

        state.doc = doc;
        state.sales = sales;
        state.shas.products = p.sha;
        state.shas.sales = s.sha;
        normalizeDoc();
    state.doc.updatedAt = Date.now();
        state.loaded = true;

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
    state.doc.updatedAt = Date.now();

    for(const p of (state.doc.products||[])){
      if(p && p.status === "out") p.stock = 0;
      if(p && (!p.name_en || String(p.name_en).trim()==="")) p.name_en = p.name_hu || "";
    }
    const productsText = JSON.stringify(state.doc, null, 2);
    const salesText = JSON.stringify(state.sales, null, 2);

    
let ok = false;
const wantProducts = !!(state.dirtyProducts || state.dirtySales);
const wantSales = !!state.dirtySales;

try{
  // SHA csak akkor kell, ha még nincs meg (a putFileSafe úgyis frissít konflikt esetén)
  if(wantProducts && !state.shas.products){
    const pOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/products.json" });
    state.shas.products = pOld.sha;
  }
  if(wantSales && !state.shas.sales){
    const sOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/sales.json" });
    state.shas.sales = sOld.sha;
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



  // ✅ sv_source.json (custom domain + telefon): a public oldal ebből találja meg a RAW forrást
  try{
    const srcObj = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch };
    const srcText = JSON.stringify(srcObj, null, 2);
    const prev = localStorage.getItem("sv_source_json") || "";
    if(prev !== srcText){
      localStorage.setItem("sv_source_json", srcText);
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
    state.saveTimer = setTimeout(() => {
      saveDataNow();
    }, 320);
  }

  /* ---------- Rendering ---------- */
  function renderTabs(){
    $("#tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if(!b) return;
      $("#tabs").querySelectorAll("button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");

          const tab = b.dataset.tab;

    const panels = {
      products: $("#panelProducts"),
      categories: $("#panelCategories"),
      sales: $("#panelSales"),
      chart: $("#panelChart"),
      popups: $("#panelPopups"),
      settings: $("#panelSettings"),
    };

    for(const [k, el] of Object.entries(panels)){
      if(!el) continue;
      el.style.display = (tab === k) ? "block" : "none";
    }

    if(tab === "chart") drawChart();
    if(tab === "popups") renderPopups();
  });
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
  }

  function renderCategories(){
    const cats = [...state.doc.categories].sort((a,b)=> (a.label_hu||a.id).localeCompare(b.label_hu||b.id,"hu"));

    let rows = cats.map(c => `
      <tr>
        <td><b>${escapeHtml(c.id)}</b></td>
        <td><input data-cid="${escapeHtml(c.id)}" data-k="label_hu" value="${escapeHtml(c.label_hu)}"></td>
        <td><input data-cid="${escapeHtml(c.id)}" data-k="label_en" value="${escapeHtml(c.label_en)}"></td>
        <td style="width:160px;"><input data-cid="${escapeHtml(c.id)}" data-k="basePrice" type="number" min="0" value="${Number(c.basePrice||0)}"></td>
        <td style="width:140px;">
          <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" data-cid="${escapeHtml(c.id)}" data-k="featuredEnabled" ${c.featuredEnabled!==false ? "checked":""}>
            Felkapott
          </label>
        </td>
        <td style="width:110px;"><button class="danger" data-delcat="${escapeHtml(c.id)}">Töröl</button></td>
      </tr>
    `).join("");

    $("#panelCategories").innerHTML = `
      <div class="actions">
        <button class="primary" id="btnAddCat">+ Kategória</button>
        <div class="small-muted">Ha terméknél az ár üres/null → kategória alap árát használja. A “Felkapott” kapcsoló: ha OFF, abban a kategóriában nem jelenik meg felkapott termék (ha nincs eladás, úgysem lesz).</div>
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
          <div class="field third"><label>EN</label><input id="newCen" placeholder="ELF"></div>
          <div class="field third"><label>Alap ár</label><input id="newCprice" type="number" min="0" value="0"></div>
          <div class="field full" style="display:flex;gap:10px;align-items:center;">
            <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
              <input id="newCfeat" type="checkbox" checked> Felkapott engedélyezve ennél a kategóriánál
            </label>
          </div>
        </div>
      `;
      openModal("Új kategória", "", body, [
        { label:"Mégse", kind:"ghost", onClick: closeModal },
        { label:"Létrehozás", kind:"primary", onClick: () => {
          const id = ($("#newCid").value||"").trim();
          if(!id) return;
          if(state.doc.categories.some(x => x.id === id)) return;
          state.doc.categories.push({
            id,
            label_hu: ($("#newChu").value||"").trim() || id,
            label_en: ($("#newCen").value||"").trim() || ($("#newChu").value||"").trim() || id,
            basePrice: Math.max(0, Number($("#newCprice").value||0)),
            featuredEnabled: !!$("#newCfeat").checked
          });
          closeModal();
          renderAll();
          markDirty({ products:true });
        }}
      ]);
    };

    $("#panelCategories").querySelectorAll("input[data-cid]").forEach(inp => {
      const handler = () => {
        const id = inp.dataset.cid;
        const k = inp.dataset.k;
        const c = catById(id);
        if(!c) return;
        if(k === "basePrice") c.basePrice = Math.max(0, Number(inp.value||0));
        else if(k === "featuredEnabled") c.featuredEnabled = !!inp.checked;
        else c[k] = inp.value;
        markDirty({ products:true });
      };
      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
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
            <div style="font-weight:900;">
              ${escapeHtml(p.name_hu||p.name_en||"—")}
              <span class="small-muted">• ${escapeHtml(p.flavor_hu||p.flavor_en||"")}</span>
              ${p.visible===false ? `<span class="badge out" style="margin-left:10px;">rejtve</span>` : ``}
            </div>
            <div class="small-muted">
              Kategória: <b>${escapeHtml(c ? (c.label_hu||c.id) : "—")}</b>
              • Ár: <b>${eff.toLocaleString("hu-HU")} Ft</b>
              • Készlet: <b>${p.status==="soon" ? "—" : p.stock}</b>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" data-pid="${escapeHtml(p.id)}" data-k="visible" ${p.visible!==false ? "checked":""}>
              Látható
            </label>
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
        <div class="small-muted">Rejtett termék nem jelenik meg a public oldalon. Out termék public oldalon leghátul.</div>
      </div>
      <div style="margin-top:10px;">${rows || `<div class="small-muted">Nincs találat.</div>`}</div>
    `;

    $("#prodCat").onchange = () => { state.filters.productsCat = $("#prodCat").value; renderProducts(); };
    $("#prodSearch").oninput = () => { state.filters.productsSearch = $("#prodSearch").value; renderProducts(); };

    $("#btnAddProd").onclick = () => openProductModal(null);

    $("#panelProducts").querySelectorAll("[data-pid]").forEach(el => {
      const handler = () => {
        const pid = el.dataset.pid;
        const k = el.dataset.k;
        const p = prodById(pid);
        if(!p) return;

        if(k === "stock") p.stock = Math.max(0, Number(el.value||0));
        else if(k === "price") p.price = (el.value === "" ? null : Math.max(0, Number(el.value||0)));
        else if(k === "status") p.status = el.value;
        else if(k === "categoryId") p.categoryId = el.value;
        else if(k === "visible") p.visible = !!el.checked;

        markDirty({ products:true });
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
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
      visible: true,
      name_hu: "",
      name_en: "",
      flavor_hu: "",
      flavor_en: ""
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

        <div class="field third"><label>Készlet</label><input id="p_stock" type="number" min="0" value="${p.stock}"></div>
        <div class="field third"><label>Ár (Ft) — üres: kategória ár</label><input id="p_price" type="number" min="0" value="${p.price===null?"":p.price}"></div>
        <div class="field full"><label>Kép URL</label><input id="p_img" value="${escapeHtml(p.image)}"></div>

        <div class="field full" style="display:flex;gap:10px;align-items:center;">
          <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
            <input id="p_visible" type="checkbox" ${p.visible!==false ? "checked":""}> Látható a public oldalon
          </label>
        </div>

        <div class="field third"><label>Termék neve</label><input id="p_name" value="${escapeHtml(p.name_hu)}"></div>
        <div class="field third"><label>Íz HU</label><input id="p_fhu" value="${escapeHtml(p.flavor_hu)}"></div>
        <div class="field third"><label>Íz EN</label><input id="p_fen" value="${escapeHtml(p.flavor_en)}"></div>
      </div>
      <div class="small-muted" style="margin-top:10px;">
        Látható: ha OFF, a public oldalon nem jelenik meg. soon → public oldalon is megjelenhet a saját kategóriájában (leghátul, out előtt). out/stock=0 → public oldalon leghátul + szürke.
      </div>
    `;

    openModal(editing ? "Termék szerkesztése" : "Új termék", "", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const np = {
          id: ($("#p_id").value||"").trim(),
          categoryId: $("#p_cat").value,
          status: $("#p_status").value,
          stock: Math.max(0, Number($("#p_stock").value||0)),
          price: ($("#p_price").value === "" ? null : Math.max(0, Number($("#p_price").value||0))),
          image: ($("#p_img").value||"").trim(),
          visible: !!($("#p_visible")?.checked),
          name_hu: ($("#p_name").value||"").trim(),
          name_en: ($("#p_name").value||"").trim(),
          flavor_hu: ($("#p_fhu").value||"").trim(),
          flavor_en: ($("#p_fen").value||"").trim()
        };
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


  function popupById(id){
    return state.doc.popups.find(p => p.id === String(id)) || null;
  }

  function renderPopups(){
    const list = [...(state.doc.popups||[])].sort((a,b)=> Number(b.updatedAt||0) - Number(a.updatedAt||0));

    const rows = list.map(pu => {
      const title = pu.title_hu || pu.title_en || "(nincs cím)";
      const cats = (pu.categoryIds||[]).length;
      const prods = (pu.productIds||[]).length;
      return `
        <div class="rowline table" style="align-items:center;">
          <div class="left">
            <div style="font-weight:900;">
              ${escapeHtml(title)}
              <span class="small-muted" style="margin-left:10px;">ID: <b>${escapeHtml(pu.id)}</b></span>
              <span class="small-muted" style="margin-left:10px;">rev: <b>${Number(pu.rev||0)}</b></span>
            </div>
            <div class="small-muted">Termékek: <b>${prods}</b> • Kategóriák: <b>${cats}</b></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" data-puid="${escapeHtml(pu.id)}" data-k="enabled" ${pu.enabled!==false ? "checked":""}>
              Aktív
            </label>
            <button class="ghost" data-editpopup="${escapeHtml(pu.id)}">Szerkeszt</button>
            <button class="danger" data-delpopup="${escapeHtml(pu.id)}">Töröl</button>
          </div>
        </div>
      `;
    }).join("");

    $("#panelPopups").innerHTML = `
      <div class="actions table" style="align-items:center;">
        <button class="primary" id="btnAddPopup">+ Új popup</button>
        <div class="small-muted">Több popup is lehet aktív: a public oldalon sorban dobja fel. “Ne mutasd többször” popup-ID + rev alapján működik (ha módosítod, újra megjelenik).</div>
      </div>
      <div style="margin-top:10px;">${rows || `<div class="small-muted">Nincs popup létrehozva.</div>`}</div>
    `;

    $("#btnAddPopup").onclick = () => openPopupModal(null);

    $("#panelPopups").querySelectorAll("input[data-puid]").forEach(inp => {
      const handler = () => {
        const id = inp.dataset.puid;
        const k = inp.dataset.k;
        const pu = popupById(id);
        if(!pu) return;
        if(k === "enabled") pu.enabled = !!inp.checked;
        pu.updatedAt = Date.now();
        pu.rev = pu.updatedAt;
        markDirty({ products:true });
        renderPopups();
      };
      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
    });

    $("#panelPopups").querySelectorAll("button[data-editpopup]").forEach(btn => {
      btn.onclick = () => openPopupModal(btn.dataset.editpopup);
    });
    $("#panelPopups").querySelectorAll("button[data-delpopup]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.delpopup;
        state.doc.popups = (state.doc.popups||[]).filter(p => p.id !== id);
        renderPopups();
        markDirty({ products:true });
      };
    });
  }

  function openPopupModal(id){
    const editing = id ? popupById(id) : null;
    const now = Date.now();

    const pu = editing ? JSON.parse(JSON.stringify(editing)) : {
      id: "pu_" + Math.random().toString(16).slice(2) + "_" + now.toString(16),
      enabled: true,
      rev: now,
      title_hu: "",
      title_en: "",
      categoryIds: [],
      productIds: [],
      createdAt: now,
      updatedAt: now
    };

    // UI state
    let pSearch = "";
    let pCat = "all";

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="form-grid">
        <div class="field third"><label>ID</label><input id="pu_id" value="${escapeHtml(pu.id)}" ${editing?"disabled":""}></div>
        <div class="field third"><label>Cím (HU)</label><input id="pu_thu" value="${escapeHtml(pu.title_hu)}" placeholder="Új termékek"></div>
        <div class="field third"><label>Cím (EN)</label><input id="pu_ten" value="${escapeHtml(pu.title_en)}" placeholder="New products"></div>
        <div class="field full" style="display:flex;gap:10px;align-items:center;">
          <label class="small-muted" style="display:flex;align-items:center;gap:8px;">
            <input id="pu_enabled" type="checkbox" ${pu.enabled!==false ? "checked":""}> Aktív popup
          </label>
        </div>
      </div>

      <div class="small-muted" style="margin-top:10px;">Kategória kijelölés: ha bejelölöd, a popupban megjelenik az összes (látható) termék abból a kategóriából.</div>
      <div id="pu_catBox" style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;"></div>

      <div style="margin-top:14px; display:grid; grid-template-columns: 1fr 340px; gap:14px; align-items:start;">
        <div>
          <div class="actions table" style="align-items:center; margin-bottom:10px;">
            <input id="pu_psearch" placeholder="Keresés termékekben…" value="" style="flex:1;min-width:220px;">
            <select id="pu_pcat" style="min-width:160px;">
              <option value="all">Összes</option>
              ${state.doc.categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label_hu||c.id)}</option>`).join("")}
            </select>
          </div>

          <div id="pu_gridWrap" style="max-height:56vh; overflow:auto; padding-right:6px;">
            <div id="pu_grid" class="pick-grid"></div>
          </div>
        </div>

        <div>
          <div class="small-muted" style="margin-bottom:10px;">Kiválasztott termékek (max ~4 látszik, görgethető):</div>
          <div id="pu_selected" class="pick-selected" style="max-height:420px; overflow:auto; padding-right:6px;"></div>
        </div>
      </div>
    `;

    openModal(editing ? "Popup szerkesztése" : "Új popup", "A public oldalon sorban dobja fel őket.", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const nid = ($("#pu_id").value||"").trim();
        if(!nid) return;
        if(!editing && state.doc.popups.some(x => x.id === nid)) return;

        pu.id = nid;
        pu.title_hu = ($("#pu_thu").value||"").trim();
        pu.title_en = ($("#pu_ten").value||"").trim();
        pu.enabled = !!$("#pu_enabled").checked;

        pu.updatedAt = Date.now();
        pu.rev = pu.updatedAt;

        // categoryIds/productIds már UI state-ből frissítve van
        if(editing){
          const idx = state.doc.popups.findIndex(x => x.id === editing.id);
          if(idx >= 0) state.doc.popups[idx] = pu;
        }else{
          state.doc.popups.push(pu);
        }

        closeModal();
        renderAll();
        markDirty({ products:true });
      }}
    ]);

    const catBox = $("#pu_catBox");
    catBox.innerHTML = state.doc.categories.map(c => {
      const on = (pu.categoryIds||[]).includes(c.id);
      return `
        <label class="badge" style="cursor:pointer;">
          <input type="checkbox" data-pucat="${escapeHtml(c.id)}" ${on?"checked":""} style="margin-right:8px;">
          ${escapeHtml(c.label_hu||c.id)}
        </label>
      `;
    }).join("");

    catBox.querySelectorAll("input[data-pucat]").forEach(ch => {
      const handler = () => {
        const cid = ch.dataset.pucat;
        const on = !!ch.checked;
        pu.categoryIds = Array.from(new Set((pu.categoryIds||[]).filter(Boolean)));
        if(on && !pu.categoryIds.includes(cid)) pu.categoryIds.push(cid);
        if(!on) pu.categoryIds = pu.categoryIds.filter(x => x !== cid);
        renderPopupPicker();
      };
      ch.addEventListener("change", handler);
      ch.addEventListener("input", handler);
    });

    $("#pu_psearch").oninput = () => { pSearch = ($("#pu_psearch").value||"").toLowerCase(); renderPopupPicker(); };
    $("#pu_pcat").onchange = () => { pCat = $("#pu_pcat").value; renderPopupPicker(); };

    function renderPopupPicker(){
      const selected = new Set(pu.productIds||[]);

      // Selected preview
      const selWrap = $("#pu_selected");
      const selList = (pu.productIds||[])
        .map(id => prodById(id))
        .filter(Boolean);

      selWrap.innerHTML = selList.map(p => {
        const eff = effectivePrice(p);
        const status = p.status || "ok";
        const cls = "card " + (status==="out" ? "dim out" : (status==="soon" ? "soon" : ""));
        return `
          <div class="${cls}" style="margin-bottom:10px; max-width:320px;">
            <div class="hero"><img src="${escapeHtml(p.image||"")}" alt=""></div>
            <div class="card-body">
              <div style="font-weight:900;">${escapeHtml(p.name_hu||p.name_en||"")}</div>
              <div class="small-muted">${escapeHtml(p.flavor_hu||p.flavor_en||"")}</div>
              <div class="meta-row">
                <div class="price">${eff.toLocaleString("hu-HU")} Ft</div>
                <div class="stock">Készlet: <b>${status==="soon" ? "—" : p.stock}</b></div>
              </div>
              <button class="danger" data-unpick="${escapeHtml(p.id)}" style="width:100%; margin-top:10px;">Kivesz</button>
            </div>
          </div>
        `;
      }).join("") || `<div class="small-muted">Még nincs kiválasztva.</div>`;

      selWrap.querySelectorAll("button[data-unpick]").forEach(b => {
        b.onclick = () => {
          const id = b.dataset.unpick;
          pu.productIds = (pu.productIds||[]).filter(x => x !== id);
          renderPopupPicker();
        };
      });

      // Build full list: category-filtered + search
      let all = [...state.doc.products];
      if(pCat !== "all"){
        all = all.filter(p => p.categoryId === pCat);
      }
      if(pSearch){
        all = all.filter(p => (`${p.name_hu} ${p.name_en} ${p.flavor_hu} ${p.flavor_en}`).toLowerCase().includes(pSearch));
      }
      // sort: ok/soon/out, then name/flavor
      const r = (s) => s==="ok"?0:(s==="soon"?1:2);
      all.sort((a,b)=>{
        const ra=r(a.status), rb=r(b.status);
        if(ra!==rb) return ra-rb;
        return (`${a.name_hu||a.name_en||""} ${a.flavor_hu||a.flavor_en||""}`).localeCompare(`${b.name_hu||b.name_en||""} ${b.flavor_hu||b.flavor_en||""}`,"hu");
      });

      $("#pu_grid").innerHTML = all.map(p => {
        const eff = effectivePrice(p);
        const status = p.status || "ok";
        const isSel = selected.has(p.id);
        const cls = "card pick-card " + (isSel ? "selected " : "") + (status==="out" ? "dim out" : (status==="soon" ? "soon" : ""));
        return `
          <div class="${cls}" data-pick="${escapeHtml(p.id)}" style="min-width:220px;">
            <div class="hero">
              <img src="${escapeHtml(p.image||"")}" alt="">
              <div class="badges">
                ${p.visible===false ? `<span class="badge out">rejtve</span>` : ``}
                ${status==="soon" ? `<span class="badge soon">hamarosan</span>` : ``}
                ${status==="out" ? `<span class="badge out">elfogyott</span>` : ``}
              </div>
              <div class="overlay-title">
                <div class="name">${escapeHtml(p.name_hu||p.name_en||"")}</div>
                <div class="flavor">${escapeHtml(p.flavor_hu||p.flavor_en||"")}</div>
              </div>
            </div>
            <div class="card-body">
              <div class="meta-row">
                <div class="price">${eff.toLocaleString("hu-HU")} Ft</div>
                <div class="stock">Készlet: <b>${status==="soon" ? "—" : p.stock}</b></div>
              </div>
              <div class="small-muted">${isSel ? "Kiválasztva ✅" : "Kattints a kijelöléshez"}</div>
            </div>
          </div>
        `;
      }).join("");

      $("#pu_grid").querySelectorAll("[data-pick]").forEach(el => {
        el.onclick = () => {
          const id = el.dataset.pick;
          const set = new Set(pu.productIds||[]);
          if(set.has(id)) set.delete(id); else set.add(id);
          pu.productIds = Array.from(set);
          renderPopupPicker();
        };
      });
    }

    renderPopupPicker();
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
      <div class="actions table" style="align-items:center;">
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
  }

  function openSaleModal(){
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="form-grid">
        <div class="field third"><label>Dátum (YYYY-MM-DD)</label><input id="s_date" value="${todayISO()}"></div>
        <div class="field third"><label>Név</label><input id="s_name" placeholder="pl. Tesó"></div>
        <div class="field third"><label>Vásárlás módja</label><input id="s_pay" placeholder="pl. készpénz / utalás / bármi"></div>
        <div class="field full"><label>Tételek</label><div id="s_items"></div></div>
      </div>
      <div class="actions">
        <button class="ghost" id="btnAddItem">+ Tétel</button>
      </div>
      <div class="small-muted">Mentéskor levonja a stockot, törléskor visszaadja (rollback).</div>
    `;

    const itemsRoot = body.querySelector("#s_items");

    const addItemRow = () => {
      const row = document.createElement("div");
      // a CSS input/select stílus a .table alatt él, ezért kap pluszban table osztályt
      row.className = "rowline table";
      row.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%;">
          <select class="it_prod" style="min-width:280px;">
            <option value="">Válassz terméket…</option>
            ${state.doc.products.filter(p=>p.status!=="soon").map(p=>{
              const n = p.name_hu || p.name_en || "—";
              const f = p.flavor_hu || p.flavor_en || "";
              const stock = p.stock;
              return `<option value="${escapeHtml(p.id)}">${escapeHtml(n + (f? " • "+f:"") + ` (stock:${stock})`)}</option>`;
            }).join("")}
          </select>
          <input class="it_qty" type="number" min="1" value="1" style="width:110px;">
          <input class="it_price" type="number" min="0" value="0" style="width:150px;">
          <button class="danger it_del" type="button">Töröl</button>
        </div>
      `;

      const sel = row.querySelector(".it_prod");
      const price = row.querySelector(".it_price");

      sel.onchange = () => {
        const p = prodById(sel.value);
        price.value = String(p ? effectivePrice(p) : 0);
      };
      row.querySelector(".it_del").onclick = () => row.remove();

      itemsRoot.appendChild(row);
    };

    addItemRow();
    body.querySelector("#btnAddItem").onclick = addItemRow;

    openModal("Új eladás", "Név + dátum + mód + több termék", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const date = ($("#s_date").value||"").trim();
        const name = ($("#s_name").value||"").trim();
        const payment = ($("#s_pay").value||"").trim();

        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

        const rows = [...itemsRoot.querySelectorAll(".rowline")];
        const items = [];
        for(const r of rows){
          const pid = r.querySelector(".it_prod").value;
          if(!pid) continue;
          const qty = Math.max(1, Number(r.querySelector(".it_qty").value||1));
          const unitPrice = Math.max(0, Number(r.querySelector(".it_price").value||0));
          items.push({ productId: pid, qty, unitPrice });
        }
        if(!items.length) return;

        // stock check
        for(const it of items){
          const p = prodById(it.productId);
          if(!p) return;
          if(p.status === "soon") return;
          if(p.stock < it.qty) return;
        }

        // apply stock
        for(const it of items){
          const p = prodById(it.productId);
          p.stock = Math.max(0, p.stock - it.qty);
          if(p.stock <= 0) p.status = "out";
        }

        state.sales.push({
          id: "s_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16),
          date,
          name,
          payment,
          items
        });

        closeModal();
        renderAll();
        markDirty({ products:true, sales:true });
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
      <div class="actions table" style="align-items:center;">
        <select id="chartCat">
          ${cats.map(c => `<option value="${escapeHtml(c.id)}"${c.id===state.filters.chartCat?" selected":""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
        <div class="small-muted">Csak bevétel (Ft), napra bontva. Kategória szűrésnél csak az adott kategória tételeit számolja.</div>
      </div>

      <div class="kpi" style="margin-top:12px;" id="chartKpi"></div>

      <div style="margin-top:12px;">
        <canvas id="revCanvas" width="1100" height="360" style="width:100%;height:360px;display:block;border-radius:16px;border:1px solid rgba(255,255,255,.06);background:rgba(11,15,23,.25);"></canvas>
      </div>
    `;

    $("#chartCat").onchange = () => { state.filters.chartCat = $("#chartCat").value; drawChart(); };
  }


function drawChart(){
  const canvas = $("#revCanvas");
  const kpi = $("#chartKpi");
  if(!canvas) return;

  try{
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(520, Math.floor(rect.width || 1100));
    const cssH = Math.max(260, Math.floor(rect.height || 360));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.clearRect(0,0,cssW,cssH);

    const cat = state.filters.chartCat;

    // group by date => revenue
    const map = new Map();
    let total = 0;
    for(const s of state.sales){
      const st = saleTotals(s, cat);
      if(cat !== "all" && !st.hit) continue;

      let d = String(s.date || "");
      if(!d) continue;
      // ha véletlen idő is van benne: "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD"
      d = d.split("T")[0].split(" ")[0];

      const rev = Number(st.revenue || 0);
      if(!Number.isFinite(rev)) continue;

      map.set(d, (map.get(d) || 0) + rev);
      total += rev;
    }

    const days = [...map.keys()].sort();
    const revs = days.map(d => Number(map.get(d) || 0));
    const labels = days.map(d => d); // teljes dátum

    if(kpi){
      kpi.innerHTML = `<div class="small-muted">Összes bevétel: <b>${total.toLocaleString("hu-HU")} Ft</b> • Napok: <b>${days.length}</b></div>`;
    }

    // grid
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1;

    const left = 96, right = cssW - 18, top = 18, bottom = cssH - 46;
    const w = right - left;
    const h = bottom - top;

    for(let i=0;i<=5;i++){
      const y = top + (i/5)*h;
      ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke();
    }

    if(!days.length){
      ctx.fillStyle = "rgba(255,255,255,.65)";
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText("Nincs adat a diagrammhoz.", left, top + 28);
      return;
    }

    const maxRev = Math.max(...revs, 1);

    // y labels
    ctx.font = "13px ui-sans-serif, system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for(let i=0;i<=4;i++){
      const t = i/4;
      const v = Math.round(maxRev * (1 - t));
      const y = top + t*h;
      ctx.fillStyle = "rgba(255,255,255,.72)";
      ctx.fillText(`${v.toLocaleString("hu-HU")} Ft`, left - 10, y);
    }

    // x labels (ritkítva)
    const step = Math.ceil(days.length / 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,.70)";
    for(let i=0;i<days.length;i+=step){
      const x = left + (days.length===1 ? w/2 : (i/(days.length-1))*w);
      ctx.fillText(labels[i], x, bottom + 10);
    }

    const xAt = (i) => left + (days.length===1 ? w/2 : (i/(days.length-1))*w);
    const yAt = (v) => bottom - (v/maxRev)*h;

    // revenue line (crypto-style)
    ctx.strokeStyle = "rgba(124,92,255,.95)";
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    for(let i=0;i<days.length;i++){
      const x = xAt(i);
      const y = yAt(revs[i]);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // last point highlight
    const lx = xAt(days.length-1);
    const ly = yAt(revs[revs.length-1]);
    ctx.fillStyle = "rgba(124,92,255,.95)";
    ctx.beginPath(); ctx.arc(lx, ly, 3.8, 0, Math.PI*2); ctx.fill();

  }catch(e){
    console.error(e);
    if(kpi){
      kpi.innerHTML = `<div class="small-muted">Diagramm hiba: <b>${escapeHtml(String(e?.message || e))}</b></div>`;
    }
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
  
  function ensureAdminPatchStyles(){
    if(document.getElementById("svAdminPatchStyle")) return;
    const st = document.createElement("style");
    st.id = "svAdminPatchStyle";
    st.textContent = `
      /* Modal body scroll + sticky actions */
      #modalBody{
        max-height: calc(80vh - 160px);
        overflow: auto;
        padding-right: 8px;
      }
      #modalActions{
        position: sticky;
        bottom: 0;
        padding-top: 12px;
        background: rgba(12,12,14,.92);
        backdrop-filter: blur(8px);
        border-top: 1px solid rgba(255,255,255,.10);
      }

      /* nicer scrollbars */
      #modalBody::-webkit-scrollbar,
      #pu_selected::-webkit-scrollbar{
        width: 10px;
      }
      #modalBody::-webkit-scrollbar-thumb,
      #pu_selected::-webkit-scrollbar-thumb{
        background: rgba(255,255,255,.16);
        border-radius: 999px;
        border: 2px solid rgba(0,0,0,.18);
      }
      #modalBody::-webkit-scrollbar-track,
      #pu_selected::-webkit-scrollbar-track{
        background: rgba(255,255,255,.06);
        border-radius: 999px;
      }
      #modalBody{ scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.20) rgba(255,255,255,.06); }
      #pu_selected{ scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.20) rgba(255,255,255,.06); }

      /* Popup picker: 2 columns + selected preview max 4 cards visible */
      #pu_grid{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      #pu_selected{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        max-height: 360px;
        overflow: auto;
        padding-right: 8px;
      }
      #pu_selected .card, #pu_grid .card{ width: 100% !important; max-width: none !important; }
      #pu_selected .card{ opacity: .96; }
      #pu_selected .card:hover{ opacity: 1; }

      @media (max-width: 760px){
        #pu_grid{ grid-template-columns: 1fr; }
        #pu_selected{ grid-template-columns: 1fr; max-height: 320px; }
        .sv-pop-arrow{ display:none; } /* not used here, just safety */
      }
    `;
    document.head.appendChild(st);
  }

function init(){
    ensureAdminPatchStyles();
    renderTabs();
    $("#btnReload").onclick = () => location.reload();
    $("#modalBg").addEventListener("click", (e) => {
      if(e.target === $("#modalBg")) closeModal();
    });

    // first render panels + inject settings inputs ids
    renderSettings();

    // betöltés ha van config
    const cfg = loadCfg();
    // hozzuk létre a settings inputokat előbb
    renderSettings();

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
