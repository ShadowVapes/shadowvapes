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
    loaded: false,
    saving: false,
    dirty: false,
    saveTimer: null,
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

    // Sales normalize
    state.sales = state.sales.map(s => ({
      id: String(s.id || ""),
      date: String(s.date || ""),
      name: s.name || "",
      payment: s.payment || "",
      items: Array.isArray(s.items) ? s.items.map(it => ({
        productId: String(it.productId || ""),
        qty: Math.max(1, Number(it.qty || 1)),
        unitPrice: Math.max(0, Number(it.unitPrice || 0))
      })).filter(it => it.productId) : []
    })).filter(s => s.id);
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
  const _defaultBranchCache = new Map();

  async function getDefaultBranch(cfg){
    const key = `${cfg.owner}/${cfg.repo}`;
    if(_defaultBranchCache.has(key)) return _defaultBranchCache.get(key);

    try{
      const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `token ${cfg.token}`
        },
        cache: "no-store"
      });
      if(res.ok){
        const data = await res.json();
        const b = data && data.default_branch ? String(data.default_branch) : null;
        _defaultBranchCache.set(key, b);
        return b;
      }
    }catch{}

    _defaultBranchCache.set(key, null);
    return null;
  }

  async function tryLoadFromGithub(cfg){
    // branch fallback main/master automatikusan, ha “No commit found for the ref ...”
    // + gh-pages (sokan azon hostolnak)
    const def = await getDefaultBranch(cfg);
    const branchesToTry = [cfg.branch, def, "main", "master", "gh-pages"].filter((v,i,a)=> v && a.indexOf(v)===i);

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
        normalizeDoc();
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
      setSaveStatus("bad", `Betöltés hiba: ${(r.err && r.err.message) ? r.err.message : "?"}`);
      return;
    }

    setSaveStatus("ok","Kész");
    renderAll();
  }

  async function saveDataNow(){
    if(!state.loaded) return;

    const cfg = getCfg();
    saveCfg(cfg);
    if(!cfg.owner || !cfg.repo || !cfg.token){
      setSaveStatus("bad","Hiányzó GH beállítás");
      return;
    }

    state.saving = true;
    setSaveStatus("busy","Mentés...");

    // biztos rend
    normalizeDoc();

    const productsText = JSON.stringify(state.doc, null, 2);
    const salesText = JSON.stringify(state.sales, null, 2);

    try{
      // gyorsítsunk: párhuzamos GET/PUT
      const [pOld, sOld] = await Promise.all([
        ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/products.json" }),
        ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/sales.json" })
      ]);

      await Promise.all([
        ShadowGH.putFile({
          token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
          path: "data/products.json",
          message: "Update products.json",
          content: productsText,
          sha: pOld.sha
        }),
        ShadowGH.putFile({
          token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
          path: "data/sales.json",
          message: "Update sales.json",
          content: salesText,
          sha: sOld.sha
        })
      ]);

      // ✅ mentés után automatikus újratöltés
      const rr = await tryLoadFromGithub(cfg);
      if(rr.ok){
        setSaveStatus("ok","Mentve ✅");
        renderAll();
      }else{
        setSaveStatus("ok","Mentve ✅ (reload hiba)");
      }

      state.dirty = false;
    }catch(e){
      console.error(e);
      setSaveStatus("bad", `Mentés hiba: ${(e && e.message) ? e.message : "?"}`);
    }finally{
      state.saving = false;
    }
  }

  function queueAutoSave(){
    state.dirty = true;
    if(state.saving) return;
    if(state.saveTimer) clearTimeout(state.saveTimer);
    setSaveStatus("busy","Változás…");
    // gyorsabb autosave (de nem commit-spam): 600ms
    state.saveTimer = setTimeout(() => {
      saveDataNow();
    }, 600);
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
      $("#panelSettings").style.display = tab === "settings" ? "block" : "none";

      if(tab === "chart") drawChart();
    });
  }

  function renderSettings(){
    const cfg = loadCfg();
    $("#panelSettings").innerHTML = `
      <div class="small-muted">GitHub mentés (token localStorage-ben). Branch: ha rossz, automatikusan próbál main/master/gh-pages.</div>
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
    `;

    $("#btnLoad").onclick = loadData;
    $("#btnSave").onclick = saveDataNow;

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
          queueAutoSave();
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
        queueAutoSave();
      });
    });

    $("#panelCategories").querySelectorAll("button[data-delcat]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.delcat;
        // ha használja termék, ne engedjük
        if(state.doc.products.some(p => p.categoryId === id)) return;
        state.doc.categories = state.doc.categories.filter(c => c.id !== id);
        renderAll();
        queueAutoSave();
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
        <div class="rowline">
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
      <div class="actions" style="align-items:center;">
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

        queueAutoSave();
      });
      el.addEventListener("change", () => {
        const pid = el.dataset.pid;
        const k = el.dataset.k;
        const p = prodById(pid);
        if(!p) return;
        if(k === "status") p.status = el.value;
        if(k === "categoryId") p.categoryId = el.value;
        queueAutoSave();
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
        queueAutoSave();
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

        <div class="field third"><label>Név HU</label><input id="p_nhu" value="${escapeHtml(p.name_hu)}"></div>
        <div class="field third"><label>Név EN</label><input id="p_nen" value="${escapeHtml(p.name_en)}"></div>
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
          name_hu: ($("#p_nhu").value||"").trim(),
          name_en: ($("#p_nen").value||"").trim(),
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
        queueAutoSave();
      }}
    ]);
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
      // kategória szűrésnél is korrekt mennyiséget mutasson
      const itemsCount = Number(tot.qty || 0);

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
      <div class="actions" style="align-items:center;">
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
      row.className = "rowline";
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
        queueAutoSave();
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
    queueAutoSave();
  }

  function renderChartPanel(){
    const cats = [{id:"all", label:"Mind"}, ...state.doc.categories.map(c=>({id:c.id,label:c.label_hu||c.id}))];

    $("#panelChart").innerHTML = `
      <div class="actions" style="align-items:center;">
        <select id="chartCat">
          ${cats.map(c => `<option value="${escapeHtml(c.id)}"${c.id===state.filters.chartCat?" selected":""}>${escapeHtml(c.label)}</option>`).join("")}
        </select>
        <div class="small-muted">Kategória szűrésnél csak az adott kategória tételeit számolja.</div>
      </div>

      <div class="kpi" style="margin-top:12px;" id="chartKpi"></div>

      <div style="margin-top:12px;">
        <canvas id="revCanvas" width="1100" height="360" style="width:100%;border-radius:18px;border:1px solid rgba(255,255,255,.06);background:rgba(11,15,23,.25);"></canvas>
      </div>
    `;

    $("#chartCat").onchange = () => { state.filters.chartCat = $("#chartCat").value; drawChart(); };
  }

  function drawChart(){
    if(!$("#revCanvas")) return;

    const cat = state.filters.chartCat;

    // group by date
    const map = new Map(); // date => {rev, salesCount, qty}
    for(const s of state.sales){
      const st = saleTotals(s, cat);
      if(cat !== "all" && !st.hit) continue;

      const d = s.date;
      if(!map.has(d)) map.set(d, { rev:0, cnt:0, qty:0 });
      const obj = map.get(d);
      obj.rev += st.revenue;
      obj.qty += st.qty;
      obj.cnt += 1;
    }

    const days = [...map.entries()].sort((a,b)=> a[0].localeCompare(b[0]));
    const labels = days.map(x=>x[0]);
    const revs = days.map(x=>x[1].rev);
    const cnts = days.map(x=>x[1].cnt);
    const qtys = days.map(x=>x[1].qty);

    const totalRev = revs.reduce((a,b)=>a+b,0);
    const totalSales = cnts.reduce((a,b)=>a+b,0);
    const totalQty = qtys.reduce((a,b)=>a+b,0);

    $("#chartKpi").innerHTML = `
      <div class="box"><div class="t">Össz bevétel</div><div class="v">${totalRev.toLocaleString("hu-HU")} Ft</div></div>
      <div class="box"><div class="t">Eladások (db)</div><div class="v">${totalSales.toLocaleString("hu-HU")}</div></div>
      <div class="box"><div class="t">Eladott mennyiség</div><div class="v">${totalQty.toLocaleString("hu-HU")}</div></div>
    `;

    const canvas = $("#revCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // background grid
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    for(let i=0;i<6;i++){
      const y = 50 + i*50;
      ctx.beginPath(); ctx.moveTo(40,y); ctx.lineTo(canvas.width-20,y); ctx.stroke();
    }

    if(!days.length){
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText("Nincs adat a diagrammhoz.", 60, 90);
      return;
    }

    const maxRev = Math.max(...revs, 1);
    const maxCnt = Math.max(...cnts, 1);

    const left = 40, top = 20, bottom = canvas.height - 40, right = canvas.width - 20;
    const w = right - left;
    const h = bottom - top;

    const barW = Math.max(10, Math.floor(w / days.length) - 8);

    // bars (revenue)
    for(let i=0;i<days.length;i++){
      const x = left + i*(barW+8) + 6;
      const bh = Math.round((revs[i] / maxRev) * (h-40));
      const y = bottom - bh;

      // gradient-ish (simple)
      ctx.fillStyle = "rgba(124,92,255,.55)";
      ctx.fillRect(x, y, barW, bh);
      ctx.fillStyle = "rgba(40,215,255,.25)";
      ctx.fillRect(x, y, barW, Math.max(6, Math.floor(bh*0.35)));
    }

    // line (sales count)
    ctx.strokeStyle = "rgba(40,215,255,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for(let i=0;i<days.length;i++){
      const x = left + i*(barW+8) + 6 + barW/2;
      const ly = bottom - Math.round((cnts[i] / maxCnt) * (h-40));
      if(i===0) ctx.moveTo(x, ly);
      else ctx.lineTo(x, ly);
    }
    ctx.stroke();

    // labels (sparse)
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.font = "12px ui-sans-serif, system-ui";
    const step = Math.ceil(days.length / 7);
    for(let i=0;i<days.length;i+=step){
      const x = left + i*(barW+8) + 6;
      ctx.fillText(labels[i], x, canvas.height - 14);
    }
  }

  function renderAll(){
    renderSettings();
    renderCategories();
    renderProducts();
    renderSales();
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
