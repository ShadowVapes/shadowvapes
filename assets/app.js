(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu",
    active: "all",
    productsDoc: { categories: [], products: [], popups: [], _meta: null },
    sales: [],
    salesFresh: false,
    search: "",
    etagProducts: "",
    etagSales: "",
    featuredByCat: new Map(), // categoryId -> productId

    // anti-flicker / anti-stale overwrites
    docRev: 0,
    docHash: "",
    salesHash: "",
    lastLiveTs: 0,
  };

  const UI = {
    all: { hu: "Összes termék", en: "All products" },
    soon: { hu: "Hamarosan", en: "Coming soon" },
    stock: { hu: "Készlet", en: "Stock" },
    pcs: { hu: "db", en: "pcs" },
    out: { hu: "Elfogyott", en: "Sold out" },
    hot: { hu: "Felkapott", en: "Trending" },
    newAvail: { hu: "Új termékek elérhetőek", en: "New products available" },
    understood: { hu: "Értettem", en: "Got it" },
    skipAll: { hu: "Összes átugrása", en: "Skip all" },
    dontShow: { hu: "Ne mutasd többször", en: "Don't show again" },
  };

  const t = (k) => (UI[k] ? UI[k][state.lang] : k);

  const locale = () => (state.lang === "en" ? "en" : "hu");

  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  function catLabel(c) {
    return (c && (state.lang === "en" ? (c.label_en || c.label_hu || c.id) : (c.label_hu || c.label_en || c.id))) || "";
  }

  function getName(p) {
    return (p && (p.name_hu || p.name_en || p.name)) || "";
  }
  function getFlavor(p) {
    if (!p) return "";
    return state.lang === "en"
      ? (p.flavor_en || p.flavor_hu || p.flavor || "")
      : (p.flavor_hu || p.flavor_en || p.flavor || "");
  }

  function effectivePrice(p) {
    const price = p && p.price;
    if (price !== null && price !== undefined && price !== "" && Number(price) > 0) return Number(price);
    const c = (state.productsDoc.categories || []).find((x) => String(x.id) === String(p.categoryId));
    const bp = c ? Number(c.basePrice || 0) : 0;
    return Number.isFinite(bp) ? bp : 0;
  }

  function isOut(p) {
    const st = (p && p.status) || "ok";
    const stock = Math.max(0, Number(p && p.stock ? p.stock : 0));
    return st === "out" || stock <= 0;
  }

  function isSoon(p) {
    return ((p && p.status) || "ok") === "soon";
  }

  /* ----------------- Source resolving (RAW preferált, custom domainen is) ----------------- */
  let source = null; // {owner, repo, branch}

  async function validateSource(s){
    try{
      if(!s || !s.owner || !s.repo || !s.branch) return false;
      const testUrl = `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${s.branch}/data/products.json?_=${Date.now()}`;
      const r = await fetch(testUrl, { cache: "no-store" });
      return r.ok;
    }catch{ return false; }
  }

  function getOwnerRepoFromUrl() {
    const host = location.hostname;
    if (!host.endsWith(".github.io")) return null;
    const owner = host.replace(".github.io", "");
    const parts = location.pathname.split("/").filter(Boolean);
    const repo = parts.length ? parts[0] : null;
    if (!repo) return null;
    return { owner, repo };
  }

  function getOwnerRepoCfg() {
    const owner = (localStorage.getItem("sv_owner") || "").trim();
    const repo = (localStorage.getItem("sv_repo") || "").trim();
    const branch = (localStorage.getItem("sv_branch") || "").trim();
    if (!owner || !repo) return null;
    return { owner, repo, branch: branch || null };
  }

  function applySyncParams(){
    try{
      const u = new URL(location.href);
      const o = (u.searchParams.get("sv_owner")||"").trim();
      const r = (u.searchParams.get("sv_repo")||"").trim();
      const b = (u.searchParams.get("sv_branch")||"").trim();
      if(o && r){
        localStorage.setItem("sv_owner", o);
        localStorage.setItem("sv_repo", r);
        if(b) localStorage.setItem("sv_branch", b);
        const src = { owner:o, repo:r, branch: b || "main" };
        localStorage.setItem("sv_source", JSON.stringify(src));
        u.searchParams.delete("sv_owner");
        u.searchParams.delete("sv_repo");
        u.searchParams.delete("sv_branch");
        history.replaceState({}, "", u.pathname + (u.search ? u.search : "") + u.hash);
      }
    }catch{}
  }

  async function resolveSource() {
    if (source) return source;

    try {
      const cached = JSON.parse(localStorage.getItem("sv_source") || "null");
      if (cached && cached.owner && cached.repo && cached.branch) {
        const ok = await validateSource(cached);
        if (ok) {
          source = cached;
          return source;
        }
        try { localStorage.removeItem("sv_source"); } catch {}
      }
    } catch {}

    try {
      const r = await fetch(`data/sv_source.json?_=${Date.now()}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j && j.owner && j.repo) {
          const br = String(j.branch || j.ref || "main").trim();
          source = { owner: String(j.owner).trim(), repo: String(j.repo).trim(), branch: br };
          try { localStorage.setItem("sv_source", JSON.stringify(source)); } catch {}
          return source;
        }
      }
    } catch {}

    const or = getOwnerRepoFromUrl() || getOwnerRepoCfg();
    if (!or) return null;

    const branches = [or.branch, "main", "master", "gh-pages"]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    for (const br of branches) {
      const testUrl = `https://raw.githubusercontent.com/${or.owner}/${or.repo}/${br}/data/products.json?_=${Date.now()}`;
      try {
        const r = await fetch(testUrl, { cache: "no-store" });
        if (r.ok) {
          source = { owner: or.owner, repo: or.repo, branch: br };
          try { localStorage.setItem("sv_source", JSON.stringify(source)); } catch {}
          return source;
        }
      } catch {}
    }

    return null;
  }

  async function fetchJson(relPath, { forceBust=false } = {}){
    const src = await resolveSource();
    const relBase = relPath;
    const rawBase = src ? `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/${relPath}` : null;

    const mkUrl = (base) => forceBust ? `${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}` : base;

    const headers = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    };

    if (rawBase) {
      try {
        const url = mkUrl(rawBase);
        const r = await fetch(url, { cache: "no-store", headers });
        if (r.status === 304) return null;
        if (r.ok) return await r.json();
        try { localStorage.removeItem("sv_source"); } catch {}
        source = null;
      } catch {
        try { localStorage.removeItem("sv_source"); } catch {}
        source = null;
      }
    }

    const url = mkUrl(relBase);
    const r = await fetch(url, { cache: "no-store", headers });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error(`Nem tudtam betölteni: ${relPath} (${r.status})`);
    return await r.json();
  }

  async function fetchProducts({ forceBust=false } = {}){
    return await fetchJson("data/products.json", { forceBust });
  }
  async function fetchSales({ forceBust=false } = {}){
    return await fetchJson("data/sales.json", { forceBust });
  }

  function normalizeDoc(data) {
    if (Array.isArray(data)) return { categories: [], products: data, popups: [], _meta: null };
    const categories = data && Array.isArray(data.categories) ? data.categories : [];
    const products = data && Array.isArray(data.products) ? data.products : [];
    const popups = data && Array.isArray(data.popups) ? data.popups : [];
    const _meta = data && typeof data === "object" ? (data._meta || null) : null;
    return { categories, products, popups, _meta };
  }

  function normalizeSales(data){
    if(!Array.isArray(data)) return [];
    return data.map(s => {
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

  /* ----------------- Featured (Felkapott) ----------------- */
  function computeFeaturedByCategory(){
    state.featuredByCat = new Map();
    if(!state.salesFresh) return; // ✅ ha nem friss a sales, ne találgassunk felkapottat
    const products = (state.productsDoc.products || []).filter(p => p && p.id && p.visible !== false);
    const cats = (state.productsDoc.categories || []);
    const enabledCats = new Set(cats.filter(c => c && c.id && (c.featuredEnabled === false ? false : true)).map(c => String(c.id)));

    // totals: categoryId -> productId -> qty
    const totals = new Map();
    let any = 0;

    for(const sale of (state.sales || [])){
      for(const it of (sale.items || [])){
        const pid = String(it.productId || "");
        const qty = Number(it.qty || 0) || 0;
        if(!pid || qty <= 0) continue;
        const p = products.find(x => String(x.id) === pid);
        if(!p) continue;
        const cid = String(p.categoryId || "");
        if(!cid || !enabledCats.has(cid)) continue;
        any += qty;
        if(!totals.has(cid)) totals.set(cid, new Map());
        const m = totals.get(cid);
        m.set(pid, (m.get(pid)||0) + qty);
      }
    }

    if(any <= 0) return; // ✅ nincs eladás → nincs felkapott

    for(const [cid, m] of totals.entries()){
      let bestPid = null;
      let bestQty = -1;

      for(const [pid, qty] of m.entries()){
        if(qty > bestQty){
          bestQty = qty; bestPid = pid;
        }else if(qty === bestQty && bestPid){
          // tie-break: íz név abc szerint (HU/EN locale)
          const a = products.find(x=>String(x.id)===pid);
          const b = products.find(x=>String(x.id)===bestPid);
          const fa = norm(getFlavor(a));
          const fb = norm(getFlavor(b));
          const cmp = fa.localeCompare(fb, locale());
          if(cmp < 0) bestPid = pid;
        }
      }

      if(bestPid) state.featuredByCat.set(cid, bestPid);
    }
  }


  /* ----------------- Change detection (avoid flicker + stale overwrites) ----------------- */
  function hashStr(str){
    // tiny fast hash (djb2)
    let h = 5381;
    for(let i=0;i<str.length;i++){
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  }
  function docRev(doc){
    const r = doc && doc._meta ? Number(doc._meta.rev || doc._meta.updatedAt || 0) : 0;
    return Number.isFinite(r) ? r : 0;
  }
  function docSig(doc){
    try{
      return hashStr(JSON.stringify({
        c: doc.categories || [],
        p: doc.products || [],
        pp: doc.popups || [],
        m: doc._meta || null
      }));
    }catch{ return ""; }
  }
  function salesSig(sales){
    try{ return hashStr(JSON.stringify(sales || [])); }catch{ return ""; }
  }

  function applyDocIfNewer(nextDoc, { source="net" } = {}){
    const next = normalizeDoc(nextDoc);
    const nextSig = docSig(next);
    if(!nextSig) return false;

    const nextRev = docRev(next);
    const now = Date.now();

    // same content -> nothing
    if(state.docHash && nextSig === state.docHash) return false;

    // protect against stale RAW/Pages caches overwriting a just-saved live payload
    if(state.docRev && nextRev && nextRev < state.docRev) return false;

    // if we have a recent live update with rev, and network doc has no rev -> ignore briefly
    if(state.docRev && !nextRev && state.lastLiveTs && (now - state.lastLiveTs) < 90_000){
      return false;
    }

    state.productsDoc = next;
    state.docHash = nextSig;
    if(nextRev) state.docRev = nextRev;
    if(source === "live") state.lastLiveTs = now;
    return true;
  }

  function applySalesIfChanged(nextSales, { fresh=false } = {}){
    const arr = Array.isArray(nextSales) ? nextSales : [];
    const sig = salesSig(arr);
    if(sig && sig === state.salesHash){
      // keep fresh flag updated only if it becomes true
      if(fresh) state.salesFresh = true;
      return false;
    }
    state.sales = arr;
    state.salesHash = sig;
    state.salesFresh = !!fresh;
    return true;
  }

  /* ----------------- Rendering ----------------- */
  function orderedCategories() {
    const cats = (state.productsDoc.categories || [])
      .filter((c) => c && c.id)
      .map((c) => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id,
        basePrice: Number(c.basePrice || 0),
        featuredEnabled: (c.featuredEnabled === false) ? false : true
      }))
      .sort((a, b) => catLabel(a).localeCompare(catLabel(b), locale()));

    return [
      { id: "all", label_hu: t("all"), label_en: t("all"), virtual: true },
      ...cats,
      { id: "soon", label_hu: t("soon"), label_en: t("soon"), virtual: true },
    ];
  }

  function filterList() {
    const q = norm(state.search);

    let list = (state.productsDoc.products || []).map((p) => ({
      ...p,
      id: String(p.id || ""),
      categoryId: String(p.categoryId || ""),
      status: p.status === "soon" || p.status === "out" || p.status === "ok" ? p.status : "ok",
      stock: Math.max(0, Number(p.stock || 0)),
      visible: (p.visible === false) ? false : true
    })).filter(p => p.id && p.visible !== false);

    if (state.active === "soon") {
      list = list.filter((p) => p.status === "soon");
    } else {
      if (state.active !== "all") list = list.filter((p) => String(p.categoryId) === String(state.active));
    }

    if (q) {
      list = list.filter((p) => norm(getName(p) + " " + getFlavor(p)).includes(q));
    }

    // ✅ order: ok ... then soon ... then out
    const okPart = list.filter((p) => !isOut(p) && !isSoon(p));
    const soonPart = list.filter((p) => !isOut(p) && isSoon(p));
    const outPart = list.filter((p) => isOut(p));

    const groupSort = (arr) => {
      const map = new Map();
      for (const p of arr) {
        const key = norm(getName(p));
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
      const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, locale()));
      const out = [];
      for (const k of keys) {
        const items = map.get(k);
        items.sort((a, b) => norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), locale()));
        out.push(...items);
      }
      return out;
    };

    return [...groupSort(okPart), ...groupSort(soonPart), ...groupSort(outPart)];
  }

  function fmtFt(n) {
    const v = Number(n || 0);
    return v.toLocaleString("hu-HU") + " Ft";
  }

  function renderNav() {
    const nav = $("#nav");
    nav.innerHTML = "";

    const cats = orderedCategories();
    for (const c of cats) {
      const btn = document.createElement("button");
      btn.textContent = c.id === "all" ? t("all") : c.id === "soon" ? t("soon") : catLabel(c);
      if (state.active === c.id) btn.classList.add("active");
      btn.onclick = () => {
        state.active = c.id;
        $("#title").textContent = btn.textContent;
        renderNav();
        renderGrid();
      };
      nav.appendChild(btn);
    }
  }

  function getFeaturedListForAll(){
    const cats = (state.productsDoc.categories || []).filter(c => c && c.id && (c.featuredEnabled === false ? false : true));
    cats.sort((a,b)=>catLabel(a).localeCompare(catLabel(b), locale()));
    const out = [];
    for(const c of cats){
      const pid = state.featuredByCat.get(String(c.id));
      if(!pid) continue;
      const p = (state.productsDoc.products||[]).find(x=>String(x.id)===String(pid));
      if(p && p.visible !== false) out.push(p);
    }
    return out;
  }

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    grid.innerHTML = "";

    let list = filterList();

    // ✅ Featured: kategóriánként 1-1 (ha van eladás) + kategória toggle (admin)
    const featuredIds = new Set();
    let featuredToPrepend = [];

    if(state.active !== "soon"){
      if(state.active === "all"){
        featuredToPrepend = getFeaturedListForAll();
      }else{
        const pid = state.featuredByCat.get(String(state.active));
        if(pid){
          const p = (state.productsDoc.products||[]).find(x=>String(x.id)===String(pid));
          if(p && p.visible !== false) featuredToPrepend = [p];
        }
      }
    }

    for(const fp of featuredToPrepend){
      featuredIds.add(String(fp.id));
    }

    if(featuredToPrepend.length){
      // remove from main list so ne duplázzon
      list = list.filter(p => !featuredIds.has(String(p.id)));
      list = [...featuredToPrepend, ...list];
    }

    $("#count").textContent = String(list.length);
    empty.style.display = list.length ? "none" : "block";

    for (const p of list) {
      const name = getName(p);
      const flavor = getFlavor(p);
      const out = isOut(p);
      const soon = isSoon(p);
      const featured = featuredIds.has(String(p.id));
      const stockShown = out ? 0 : (soon ? Math.max(0, Number(p.stock || 0)) : Math.max(0, Number(p.stock || 0)));
      const price = effectivePrice(p);

      const card = document.createElement("div");
      card.className = "card fade-in" + (out ? " dim" : "") + (soon ? " soon" : "") + (featured ? " featured" : "");

      const hero = document.createElement("div");
      hero.className = "hero";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = (name + (flavor ? " - " + flavor : "")).trim();
      img.src = p.image || "";

      // sold-out legyen szürke (CSS is)
      if (out) {
        img.style.filter = "grayscale(.75) contrast(.95) brightness(.85)";
      }

      const badges = document.createElement("div");
      badges.className = "badges";

      if(featured){
        const b = document.createElement("div");
        b.className = "badge hot";
        b.textContent = t("hot");
        badges.appendChild(b);
      }

      if (soon) {
        const b = document.createElement("div");
        b.className = "badge soon";
        b.textContent = t("soon");
        badges.appendChild(b);
      }

      if (out) {
        const b = document.createElement("div");
        b.className = "badge out";
        b.textContent = t("out");
        badges.appendChild(b);
      }

      const overlay = document.createElement("div");
      overlay.className = "overlay-title";
      overlay.innerHTML = `
        <div class="name">${name}</div>
        <div class="flavor">${flavor}</div>
      `;

      hero.appendChild(img);
      hero.appendChild(badges);
      hero.appendChild(overlay);

      const body = document.createElement("div");
      body.className = "card-body";

      const meta = document.createElement("div");
      meta.className = "meta-row";

      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = fmtFt(price);

      const stockEl = document.createElement("div");
      stockEl.className = "stock";
      stockEl.innerHTML = `${t("stock")}: <b>${soon ? "—" : stockShown} ${soon ? "" : t("pcs")}</b>`;

      meta.appendChild(priceEl);
      meta.appendChild(stockEl);
      body.appendChild(meta);

      card.appendChild(hero);
      card.appendChild(body);

      grid.appendChild(card);
    }
  }

  /* ----------------- Popups (New products) ----------------- */
  function popupHideKey(pp){
    const id = String(pp.id||"");
    const rev = Number(pp.rev || pp.updatedAt || pp.createdAt || 0) || 0;
    return `sv_popup_hide_${id}_${rev}`;
  }

  function buildPopupQueue(){
    const popups = (state.productsDoc.popups || []).filter(pp => pp && pp.id && (pp.enabled === false ? false : true));
    // sort: newest first (admin list is newest first)
    popups.sort((a,b)=>(Number(b.createdAt||0)-Number(a.createdAt||0)));

    const products = (state.productsDoc.products || []).filter(p=>p && p.id && p.visible !== false);
    const cats = (state.productsDoc.categories || []);

    const queue = [];

    for(const pp of popups){
      // skip if user hid this rev
      try{
        if(localStorage.getItem(popupHideKey(pp)) === "1") continue;
      }catch{}

      // collect product ids
      const ids = new Set();
      for(const cid of (pp.categoryIds||[])){
        for(const p of products){
          if(String(p.categoryId) === String(cid)) ids.add(String(p.id));
        }
      }
      for(const pid of (pp.productIds||[])){
        ids.add(String(pid));
      }

      const picked = [...ids].map(id => products.find(p=>String(p.id)===String(id))).filter(Boolean);

      // group by category
      const byCat = new Map();
      for(const p of picked){
        const cid = String(p.categoryId||"");
        if(!byCat.has(cid)) byCat.set(cid, []);
        byCat.get(cid).push(p);
      }

      // sort categories by label
      const catIds = [...byCat.keys()].sort((a,b)=>{
        const ca = cats.find(x=>String(x.id)===String(a));
        const cb = cats.find(x=>String(x.id)===String(b));
        return catLabel(ca).localeCompare(catLabel(cb), locale());
      });

      if(!catIds.length) continue;

      queue.push({
        popup: pp,
        categories: catIds.map(cid => ({
          id: cid,
          label: catLabel(cats.find(x=>String(x.id)===String(cid)) || {id:cid, label_hu:cid, label_en:cid}),
          products: byCat.get(cid)
            .slice()
            .sort((a,b)=> norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), locale()))
        }))
      });
    }

    return queue;
  }

  function showPopupsIfNeeded(){

    // inline popup style (nem nyúlunk a styles.css-hez, de legyen normális mindenhol)
    try{
      if(!document.getElementById("svPopupStyle")){
        const st = document.createElement("style");
        st.id = "svPopupStyle";
        st.textContent = `
          .popup-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.66);display:flex;align-items:center;justify-content:center;padding:18px;z-index:9999}
          .popup-modal{width:min(760px,92vw);max-height:86vh;overflow:hidden;background:rgba(12,12,16,.96);border:1px solid rgba(255,255,255,.10);border-radius:22px;box-shadow:0 18px 70px rgba(0,0,0,.55);padding:16px 16px 14px;display:flex;flex-direction:column;gap:12px}
          .popup-head{display:flex;flex-direction:column;gap:4px}
          .popup-title{font-size:18px;font-weight:800;letter-spacing:.2px}
          .popup-sub{font-size:13px;opacity:.75}
          .popup-carousel{position:relative;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,.08)}
          .popup-track{display:flex;transition:transform .35s ease}
          .popup-item{flex:0 0 100%;display:flex;gap:12px;align-items:center;padding:12px;background:rgba(255,255,255,.02)}
          .popup-img{width:104px;height:104px;border-radius:18px;object-fit:cover;background:rgba(255,255,255,.06)}
          .popup-info{display:flex;flex-direction:column;gap:6px;min-width:0}
          .popup-name{font-weight:900;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .popup-flavor{font-size:13px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .popup-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;opacity:.9}
          .popup-nav{display:flex;align-items:center;justify-content:space-between;gap:10px}
          .popup-dots{font-size:12px;opacity:.75}
          .popup-btns{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
          .popup-chk{display:flex;align-items:center;gap:8px;font-size:13px;opacity:.85;user-select:none}
          .popup-actions{display:flex;gap:10px;align-items:center}
          .popup-actions button{white-space:nowrap}
        `;
        document.head.appendChild(st);
      }
    }catch{}
    const queue = buildPopupQueue();
    if(!queue.length) return;

    // modal DOM
    let bg = document.querySelector("#popupBg");
    if(bg) bg.remove();

    bg = document.createElement("div");
    bg.id = "popupBg";
    bg.className = "popup-backdrop";

    const modal = document.createElement("div");
    modal.className = "popup-modal";
    bg.appendChild(modal);

    document.body.appendChild(bg);

    let popupIndex = 0;
    let catIndex = 0;

    let autoplayTimer = null;

    const cleanupAutoplay = () => {
      if(autoplayTimer) clearInterval(autoplayTimer);
      autoplayTimer = null;
    };

    const closeAll = () => {
      cleanupAutoplay();
      bg.remove();
    };

    const render = () => {
      cleanupAutoplay();

      const cur = queue[popupIndex];
      if(!cur){ closeAll(); return; }

      const curCat = cur.categories[catIndex];
      if(!curCat){
        popupIndex += 1;
        catIndex = 0;
        render();
        return;
      }

      const pp = cur.popup;

      modal.innerHTML = "";

      const top = document.createElement("div");
      top.className = "popup-top";
      top.innerHTML = `
        <div class="popup-title">${(state.lang==="en" ? (pp.title_en || t("newAvail")) : (pp.title_hu || t("newAvail")))}</div>
        <div class="popup-sub">${curCat.label}</div>
      `;

      const carousel = document.createElement("div");
      carousel.className = "popup-carousel";

      const track = document.createElement("div");
      track.className = "popup-track";
      carousel.appendChild(track);

      const items = curCat.products || [];
      let slide = 0;

      const renderSlides = () => {
        track.innerHTML = "";
        for(const p of items){
          const card = document.createElement("div");
          card.className = "popup-item";

          card.innerHTML = `
            <div class="popup-img"><img loading="lazy" src="${p.image || ""}" alt="${(getName(p)+" "+getFlavor(p)).trim()}"></div>
            <div class="popup-meta">
              <div class="popup-name">${getName(p)}</div>
              <div class="popup-flavor">${getFlavor(p)}</div>
              <div class="popup-row">
                <div class="popup-price">${fmtFt(effectivePrice(p))}</div>
                <div class="popup-stock">${t("stock")}: <b>${isSoon(p) ? "—" : (isOut(p)?0:Math.max(0, Number(p.stock||0)))} ${isSoon(p)?"":t("pcs")}</b></div>
              </div>
            </div>
          `;
          track.appendChild(card);
        }
        goTo(slide, true);
      };

      const goTo = (idx, instant=false) => {
        slide = (idx + items.length) % items.length;
        track.style.transition = instant ? "none" : "";
        track.style.transform = `translateX(${slide * -100}%)`;
        updateMid();
        if(instant){
          requestAnimationFrame(()=>{ track.style.transition = ""; });
        }
      };

      renderSlides();

      if(items.length > 1){
        autoplayTimer = setInterval(() => {
          goTo(slide + 1, false);
        }, 3200);
      }

      const nav = document.createElement("div");
      nav.className = "popup-nav";

      const prev = document.createElement("button");
      prev.className = "ghost";
      prev.textContent = "‹";
      prev.onclick = () => goTo(slide - 1, false);

      const next = document.createElement("button");
      next.className = "ghost";
      next.textContent = "›";
      next.onclick = () => goTo(slide + 1, false);

      const mid = document.createElement("div");
      mid.className = "popup-dots";
      const updateMid = () => { mid.textContent = `${slide+1}/${items.length}`; };
      updateMid();

      nav.appendChild(prev);
      nav.appendChild(mid);
      nav.appendChild(next);

      const bottom = document.createElement("div");
      bottom.className = "popup-bottom";

      const dont = document.createElement("label");
      dont.className = "chk";
      dont.innerHTML = `<input type="checkbox" id="ppDont"> ${t("dontShow")}`;

      const btnSkip = document.createElement("button");
      btnSkip.className = "ghost";
      btnSkip.textContent = t("skipAll");
      btnSkip.onclick = () => {
        // nem mentjük hide-ot → kövi betöltésnél újra feldobja
        closeAll();
      };

      const btnOk = document.createElement("button");
      btnOk.className = "primary";
      btnOk.textContent = t("understood");
      btnOk.onclick = () => {
        const chk = modal.querySelector("#ppDont");
        if(chk && chk.checked){
          try{ localStorage.setItem(popupHideKey(pp), "1"); }catch{}
        }
        catIndex += 1;
        render();
      };

      bottom.appendChild(dont);
      bottom.appendChild(btnSkip);
      bottom.appendChild(btnOk);

      modal.appendChild(top);
      modal.appendChild(carousel);
      if(items.length > 1) modal.appendChild(nav);
      modal.appendChild(bottom);
    };

    // click outside closes current popup stack? better: do nothing to avoid accidental
    bg.addEventListener("click", (e) => {
      if(e.target === bg){
        // same as skip all (no hide)
        closeAll();
      }
    });

    render();
  }

  /* ----------------- Init ----------------- */
  function setLangUI(){
    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#search").placeholder = state.lang === "en" ? "Search..." : "Keresés...";
  }

  function initLang(){
    $("#langBtn").onclick = () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem("sv_lang", state.lang);
      setLangUI();
      renderNav();
      renderGrid();
      // popups szöveg is nyelv függő – újrarender
      showPopupsIfNeeded();
    };
  }

  function hydrateFromLivePayload(){
    try{
      const raw = localStorage.getItem("sv_live_payload");
      if(!raw) return false;
      const payload = JSON.parse(raw);
      if(!payload || !payload.doc) return false;

      // csak friss live payloadot fogadjunk el (különben régi eladások / termékek ragadhatnak be)
      const ts = Number(payload.ts || 0) || 0;
      if(!ts || (Date.now() - ts) > 120_000) return false;

      const docChanged = applyDocIfNewer(payload.doc, { source: "live" });

      // sales: csak akkor frissnek tekintjük, ha a payload tényleg mostani
      const salesChanged = applySalesIfChanged(normalizeSales(payload.sales || []), { fresh:true });

      if(docChanged || salesChanged){
        computeFeaturedByCategory();
      }
      return (docChanged || salesChanged);
    }catch{ return false; }
  }

  async function loadAll({ forceBust=false } = {}){
    let changed = false;

    // products
    const docRaw = await fetchProducts({ forceBust });
    if(docRaw){
      const docChanged = applyDocIfNewer(docRaw, { source: "net" });
      if(docChanged) changed = true;
    }

    // sales
    let salesOk = false;
    try{
      const salesRaw = await fetchSales({ forceBust });
      salesOk = true;
      // [] is truthy, so ok
      const sChanged = applySalesIfChanged(normalizeSales(salesRaw || []), { fresh:true });
      if(sChanged) changed = true;
    }catch{
      // ha nem tudjuk biztosan betölteni, ne jelenítsünk meg felkapottat
      state.salesFresh = false;
    }

    // featured depends on BOTH products+sales; csak ha változott valami (vagy ha salesFresh változott)
    if(changed || !state.salesFresh){
      computeFeaturedByCategory();
    }

    return changed;
  }

  async function init() {
    applySyncParams();
    setLangUI();
    initLang();

    // if admin pushed live payload (same browser) use it first
    hydrateFromLivePayload();

    // load from network (RAW) to be sure
    await loadAll({ forceBust:true });

    renderNav();
    renderGrid();

    // show app
    $("#loader").style.display = "none";
    $("#app").style.display = "grid";

    // popups
    showPopupsIfNeeded();

    // live updates from admin (same browser)
    try{
      const bc = new BroadcastChannel("sv_live");
      bc.onmessage = (e) => {
        try{
          if(!e.data) return;

          let changed = false;
          if(e.data.doc){
            changed = applyDocIfNewer(e.data.doc, { source:"live" }) || changed;
          }
          if("sales" in e.data){
            // admin mentés után ez friss
            changed = applySalesIfChanged(normalizeSales(e.data.sales || []), { fresh:true }) || changed;
          }
          if(changed){
            computeFeaturedByCategory();
            renderNav();
            renderGrid();
            showPopupsIfNeeded();
          }
        }catch{}
      };
    }catch{}

    // polling (light)
    const loop = async () => {
      try{
        const changed = await loadAll({ forceBust:false });
        if(changed){
          renderNav();
          renderGrid();
          showPopupsIfNeeded();
        }
      }catch{}
      setTimeout(loop, 25_000);
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadAll({ forceBust:true }).then((changed)=>{ if(changed){ renderNav(); renderGrid(); } showPopupsIfNeeded(); }).catch(()=>{});
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. (Nyisd meg a konzolt.) Ha telefonon vagy ...vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
  });
})();
