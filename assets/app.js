(() => {
  const $ = (s) => document.querySelector(s);

  const I18N = {
    hu: {
      all: "Összes termék",
      soon: "Hamarosan",
      search: "Keresés…",
      stock: "Készlet",
      price: "Ár",
      soldout: "elfogyott",
      coming: "hamarosan",
      hot: "felkapott",
      newTitle: "Új termékek elérhetőek",
      dontShow: "Ne mutasd többször",
      ok: "Értettem",
      skipAll: "Összes átugrása",
    },
    en: {
      all: "All products",
      soon: "Coming soon",
      search: "Search…",
      stock: "Stock",
      price: "Price",
      soldout: "sold out",
      coming: "coming soon",
      hot: "trending",
      newTitle: "New products available",
      dontShow: "Don't show again",
      ok: "Got it",
      skipAll: "Skip all",
    }
  };

  const state = {
    lang: "hu",
    active: "all", // categoryId | 'all' | 'soon'
    q: "",
    doc: { categories: [], products: [], popups: [] },
    sales: [],
    featuredByCat: new Map(),
    source: null,
    lastSigDoc: "",
    lastSigSales: "",
    renderedOnce: false,
    popupOpen: false,
  };

  const LS = {
    sourceJson: "sv_source_json", // {owner,repo,branch}
    popupDismissPrefix: "sv_popup_dismissed_", // + id + "_" + rev
  };

  function t(k){ return (I18N[state.lang] && I18N[state.lang][k]) || k; }
  function loc(){ return state.lang === "hu" ? "hu" : "en"; }

function showLoader(msg){
  const loader = $("#loader");
  const app = $("#app");
  if(app) app.style.display = "none";
  if(loader) loader.style.display = "flex";
  const lt = $("#loaderText");
  if(lt && msg) lt.textContent = msg;
}

function showApp(){
  const loader = $("#loader");
  const app = $("#app");
  if(loader) loader.style.display = "none";
  if(app) app.style.display = "grid";
  state.renderedOnce = true;
}

  function norm(s){
    return String(s||"")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function applySyncParams(){
    try{
      const u = new URL(location.href);
      const owner = u.searchParams.get("sv_owner");
      const repo = u.searchParams.get("sv_repo");
      const branch = u.searchParams.get("sv_branch") || "main";
      if(owner && repo){
        const src = { owner, repo, branch };
        localStorage.setItem(LS.sourceJson, JSON.stringify(src));
        // tisztítsuk az URL-t
        u.searchParams.delete("sv_owner");
        u.searchParams.delete("sv_repo");
        u.searchParams.delete("sv_branch");
        history.replaceState({}, "", u.toString());
      }
    }catch{}
  }

  function readSourceFromLS(){
    try{
      const raw = localStorage.getItem(LS.sourceJson);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.owner && obj.repo){
        return { owner: String(obj.owner), repo: String(obj.repo), branch: String(obj.branch||"main") };
      }
    }catch{}
    return null;
  }

  function deriveGithubPagesSource(){
    try{
      const host = location.hostname || "";
      if(!host.endsWith(".github.io")) return null;
      const owner = host.split(".")[0];
      const seg = (location.pathname || "/").split("/").filter(Boolean)[0] || "";
      const repo = seg ? seg : `${owner}.github.io`;
      return { owner, repo, branch: "main" };
    }catch{
      return null;
    }
  }

  async function resolveSource({forceBust=false}={}){
    if(state.source) return state.source;

    const ls = readSourceFromLS();
    if(ls){ state.source = ls; return ls; }

    // 1) data/sv_source.json a site-on (cache bust)
    try{
      const v = forceBust ? `?v=${Date.now()}` : "";
      const r = await fetch(`data/sv_source.json${v}`, { cache: "no-store" });
      if(r.ok){
        const j = await r.json();
        if(j && j.owner && j.repo){
          const src = { owner: String(j.owner), repo: String(j.repo), branch: String(j.branch||"main") };
          localStorage.setItem(LS.sourceJson, JSON.stringify(src));
          state.source = src;
          return src;
        }
      }
    }catch{}

    // 2) heuristic GitHub Pages
    const gh = deriveGithubPagesSource();
    if(gh){
      localStorage.setItem(LS.sourceJson, JSON.stringify(gh));
      state.source = gh;
      return gh;
    }

    return null;
  }

  async function fetchJson(relPath, {forceBust=false}={}){
    const v = forceBust ? `?v=${Date.now()}` : "";
    const src = await resolveSource({forceBust});
    // RAW first (gyorsabb frissülés)
    if(src && src.owner && src.repo){
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(src.owner)}/${encodeURIComponent(src.repo)}/${encodeURIComponent(src.branch||"main")}/${relPath}${v}`;
      try{
        const r = await fetch(url, { cache: "no-store" });
        if(r.ok) return await r.json();
      }catch{}
    }
    // fallback: site
    const r2 = await fetch(`${relPath}${v}`, { cache: "no-store" });
    if(!r2.ok) throw new Error(`Fetch failed: ${relPath} (${r2.status})`);
    return await r2.json();
  }

  function normalizeDoc(doc){
    const d = doc && typeof doc === "object" ? doc : {};
    const out = {
      categories: Array.isArray(d.categories) ? d.categories : [],
      products: Array.isArray(d.products) ? d.products : [],
      popups: Array.isArray(d.popups) ? d.popups : [],
      updatedAt: Number(d.updatedAt||d.rev||0) || 0,
    };

    out.categories = out.categories
      .filter(c => c && c.id)
      .map(c => ({
        id: String(c.id),
        label_hu: String(c.label_hu || c.id),
        label_en: String(c.label_en || c.label_hu || c.id),
        basePrice: Number(c.basePrice||0) || 0,
        featuredEnabled: (c.featuredEnabled === false) ? false : true,
      }));

    out.products = out.products
      .filter(p => p && p.id)
      .map(p => ({
        id: String(p.id),
        categoryId: String(p.categoryId||""),
        status: (p.status === "ok" || p.status === "out" || p.status === "soon") ? p.status : "ok",
        stock: Math.max(0, Number(p.stock||0)),
        price: (p.price === "" || p.price === null || p.price === undefined) ? null : Number(p.price||0),
        image: String(p.image||""),
        visible: (p.visible === false) ? false : true,
        name_hu: String(p.name_hu||""),
        name_en: String(p.name_en||""),
        flavor_hu: String(p.flavor_hu||""),
        flavor_en: String(p.flavor_en||""),
      }));

    out.popups = out.popups
      .filter(x => x && (x.id || x.title_hu || x.title_en || x.title))
      .map(x => {
        const id = String(x.id || ("pu_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16)));
        const updatedAt = Number(x.updatedAt || x.rev || Date.now());
        const createdAt = Number(x.createdAt || x.rev || updatedAt || Date.now());
        const rev = Number(x.rev || updatedAt || Date.now());
        const catIds = Array.isArray(x.categoryIds) ? x.categoryIds.map(v => String(v)).filter(Boolean) : [];
        const prodIds = Array.isArray(x.productIds) ? x.productIds.map(v => String(v)).filter(Boolean) : [];
        return {
          id,
          enabled: (x.enabled === false) ? false : true,
          rev,
          title_hu: String(x.title_hu || x.title || ""),
          title_en: String(x.title_en || x.title_hu || x.title || ""),
          categoryIds: catIds,
          productIds: prodIds,
          createdAt,
          updatedAt,
        };
      });

    return out;
  }

  function effectivePrice(p){
    const cat = state.doc.categories.find(c => c.id === p.categoryId);
    const base = cat ? Number(cat.basePrice||0) : 0;
    const pr = (p.price === null || p.price === undefined || p.price === "") ? null : Number(p.price||0);
    return (pr === null || Number.isNaN(pr)) ? base : pr;
  }

  function catLabel(c){
    return state.lang === "hu" ? (c.label_hu||c.id) : (c.label_en||c.label_hu||c.id);
  }

  function productName(p){
    return state.lang === "hu" ? (p.name_hu||p.name_en||"") : (p.name_en||p.name_hu||"");
  }
  function productFlavor(p){
    return state.lang === "hu" ? (p.flavor_hu||p.flavor_en||"") : (p.flavor_en||p.flavor_hu||"");
  }

  function rankStatus(s){
    // ok -> 0, soon -> 1 (leghátul), out -> 2 (legutolsó)
    return s === "ok" ? 0 : (s === "soon" ? 1 : 2);
  }

  function computeFeaturedByCat(){
    const map = new Map();
    const prodById = new Map(state.doc.products.map(p => [p.id, p]));
    const counts = new Map(); // catId -> Map(prodId->qty)

    for(const sale of (state.sales||[])){
      if(!sale || !Array.isArray(sale.items)) continue;
      for(const it of sale.items){
        const pid = String(it.productId||"");
        const qty = Math.max(0, Number(it.qty||0));
        if(!pid || !qty) continue;
        const p = prodById.get(pid);
        if(!p) continue;
        if(p.visible === false) continue;

        const cid = p.categoryId || "";
        if(!cid) continue;
        if(!counts.has(cid)) counts.set(cid, new Map());
        const cm = counts.get(cid);
        cm.set(pid, (cm.get(pid)||0) + qty);
      }
    }

    for(const c of state.doc.categories){
      if(c.featuredEnabled === false) continue;
      const cm = counts.get(c.id);
      if(!cm) continue;
      // max qty
      let bestId = "";
      let bestQty = 0;
      for(const [pid, qty] of cm.entries()){
        if(qty > bestQty){
          bestQty = qty;
          bestId = pid;
        }else if(qty === bestQty && qty > 0){
          // tie break by flavor (locale)
          const pa = prodById.get(pid);
          const pb = prodById.get(bestId);
          const fa = productFlavor(pa||{});
          const fb = productFlavor(pb||{});
          if(fa.localeCompare(fb, loc()) < 0){
            bestId = pid;
          }
        }
      }
      if(bestQty > 0 && bestId) map.set(c.id, bestId);
    }

    state.featuredByCat = map;
  }

  function filterProducts(){
    const q = norm(state.q);
    let list = state.doc.products.filter(p => p.visible !== false);

    // category filter
    if(state.active === "soon"){
      list = list.filter(p => p.status === "soon");
    }else if(state.active !== "all"){
      list = list.filter(p => p.categoryId === state.active);
    }

    if(q){
      list = list.filter(p => {
        const hay = norm(`${p.name_hu} ${p.name_en} ${p.flavor_hu} ${p.flavor_en}`);
        return hay.includes(q);
      });
    }

    // sort within status rank, then name, then flavor (locale)
    list.sort((a,b) => {
      const ra = rankStatus(a.status), rb = rankStatus(b.status);
      if(ra !== rb) return ra - rb;
      const na = productName(a), nb = productName(b);
      const cn = na.localeCompare(nb, loc());
      if(cn !== 0) return cn;
      const fa = productFlavor(a), fb = productFlavor(b);
      return fa.localeCompare(fb, loc());
    });

    // group same name next to each other
    // (simple stable regroup: sort already ensures it, but ensure exact)
    // Keep as-is.

    // pin featured
    if(state.active !== "soon"){
      const pinned = [];
      const pinnedIds = new Set();

      if(state.active === "all"){
        const cats = [...state.doc.categories].sort((a,b)=>catLabel(a).localeCompare(catLabel(b), loc()));
        for(const c of cats){
          const pid = state.featuredByCat.get(c.id);
          if(!pid) continue;
          const idx = list.findIndex(p => p.id === pid);
          if(idx >= 0){
            const p = list.splice(idx,1)[0];
            p.__featured = true;
            pinned.push(p);
            pinnedIds.add(pid);
          }
        }
      }else{
        const pid = state.featuredByCat.get(state.active);
        if(pid){
          const idx = list.findIndex(p => p.id === pid);
          if(idx >= 0){
            const p = list.splice(idx,1)[0];
            p.__featured = true;
            pinned.push(p);
            pinnedIds.add(pid);
          }
        }
      }

      // clear old flags
      for(const p of list){ delete p.__featured; }

      return [...pinned, ...list];
    }

    // clear old flags
    for(const p of list){ delete p.__featured; }
    return list;
  }

  function renderNav(){
    const nav = $("#categories");
    if(!nav) return;
    const cats = [...state.doc.categories].sort((a,b)=>catLabel(a).localeCompare(catLabel(b), loc()));

    // "All" first, "Soon" last
    nav.innerHTML = `
      <button class="chip ${state.active==="all"?"active":""}" data-cat="all">${escapeHtml(t("all"))}</button>
      ${cats.map(c => `
        <button class="chip ${state.active===c.id?"active":""}" data-cat="${escapeHtml(c.id)}">${escapeHtml(catLabel(c))}</button>
      `).join("")}
      <button class="chip ${state.active==="soon"?"active":""}" data-cat="soon">${escapeHtml(t("soon"))}</button>
    `;

    nav.querySelectorAll("button[data-cat]").forEach(b => {
      b.onclick = () => {
        state.active = b.dataset.cat;
        renderNav();
        renderGrid();
      };
    });
  }

  function cardBadges(p){
    const arr = [];
    if(p.__featured) arr.push(`<span class="badge hot">${escapeHtml(t("hot"))}</span>`);
    if(p.status === "soon") arr.push(`<span class="badge soon">${escapeHtml(t("coming"))}</span>`);
    if(p.status === "out" || p.stock <= 0) arr.push(`<span class="badge out">${escapeHtml(t("soldout"))}</span>`);
    return arr.join("");
  }

  function renderGrid(){
    const grid = $("#grid");
    if(!grid) return;

    const list = filterProducts();

    if(!list.length){
      grid.innerHTML = `<div class="small-muted">—</div>`;
      return;
    }

    const html = list.map(p => {
      const price = effectivePrice(p);
      const name = productName(p);
      const flavor = productFlavor(p);
      const stock = (p.status === "soon") ? "—" : String(Math.max(0, p.stock||0));

      const isOut = (p.status === "out") || (p.stock <= 0 && p.status !== "soon");
      const cls = [
        "card",
        (!state.renderedOnce ? "fade-in" : ""),
        (isOut ? "dim out" : (p.status==="soon" ? "soon" : "")),
        (p.__featured ? "featured" : "")
      ].filter(Boolean).join(" ");

      return `
        <div class="${cls}">
          <div class="hero">
            <img src="${escapeHtml(p.image||"")}" alt="${escapeHtml(name)}" loading="lazy">
            <div class="badges">${cardBadges(p)}</div>
            <div class="overlay-title">
              <div class="name">${escapeHtml(name)}</div>
              <div class="flavor">${escapeHtml(flavor)}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="meta-row">
              <div class="price">${price.toLocaleString(state.lang==="hu"?"hu-HU":"en-US")} Ft</div>
              <div class="stock">${escapeHtml(t("stock"))}: <b>${escapeHtml(stock)}</b></div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    grid.innerHTML = html;
    state.renderedOnce = true;
  }

  function setupTopbar(){
    const inp = $("#search");
    if(inp){
      inp.placeholder = t("search");
      inp.value = state.q;
      inp.oninput = () => {
        state.q = inp.value || "";
        renderGrid();
      };
    }

    const btn = $("#langToggle");
    if(btn){
      btn.onclick = () => {
        state.lang = (state.lang === "hu") ? "en" : "hu";
        localStorage.setItem("sv_lang", state.lang);
        // update UI texts
        $("#search").placeholder = t("search");
        renderNav();
        renderGrid();
      };
    }
  }

  function readLang(){
    const ls = localStorage.getItem("sv_lang");
    if(ls === "en" || ls === "hu") state.lang = ls;
    // try html lang
    const h = document.documentElement.getAttribute("lang");
    if(h === "en" || h === "hu") state.lang = h;
  }

  async function loadAll({forceBust=false}={}){
    const [docRaw, salesRaw] = await Promise.allSettled([
      fetchJson("data/products.json", {forceBust}),
      fetchJson("data/sales.json", {forceBust}),
    ]);

    let doc = state.doc;
    if(docRaw.status === "fulfilled"){
      doc = normalizeDoc(docRaw.value);
    }

    let sales = state.sales;
    if(salesRaw.status === "fulfilled"){
      const s = salesRaw.value;
      sales = Array.isArray(s) ? s : (s && Array.isArray(s.sales) ? s.sales : []);
    }

    return { doc, sales };
  }

  function applyAll(doc, sales){
    // signatures
    const sigDoc = JSON.stringify(doc);
    const sigSales = JSON.stringify(sales);

    const docChanged = sigDoc !== state.lastSigDoc;
    const salesChanged = sigSales !== state.lastSigSales;

    if(!docChanged && !salesChanged) return;

    state.doc = doc;
    state.sales = sales;

    if(docChanged) state.lastSigDoc = sigDoc;
    if(salesChanged) state.lastSigSales = sigSales;

    computeFeaturedByCat();
    renderNav();
    renderGrid();

    if(!state.renderedOnce){
      showApp();
    }


    // popups only when doc changed (or if not open)
    if(docChanged) maybeShowPopups();
  }

  function liveChannel(){
    try{
      const bc = new BroadcastChannel("sv_live");
      bc.onmessage = (e) => {
        const payload = e.data;
        if(payload && payload.doc){
          try{
            applyAll(normalizeDoc(payload.doc), Array.isArray(payload.sales)?payload.sales:state.sales);
          }catch{}
        }
      };
    }catch{}
    // localStorage fallback (same device)
    window.addEventListener("storage", (e) => {
      if(e.key === "sv_live_payload" && e.newValue){
        try{
          const payload = JSON.parse(e.newValue);
          if(payload && payload.doc){
            applyAll(normalizeDoc(payload.doc), Array.isArray(payload.sales)?payload.sales:state.sales);
          }
        }catch{}
      }
    });
  }

  function isPopupDismissed(pu){
    try{
      const key = LS.popupDismissPrefix + pu.id + "_" + Number(pu.rev||0);
      return localStorage.getItem(key) === "1";
    }catch{
      return false;
    }
  }
  function dismissPopup(pu){
    try{
      const key = LS.popupDismissPrefix + pu.id + "_" + Number(pu.rev||0);
      localStorage.setItem(key, "1");
    }catch{}
  }

  function popupProducts(pu){
    const byId = new Map(state.doc.products.map(p => [p.id, p]));
    const out = [];
    const seen = new Set();

    // categories first (sorted by label)
    const cats = [...state.doc.categories].sort((a,b)=>catLabel(a).localeCompare(catLabel(b), loc()));
    for(const c of cats){
      if(!(pu.categoryIds||[]).includes(c.id)) continue;
      const prods = state.doc.products
        .filter(p => p.visible !== false && p.categoryId === c.id)
        .sort((a,b)=>{
          const fa = productFlavor(a), fb = productFlavor(b);
          const cf = fa.localeCompare(fb, loc());
          if(cf !== 0) return cf;
          return productName(a).localeCompare(productName(b), loc());
        });
      for(const p of prods){
        if(seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }

    // explicit products
    for(const pid of (pu.productIds||[])){
      const p = byId.get(pid);
      if(!p) continue;
      if(p.visible === false) continue;
      if(seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }

    return out;
  }

  function ensurePopupStyles(){
    if(document.getElementById("svPopupStyle")) return;
    const st = document.createElement("style");
    st.id = "svPopupStyle";
    st.textContent = `
      .sv-pop-bg{
        position:fixed; inset:0;
        background: rgba(0,0,0,.62);
        display:flex; align-items:center; justify-content:center;
        z-index:9999;
        padding:18px;
      }
      .sv-pop{
        width:min(980px, 96vw);
        border-radius: 22px;
        background: rgba(18,18,20,.94);
        border: 1px solid rgba(255,255,255,.12);
        box-shadow: 0 30px 80px rgba(0,0,0,.55);
        overflow:hidden;
        will-change: transform;
      }
      .sv-pop-head{
        display:flex; align-items:center; justify-content:space-between;
        padding:16px 16px 12px 16px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .sv-pop-title{
        font-size: 16px;
        font-weight: 900;
        letter-spacing: .2px;
      }
      .sv-pop-sub{
        font-size: 12px;
        opacity: .75;
        margin-top: 2px;
      }
      .sv-pop-close{
        width: 36px; height: 36px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.92);
        cursor:pointer;
      }
      .sv-pop-body{ padding: 14px 14px 0 14px; }

      .sv-slider{
        position: relative;
        overflow: hidden;
      }
      .sv-track{
        display:flex;
        transition: transform 420ms ease;
        will-change: transform;
        transform: translate3d(0,0,0);
      }
      .sv-slide{
        flex: 0 0 100%;
        padding: 8px;
      }
      .sv-pop-foot{
        display:flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 14px 14px 14px;
      }
      .sv-pop-ctrl{
        display:flex;
        gap: 10px;
        align-items:center;
        flex-wrap:wrap;
      }
      .sv-pop-ctrl label{
        display:flex;
        align-items:center;
        gap: 8px;
        font-size: 12px;
        opacity: .9;
        user-select:none;
      }
      .sv-pop-btn{
        border-radius: 14px;
        padding: 10px 14px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.92);
        cursor:pointer;
        font-weight: 800;
      }
      .sv-pop-btn.primary{
        background: rgba(124,92,255,.22);
        border-color: rgba(124,92,255,.35);
      }
      .sv-counter{
        font-size: 12px;
        opacity: .72;
      }
      @media (max-width: 700px){
        .sv-pop{ width: 98vw; }
      }
    `;
    document.head.appendChild(st);
  }

  function maybeShowPopups(){
    if(state.popupOpen) return;
    const all = (state.doc.popups||[]).filter(p => p && p.enabled !== false);
    if(!all.length) return;

    const active = all.filter(p => !isPopupDismissed(p));
    if(!active.length) return;

    showPopups(active);
  }

  function showPopups(popups){
    ensurePopupStyles();
    state.popupOpen = true;

    // sort stable: updatedAt desc, then title
    const list = [...popups].sort((a,b)=>{
      const ua = Number(a.updatedAt||0), ub = Number(b.updatedAt||0);
      if(ua !== ub) return ub - ua;
      return (a.title_hu||a.title_en||a.id).localeCompare((b.title_hu||b.title_en||b.id), loc());
    });

    let popupIndex = 0;
    let autoTimer = null;

    const bg = document.createElement("div");
    bg.className = "sv-pop-bg";

    const modal = document.createElement("div");
    modal.className = "sv-pop";
    bg.appendChild(modal);

    document.body.appendChild(bg);

    function cleanup(){
      try{ clearInterval(autoTimer); }catch{}
      autoTimer = null;
      bg.remove();
      state.popupOpen = false;
    }

    function buildCard(p){
      const price = effectivePrice(p);
      const name = productName(p);
      const flavor = productFlavor(p);
      const stock = (p.status === "soon") ? "—" : String(Math.max(0, p.stock||0));
      const isOut = (p.status === "out") || (p.stock <= 0 && p.status !== "soon");

      const cls = [
        "card",
        (isOut ? "dim out" : (p.status==="soon" ? "soon" : "")),
      ].join(" ");

      return `
        <div class="${cls}" style="max-width:740px;margin:0 auto;">
          <div class="hero">
            <img src="${escapeHtml(p.image||"")}" alt="${escapeHtml(name)}">
            <div class="badges">
              ${p.status==="soon" ? `<span class="badge soon">${escapeHtml(t("coming"))}</span>` : ``}
              ${isOut ? `<span class="badge out">${escapeHtml(t("soldout"))}</span>` : ``}
            </div>
            <div class="overlay-title">
              <div class="name">${escapeHtml(name)}</div>
              <div class="flavor">${escapeHtml(flavor)}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="meta-row">
              <div class="price">${price.toLocaleString(state.lang==="hu"?"hu-HU":"en-US")} Ft</div>
              <div class="stock">${escapeHtml(t("stock"))}: <b>${escapeHtml(stock)}</b></div>
            </div>
          </div>
        </div>
      `;
    }

    function renderPopup(){
      try{ clearInterval(autoTimer); }catch{}
      autoTimer = null;

      const pu = list[popupIndex];
      const items = popupProducts(pu);
      const totalPopups = list.length;

      // if nothing to show, skip
      if(!items.length){
        popupIndex++;
        if(popupIndex >= list.length) cleanup();
        else renderPopup();
        return;
      }

      const title = (state.lang === "hu" ? (pu.title_hu||pu.title_en) : (pu.title_en||pu.title_hu)) || t("newTitle");

      // slider clones
      const realN = items.length;
      const slides = (realN > 1)
        ? [items[realN-1], ...items, items[0]]
        : [...items];

      let idx = (realN > 1) ? 1 : 0;

      modal.innerHTML = `
        <div class="sv-pop-head">
          <div>
            <div class="sv-pop-title">${escapeHtml(title)}</div>
            <div class="sv-pop-sub">${escapeHtml(t("newTitle"))} • Popup ${popupIndex+1}/${totalPopups}</div>
          </div>
          <button class="sv-pop-close" id="svPopClose" aria-label="close">✕</button>
        </div>

        <div class="sv-pop-body">
          <div class="sv-slider">
            <div class="sv-track" id="svTrack">
              ${slides.map(p => `<div class="sv-slide">${buildCard(p)}</div>`).join("")}
            </div>
          </div>
        </div>

        <div class="sv-pop-foot">
          <div class="sv-pop-ctrl">
            <label><input type="checkbox" id="svDont"> ${escapeHtml(t("dontShow"))}</label>
            <div class="sv-counter" id="svCounter">${realN>0 ? `1/${realN}` : ``}</div>
          </div>

          <div class="sv-pop-ctrl">
            ${totalPopups > 1 ? `<button class="sv-pop-btn" id="svSkipAll">${escapeHtml(t("skipAll"))}</button>` : ``}
            <button class="sv-pop-btn primary" id="svOk">${escapeHtml(t("ok"))}</button>
          </div>
        </div>
      `;

      const track = modal.querySelector("#svTrack");
      const counter = modal.querySelector("#svCounter");

      function setCounter(){
        if(realN <= 1){
          counter.textContent = `1/1`;
          return;
        }
        const realIdx = idx - 1; // 0..realN-1
        counter.textContent = `${realIdx+1}/${realN}`;
      }

      function setPos(noAnim=false){
        if(!track) return;
        if(noAnim) track.style.transition = "none";
        else track.style.transition = "transform 420ms ease";
        track.style.transform = `translate3d(${-idx*100}%,0,0)`;
        if(noAnim){
          // force reflow
          track.offsetHeight; // eslint-disable-line
          track.style.transition = "transform 420ms ease";
        }
      }

      // init
      if(realN > 1) setPos(true);

      function next(){
        if(realN <= 1) return;
        idx += 1;
        setPos(false);
        setCounter();
      }

      const onEnd = () => {
        if(realN <= 1) return;
        if(idx === slides.length - 1){
          // at clone of first -> jump to first real (idx=1)
          idx = 1;
          setPos(true);
          setCounter();
        }
      };

      track.addEventListener("transitionend", onEnd, { once:false });

      // autoplay (jobbrol-balra mindig)
      if(realN > 1){
        autoTimer = setInterval(next, 2600);
      }
      setCounter();

      const closeBtn = modal.querySelector("#svPopClose");
      const okBtn = modal.querySelector("#svOk");
      const skipBtn = modal.querySelector("#svSkipAll");
      const dont = modal.querySelector("#svDont");

      function proceed({dismissAll=false}={}){
        const dontShow = !!dont.checked;

        if(dismissAll && dontShow){
          for(const p of list){
            dismissPopup(p);
          }
        }else if(dontShow){
          dismissPopup(pu);
        }

        popupIndex++;
        if(popupIndex >= list.length){
          cleanup();
        }else{
          renderPopup();
        }
      }

      closeBtn.onclick = () => proceed({dismissAll:false});
      okBtn.onclick = () => proceed({dismissAll:false});
      if(skipBtn){
        skipBtn.onclick = () => {
          // ha be van pipálva, mindet dismisseljük
          if(dont.checked){
            for(const p of list) dismissPopup(p);
          }
          cleanup();
        };
      }

      // backdrop click: close current (no dismiss)
      bg.onclick = (e) => {
        if(e.target === bg) proceed({dismissAll:false});
      };
    }

    renderPopup();
  }

  async function init(){
    applySyncParams();
    showLoader("Betöltés…");
    readLang();
    setupTopbar();
    liveChannel();

    // init load (force bust)
    try{
      const { doc, sales } = await loadAll({forceBust:true});
      applyAll(doc, sales);
    }catch(e){
      console.error(e);
      showLoader("Betöltési hiba. Nyisd meg újra az oldalt, vagy futtasd a Sync linket az admin Beállításokban.");
    }

    // fast poll while visible; slower when hidden
    let activeMs = 1000;
    let idleMs = 8000;
    let timer = null;

    const tick = async () => {
      const visible = document.visibilityState === "visible";
      try{
        const { doc, sales } = await loadAll({forceBust: visible});
        applyAll(doc, sales);
      }catch{}
      timer = setTimeout(tick, visible ? activeMs : idleMs);
    };
    timer = setTimeout(tick, 1000);

    // burst on focus/visibility change (1-2mp refresh)
    const burst = async () => {
      try{
        const { doc, sales } = await loadAll({forceBust:true});
        applyAll(doc, sales);
      }catch{}
    };
    window.addEventListener("focus", burst);
    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState === "visible") burst();
    });
  }

  // DOM ready
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();