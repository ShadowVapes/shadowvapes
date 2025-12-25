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
        popups: [],
loaded: false,
    saving: false,
    saveQueued: false,
    dirty: false,
    dirtyProducts: false,
    dirtySales: false,
        dirtyPopups: false,
saveTimer: null,
    shas: { products: null, sales: null, popups: null },
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
      name_hu: p.name_hu || "",
      name_en: p.name_en || "",
      flavor_hu: p.flavor_hu || "",
      flavor_en: p.flavor_en || ""
    })).filter(p => p.id);

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

  function normalizePopups(){
    if(!Array.isArray(state.popups)) state.popups = [];
    const now = Date.now();
    const seen = new Set();
    state.popups = state.popups
      .filter(p => p && (p.id || p.title_hu || p.title_en))
      .map(p => {
        const id = String(p.id || ("pp_" + Math.random().toString(16).slice(2) + "_" + now.toString(16)));
        const rev = Number.isFinite(Number(p.rev)) ? Number(p.rev) : 1;
        const active = !!p.active;
        const title_hu = String(p.title_hu || p.title || "Új termékek");
        const title_en = String(p.title_en || p.title || "New products");
        const cats = Array.isArray(p.categories) ? p.categories.map(String) : [];
        const prods = Array.isArray(p.products) ? p.products.map(String) : [];
        const createdAt = p.createdAt ? String(p.createdAt) : new Date(now).toISOString();
        const updatedAt = p.updatedAt ? String(p.updatedAt) : createdAt;
        return {
          id, rev, active,
          title_hu, title_en,
          categories: [...new Set(cats.filter(Boolean))],
          products: [...new Set(prods.filter(Boolean))],
          createdAt, updatedAt
        };
      })
      .filter(p => {
        if(seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
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
                let popRes = null;
        let popups = [];
        try{
          popRes = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: br, path: "data/popups.json" });
          popups = JSON.parse(popRes.content || "[]");
        }catch{ popRes = null; popups = []; }
const doc = JSON.parse(p.content);
        const sales = JSON.parse(s.content);

        cfg.branch = br;
        saveCfg(cfg);

        state.doc = doc;
        state.sales = sales;
                state.popups = Array.isArray(popups) ? popups : [];
state.shas.products = p.sha;
        state.shas.sales = s.sha;
                state.shas.popups = popRes ? popRes.sha : null;
normalizeDoc();
                normalizePopups();
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

    for(const p of (state.doc.products||[])){
      if(p && p.status === "out") p.stock = 0;
      if(p && (!p.name_en || String(p.name_en).trim()==="")) p.name_en = p.name_hu || "";
    }
    const productsText = JSON.stringify(state.doc, null, 2);
    const salesText = JSON.stringify(state.sales, null, 2);

    
    const popupsText = JSON.stringify(state.popups || [], null, 2);
let ok = false;
const wantProducts = !!(state.dirtyProducts || state.dirtySales);
const wantSales = !!state.dirtySales;

const wantPopups = !!state.dirtyPopups;
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

    // popups sha (ha létezik)
  if(wantPopups && !state.shas.popups){
    try{
      const popOld = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/popups.json" });
      state.shas.popups = popOld.sha;
    }catch{ state.shas.popups = null; }
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

  if(wantPopups){
    tasks.push(
      ShadowGH.putFileSafe({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
        path: "data/popups.json",
        message: "Update popups.json",
        content: popupsText,
        sha: state.shas.popups
      }).then((pRes) => {
        state.shas.popups = pRes?.content?.sha || state.shas.popups;
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
    const payload = { doc: state.doc, sales: state.sales, popups: state.popups, ts: Date.now() };
    localStorage.setItem("sv_live_payload", JSON.stringify(payload));
    try{ new BroadcastChannel("sv_live").postMessage(payload); }catch{}
  }catch{}

  // ✅ ne reloadoljunk minden autosave után (lassú) — a state már friss
  state.dirtyProducts = false;
  state.dirtySales = false;
  state.dirtyPopups = false;

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
  if(f.popups) state.dirtyPopups = true;
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
      $("#panelProducts").style.display = tab === "products" ? "block" : "none";
      $("#panelCategories").style.display = tab === "categories" ? "block" : "none";
      $("#panelSales").style.display = tab === "sales" ? "block" : "none";
      $("#panelChart").style.display = tab === "chart" ? "block" : "none";
            $("#panelPopups").style.display = tab === "popups" ? "block" : "none";
$("#panelSettings").style.display = tab === "settings" ? "block" : "none";

      if(tab === "chart") drawChart();
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
          <tr><th>ID</th><th>HU</th><th>EN</th><th>Alap ár (Ft)</th><th></th></tr>
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
        </div>
      `;
      openModal("Új kategória", "Nem prompt, rendes modal 😄", body, [
        { label:"Mégse", kind:"ghost", onClick: closeModal },
        { label:"Létrehozás", kind:"primary", onClick: () => {
          const id = ($("#newCid").value||"").trim();
          if(!id) return;
          if(state.doc.categories.some(x => x.id === id)) return;
          state.doc.categories.push({
            id,
            label_hu: ($("#newChu").value||"").trim() || id,
            label_en: ($("#newCen").value||"").trim() || ($("#newChu").value||"").trim() || id,
            basePrice: Math.max(0, Number($("#newCprice").value||0))
          });
          closeModal();
          renderAll();
          markDirty({ products:true });
        }}
      ]);
    };

    $("#panelCategories").querySelectorAll("input[data-cid]").forEach(inp => {
      inp.addEventListener("input", () => {
        const id = inp.dataset.cid;
        const k = inp.dataset.k;
        const c = catById(id);
        if(!c) return;
        if(k === "basePrice") c.basePrice = Math.max(0, Number(inp.value||0));
        else c[k] = inp.value;
        markDirty({ products:true });
      });
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
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
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
      el.addEventListener("input", () => {
        const pid = el.dataset.pid;
        const k = el.dataset.k;
        const p = prodById(pid);
        if(!p) return;
        if(k === "stock") p.stock = Math.max(0, Number(el.value||0));
        else if(k === "price") p.price = (el.value === "" ? null : Math.max(0, Number(el.value||0)));
        else if(k === "status") p.status = el.value;
        else if(k === "categoryId") p.categoryId = el.value;

        markDirty({ products:true });
      });
      el.addEventListener("change", () => {
        const pid = el.dataset.pid;
        const k = el.dataset.k;
        const p = prodById(pid);
        if(!p) return;
        if(k === "status") p.status = el.value;
        if(k === "categoryId") p.categoryId = el.value;
        markDirty({ products:true });
      });
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

        <div class="field third"><label>Termék neve</label><input id="p_name" value="${escapeHtml(p.name_hu)}"></div>
        <div class="field third"><label>Íz HU</label><input id="p_fhu" value="${escapeHtml(p.flavor_hu)}"></div>
        <div class="field third"><label>Íz EN</label><input id="p_fen" value="${escapeHtml(p.flavor_en)}"></div>
      </div>
      <div class="small-muted" style="margin-top:10px;">
        soon → csak a “Hamarosan” tabban látszik. out/stock=0 → public oldalon leghátul + szürke.
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
        <td>${escapeHtml(n)} <span class="small
  /* ---------- Popups (Új termék ablakok) ---------- */
  function popTitle(p){ return (p && (p.title_hu || p.title_en)) ? (p.title_hu || p.title_en) : "Új termékek"; }

  function renderPopupsPanel(){
    normalizePopups();

    const wrap = $("#panelPopups");
    if(!wrap) return;

    const active = state.popups.filter(p=>p.active);
    wrap.innerHTML = `
      <div class="actions" style="justify-content:space-between; align-items:center;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="primary" id="btnNewPopup">+ Új popup</button>
          <div class="small-muted">Aktív: <b>${active.length}</b> • A public oldalon sorban dobódnak fel.</div>
        </div>
        <div class="small-muted">Tipp: ha frissíted a popup tartalmát, a rendszer rev-et emel, így a “Ne mutasd többször” újra engedi.</div>
      </div>

      <div class="table" style="margin-top:12px;">
        <div class="thead">
          <div>Cím</div>
          <div>Aktív</div>
          <div>Tételek</div>
          <div>Rev</div>
          <div style="text-align:right;">Művelet</div>
        </div>
        <div class="tbody" id="popupsList"></div>
      </div>
    `;

    $("#btnNewPopup").onclick = () => openPopupEditor(null);

    const list = $("#popupsList");
    const catsById = new Map((state.doc.categories||[]).map(c => [String(c.id), c]));
    const prodsById = new Map((state.doc.products||[]).map(p => [String(p.id), p]));

    if(state.popups.length === 0){
      list.innerHTML = `<div class="row" style="padding:14px;color:rgba(230,235,245,.65);">Nincs popup létrehozva.</div>`;
      return;
    }

    // rendezzük: aktív elöl, aztán updatedAt desc
    const sorted = [...state.popups].sort((a,b)=>{
      const aa = a.active ? 1:0, bb = b.active ? 1:0;
      if(aa !== bb) return bb-aa;
      return String(b.updatedAt||"").localeCompare(String(a.updatedAt||""));
    });

    list.innerHTML = sorted.map(p => {
      const cc = (p.categories||[]).length;
      const pc = (p.products||[]).length;
      const title = escapeHtml(popTitle(p));
      return `
        <div class="row" style="display:grid;grid-template-columns:1.4fr .5fr .6fr .4fr .8fr;gap:12px;align-items:center;padding:12px;border-top:1px solid rgba(255,255,255,.06);">
          <div>
            <div style="font-weight:900;">${title}</div>
            <div class="small-muted">id: <span style="opacity:.8">${escapeHtml(p.id)}</span> • frissítve: ${escapeHtml(String(p.updatedAt||"").split("T")[0]||"—")}</div>
          </div>
          <div>
            <label style="display:flex;gap:8px;align-items:center;">
              <input type="checkbox" class="pp_active" data-id="${escapeHtml(p.id)}"${p.active?" checked":""}>
              <span class="small-muted">aktív</span>
            </label>
          </div>
          <div class="small-muted">${cc} kat • ${pc} termék</div>
          <div class="small-muted">${Number(p.rev||1)}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="ghost pp_edit" data-id="${escapeHtml(p.id)}">Szerkeszt</button>
            <button class="danger pp_del" data-id="${escapeHtml(p.id)}">Töröl</button>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".pp_active").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        const p = state.popups.find(x => x.id === id);
        if(!p) return;
        p.active = !!cb.checked;
        p.updatedAt = new Date().toISOString();
        normalizePopups();
        markDirty({ popups:true });
        renderPopupsPanel();
      });
    });

    list.querySelectorAll(".pp_edit").forEach(b => b.onclick = () => {
      const p = state.popups.find(x => x.id === b.dataset.id);
      if(p) openPopupEditor(p);
    });
    list.querySelectorAll(".pp_del").forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      const p = state.popups.find(x => x.id === id);
      if(!p) return;
      const body = document.createElement("div");
      body.innerHTML = `<div class="small-muted">Biztos törlöd?</div><div style="margin-top:10px;font-weight:900;">${escapeHtml(popTitle(p))}</div>`;
      openModal("Popup törlése", "", body, [
        { label:"Mégse", kind:"ghost", onClick: closeModal },
        { label:"Törlés", kind:"danger", onClick: () => {
          state.popups = state.popups.filter(x => x.id !== id);
          normalizePopups();
          closeModal();
          markDirty({ popups:true });
          renderPopupsPanel();
        }}
      ]);
    });
  }

  function openPopupEditor(existing){
    normalizePopups();

    const editing = !!existing;
    const nowIso = new Date().toISOString();
    const base = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: "pp_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16),
      rev: 1,
      active: true,
      title_hu: "Új termékek elérhetőek",
      title_en: "New products available",
      categories: [],
      products: [],
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const cats = (state.doc.categories||[]).map(c => ({ id:String(c.id), label:String(c.label_hu||c.id) }));
    const prods = (state.doc.products||[]).map(p => ({
      id:String(p.id),
      img:String(p.image||""),
      name:String(p.name_hu||p.name_en||"—"),
      flavor:String(p.flavor_hu||p.flavor_en||""),
      stock:Number(p.stock||0),
      price: effectivePrice(p),
      catId:String(p.categoryId||"")
    }));

    const selectedCats = new Set((base.categories||[]).map(String));
    const selectedProds = new Set((base.products||[]).map(String));

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label>Cím HU</label>
          <input id="pp_title_hu" value="${escapeHtml(base.title_hu||"")}">
        </div>
        <div class="field">
          <label>Cím EN</label>
          <input id="pp_title_en" value="${escapeHtml(base.title_en||"")}">
        </div>
      </div>

      <div style="margin-top:10px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;gap:10px;align-items:center;">
          <input type="checkbox" id="pp_active"${base.active?" checked":""}>
          <span style="font-weight:900;">Aktív</span>
        </label>
        <div class="small-muted">Egy popup akkor jelenik meg, ha aktív + nincs “leokézva” a felhasználónál.</div>
      </div>

      <div style="margin-top:14px;">
        <div style="font-weight:900;margin-bottom:8px;">Kategóriák (opcionális)</div>
        <div class="picker-grid" id="ppCats"></div>
      </div>

      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div style="font-weight:900;">Termékek (opcionális)</div>
          <div class="small-muted">Kijelölve: <b id="ppSelCount">0</b></div>
        </div>
        <div class="small-muted" style="margin-top:4px;">A listában 2 oszlopban vannak a kártyák. Görgess, ha sok.</div>

        <div id="ppSelPreview" style="margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:10px;background:rgba(11,15,23,.20);max-height:220px;overflow:auto;"></div>

        <div style="margin-top:10px;max-height:420px;overflow:auto;padding-right:6px;" id="ppProdList">
          <div class="picker-grid" id="ppProds"></div>
        </div>
      </div>
    `;

    // Render cats
    const catsBox = body.querySelector("#ppCats");
    catsBox.innerHTML = cats.map(c => `
      <div class="pick-card ${selectedCats.has(c.id)?"selected":""}" data-type="cat" data-id="${escapeHtml(c.id)}" style="justify-content:space-between;">
        <div class="pick-meta">
          <div class="t">${escapeHtml(c.label)}</div>
          <div class="k">kategória</div>
        </div>
        <div class="pick-check">${selectedCats.has(c.id)?"✓":""}</div>
      </div>
    `).join("");

    catsBox.querySelectorAll(".pick-card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        if(selectedCats.has(id)) selectedCats.delete(id);
        else selectedCats.add(id);
        renderCats();
        renderPreview();
      });
    });

    function renderCats(){
      catsBox.querySelectorAll(".pick-card").forEach(card => {
        const id = card.dataset.id;
        const on = selectedCats.has(id);
        card.classList.toggle("selected", on);
        card.querySelector(".pick-check").textContent = on ? "✓" : "";
      });
    }

    // Render products
    const prodGrid = body.querySelector("#ppProds");
    prodGrid.innerHTML = prods.map(p => {
      const on = selectedProds.has(p.id);
      return `
        <div class="pick-card ${on?"selected":""}" data-type="prod" data-id="${escapeHtml(p.id)}">
          <div class="pick-thumb"><img src="${escapeHtml(p.img)}" loading="lazy" alt=""></div>
          <div class="pick-meta">
            <div class="t">${escapeHtml(p.name)}</div>
            <div class="s">${escapeHtml(p.flavor)}</div>
            <div class="k">stock: <b>${p.stock}</b> • ár: <b>${Number(p.price||0)}</b> Ft</div>
          </div>
          <div class="pick-check">${on?"✓":""}</div>
        </div>
      `;
    }).join("");

    prodGrid.querySelectorAll(".pick-card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        if(selectedProds.has(id)) selectedProds.delete(id);
        else selectedProds.add(id);
        renderProds();
        renderPreview();
      });
    });

    function renderProds(){
      prodGrid.querySelectorAll(".pick-card").forEach(card => {
        const id = card.dataset.id;
        const on = selectedProds.has(id);
        card.classList.toggle("selected", on);
        card.querySelector(".pick-check").textContent = on ? "✓" : "";
      });
      body.querySelector("#ppSelCount").textContent = String(selectedCats.size + selectedProds.size);
    }

    function renderPreview(){
      const prev = body.querySelector("#ppSelPreview");
      const selected = [];

      // expand category selections to products (only for preview)
      for(const cid of selectedCats){
        const items = prods.filter(p=>p.catId===cid);
        for(const it of items) selected.push(it);
      }
      for(const pid of selectedProds){
        const it = prods.find(x=>x.id===pid);
        if(it) selected.push(it);
      }

      // unique
      const uniq = [];
      const seen = new Set();
      for(const it of selected){
        if(seen.has(it.id)) continue;
        seen.add(it.id);
        uniq.push(it);
      }

      if(uniq.length === 0){
        prev.innerHTML = `<div class="small-muted">Nincs kiválasztva semmi.</div>`;
        return;
      }

      prev.innerHTML = uniq.map(it => `
        <div style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);margin-bottom:8px;">
          <div style="width:46px;height:46px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.25);flex:0 0 auto;">
            <img src="${escapeHtml(it.img)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" alt="">
          </div>
          <div style="min-width:0;">
            <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.name)}</div>
            <div class="small-muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.flavor)} • stock: ${it.stock} • ${Number(it.price||0)} Ft</div>
          </div>
        </div>
      `).join("");
    }

    renderCats();
    renderProds();
    renderPreview();

    openModal(editing ? "Popup szerkesztése" : "Új popup", "Válassz kategóriát és/vagy terméket (nem baj, ha mindkettő).", body, [
      { label:"Mégse", kind:"ghost", onClick: closeModal },
      { label:"Mentés", kind:"primary", onClick: () => {
        const title_hu = ($("#pp_title_hu").value || "").trim() || "Új termékek elérhetőek";
        const title_en = ($("#pp_title_en").value || "").trim() || "New products available";
        const active = !!$("#pp_active").checked;

        const next = {
          ...base,
          title_hu, title_en, active,
          categories: [...selectedCats],
          products: [...selectedProds],
        };

        // rev bump ha változott a lényeg
        const keyOld = JSON.stringify({t:base.title_hu, te:base.title_en, a:base.active, c:(base.categories||[]).slice().sort(), p:(base.products||[]).slice().sort()});
        const keyNew = JSON.stringify({t:next.title_hu, te:next.title_en, a:next.active, c:(next.categories||[]).slice().sort(), p:(next.products||[]).slice().sort()});
        if(editing){
          if(keyOld !== keyNew){
            next.rev = Number(base.rev||1) + 1;
          }else{
            next.rev = Number(base.rev||1);
          }
          next.updatedAt = new Date().toISOString();
        }else{
          next.rev = 1;
          next.createdAt = nowIso;
          next.updatedAt = nowIso;
        }

        // mentés state-be
        if(editing){
          state.popups = state.popups.map(x => x.id === base.id ? next : x);
        }else{
          state.popups.unshift(next);
        }

        normalizePopups();
        closeModal();
        markDirty({ popups:true });
        renderPopupsPanel();
      }}
    ]);
  }

-muted">${escapeHtml(f? "• "+f:"")}</span></td>
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
    renderPopupsPanel();
    renderChartPanel();
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
