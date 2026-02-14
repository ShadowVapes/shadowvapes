(() => {
  const $ = (s) => document.querySelector(s);

  // GitHub helper (public oldalon is, ha van token)
  if(!window.ShadowGH){
    const API = "https://api.github.com";
    const shaCache = new Map();
    const cacheKey = ({ owner, repo, branch, path }) => `${owner}/${repo}@${branch}:${String(path || "")}`;
    const encodePath = (path) => String(path||"").split("/").map(encodeURIComponent).join("/");

    const toBase64Unicode = (str) => {
      const bytes = new TextEncoder().encode(str);
      let bin = "";
      for(const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    };
    const fromBase64Unicode = (b64) => {
      if(!b64) return "";
      const bin = atob(b64);
      const bytes = new Uint8Array([...bin].map(ch => ch.charCodeAt(0)));
      return new TextDecoder().decode(bytes);
    };

    async function ghRequest(token, method, url, body){
      const headers = { "Accept":"application/vnd.github+json", "Content-Type":"application/json" };
      if(token) headers["Authorization"] = `token ${token}`;
      const res = await fetch(url, { method, headers, cache:"no-store", body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let data = null;
      try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }
      if(!res.ok){
        const msg = (data && data.message) ? data.message : `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        err.url = url;
        throw err;
      }
      return data;
    }

    async function getFile({token, owner, repo, path, branch}){
      const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
      const data = await ghRequest(token, "GET", url);
      const content = fromBase64Unicode(data.content || "");
      const sha = data.sha || null;
      try{ shaCache.set(cacheKey({owner, repo, branch, path}), sha); }catch{}
      return { sha, content };
    }

    async function putFile({token, owner, repo, path, branch, message, content, sha}){
      const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
      const body = { message: message || `Update ${path}`, content: toBase64Unicode(content || ""), branch };
      if(sha) body.sha = sha;
      const res = await ghRequest(token, "PUT", url, body);
      const newSha = res?.content?.sha || null;
      if(newSha){
        try{ shaCache.set(cacheKey({owner, repo, branch, path}), newSha); }catch{}
      }
      return res;
    }

    async function putFileSafe({token, owner, repo, path, branch, message, content, sha, retries=3}){
      let curSha = sha || null;
      if(!curSha){
        try{
          const cached = shaCache.get(cacheKey({owner, repo, branch, path}));
          if(cached) curSha = cached;
        }catch{}
      }

      let lastErr = null;
      for(let i=0;i<=retries;i++){
        try{
          return await putFile({token, owner, repo, path, branch, message, content, sha: curSha});
        }catch(e){
          lastErr = e;
          const msg = String(e?.message || "");
          const status = Number(e?.status || 0);
          const shaMissing = status === 422 && /sha/i.test(msg);
          const retryable = shaMissing || status === 409 || msg.includes("does not match") || msg.includes("expected");
          if(i < retries && retryable){
            await new Promise(r => setTimeout(r, 200 + Math.random()*200));
            try{
              const latest = await getFile({token, owner, repo, path, branch});
              curSha = latest.sha || null;
              continue;
            }catch(fetchErr){
              if(Number(fetchErr?.status || 0) === 404){
                curSha = null;
                continue;
              }
              throw e;
            }
          }
          throw e;
        }
      }
      throw lastErr || new Error("Mentés hiba");
    }

    window.ShadowGH = { getFile, putFileSafe };
  }



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

    // reservations + cart
    reservations: [],
    reservationsHash: "",
    reservedByProduct: new Map(), // productId -> reserved qty (active)
    cart: {}, // productId -> qty
    cartMode: "new", // "new" | "modify"
    cartReservationId: null,
    cartView: "edit", // "edit" | "summary" | "done"
    cartConfirmDel: null, // productId
    cartUnlockAt: 0,
    cartPublicCode: null,
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
    expected: { hu: "Várható", en: "Expected" }
  };

  const t = (k) => (UI[k] ? UI[k].hu : k);

  const locale = () => "hu";

  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  function catLabel(c) {
    return (c && (c.label_hu || c.label_en || c.id)) || "";
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

  // ✅ Csak hónap: YYYY-MM -> "December" (évszám nélkül)
  function formatMonth(monthStr) {
    if (!monthStr) return "";
    try {
      const [, month] = String(monthStr).split("-");
      if (!month) return String(monthStr);

      const monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return String(monthStr);

      const monthNamesHU = ["Január", "Február", "Március", "Április", "Május", "Június",
        "Július", "Augusztus", "Szeptember", "Október", "November", "December"];

      return monthNamesHU[monthNum - 1];
    } catch {
      return String(monthStr);
    }
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
        
        // ✅ Kizárjuk az "out" státuszú és 0 készletű termékeket
        if(p.status === "out" || p.stock <= 0) continue;
        
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
function normalizeReservations(data){
  if(!Array.isArray(data)) return [];
  const now = Date.now();
  const out = [];
  for(const r of data){
    if(!r || !r.id) continue;
    const createdAt = String(r.createdAt || r.created || "");
    const expiresAt = String(r.expiresAt || r.expires || "");
    const status = String(r.status || "active");
    const createdMs = createdAt ? Date.parse(createdAt) : NaN;
    const expMs = expiresAt ? Date.parse(expiresAt) : (Number.isFinite(createdMs) ? createdMs + 48*3600*1000 : NaN);

    // lejárt → dobjuk (tűnjön el)
    if(status === "active" && Number.isFinite(expMs) && expMs <= now) continue;

    const items = Array.isArray(r.items) ? r.items.map(it => ({
      productId: String(it.productId || it.pid || ""),
      qty: Math.max(1, Number(it.qty || 1) || 1),
      unitPrice: Math.max(0, Number(it.unitPrice || it.price || 0) || 0),
    })).filter(it => it.productId) : [];

    out.push({
      id: String(r.id),
      publicCode: String(r.publicCode || r.code || ""),
      createdAt: createdAt || (Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString()),
      expiresAt: expiresAt || (Number.isFinite(expMs) ? new Date(expMs).toISOString() : new Date(Date.now()+48*3600*1000).toISOString()),
      status,
      supersededBy: r.supersededBy ? String(r.supersededBy) : null,
      modifiedFlag: !!r.modifiedFlag,
      modifiedAck: !!r.modifiedAck,
      modifiedFrom: r.modifiedFrom ? String(r.modifiedFrom) : null,
      items,
    });
  }
  return out;
}

function hashObj(obj){
  try{
    return String(JSON.stringify(obj)).length + ":" + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).slice(0,64);
  }catch{
    try{ return String(JSON.stringify(obj)).length + ":" + Date.now(); }catch{ return String(Date.now()); }
  }
}

function computeReservedByProduct(){
  const m = new Map();
  for(const r of state.reservations){
    if(!r || r.status !== "active") continue;
    const exp = Date.parse(r.expiresAt || "");
    if(Number.isFinite(exp) && exp <= Date.now()) continue;
    for(const it of (r.items||[])){
      const pid = String(it.productId||"");
      const q = Math.max(0, Number(it.qty||0) || 0);
      if(!pid || !q) continue;
      m.set(pid, (m.get(pid)||0) + q);
    }
  }
  state.reservedByProduct = m;
}

function reservedQty(pid){
  return Math.max(0, Number(state.reservedByProduct.get(String(pid)) || 0) || 0);
}

function cartQty(pid){
  return Math.max(0, Number(state.cart[String(pid)] || 0) || 0);
}

function availQtyForProduct(p){
  if(!p) return 0;
  if(isSoon(p)) return 0;
  const base = Math.max(0, Number(p.stock||0) || 0);
  const res = reservedQty(p.id);
  return Math.max(0, base - res);
}

function applyReservationsIfChanged(list){
  const norm = normalizeReservations(list||[]);
  const h = hashObj(norm);
  if(h === state.reservationsHash) return false;
  state.reservationsHash = h;
  state.reservations = norm;
  computeReservedByProduct();
  return true;
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

/* ----------------- Cart + reservation UI ----------------- */
function ensureTopbarCart(){
  const topbar = document.querySelector(".topbar");
  if(!topbar) return;
  if(document.querySelector("#svCartBtn")) return;

  const btn = document.createElement("button");
  btn.id = "svCartBtn";
  btn.className = "cart-btn";
  btn.type = "button";
  btn.innerHTML = `<span class="cart-ic">🛒</span><span class="cart-txt">Kosár</span><span class="cart-badge" id="svCartBadge" style="display:none">0</span>`;
  btn.onclick = () => openCart();

  topbar.appendChild(btn);
  updateCartBadge();
}

function ensureCartModal(){
  if(document.querySelector("#svCartBg")) return;
  const bg = document.createElement("div");
  bg.id = "svCartBg";
  bg.className = "cart-bg";
  bg.innerHTML = `<div class="cart-modal">
    <div class="cart-head">
      <div class="cart-title" id="svCartTitle">Kosár</div>
      <button class="ghost cart-close" id="svCartClose" type="button">✕</button>
    </div>
    <div class="cart-body" id="svCartBody"></div>
    <div class="cart-foot" id="svCartFoot"></div>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener("click", (e) => { if(e.target === bg) closeCart(); });
  bg.querySelector("#svCartClose").onclick = closeCart;
}

function updateCartBadge(){
  const n = Object.values(state.cart||{}).reduce((a,b)=>a+(Number(b)||0),0);
  const badge = document.querySelector("#svCartBadge");
  if(!badge) return;
  if(n>0){
    badge.style.display = "inline-flex";
    badge.textContent = String(n);
  }else{
    badge.style.display = "none";
    badge.textContent = "0";
  }
}

function openCart(){
  ensureCartModal();
  state.cartView = "edit";
  state.cartConfirmDel = null;
  state.cartUnlockAt = 0;
  state.cartPublicCode = null;
  renderCart();
  document.querySelector("#svCartBg").style.display = "flex";
}

function closeCart(){
  const bg = document.querySelector("#svCartBg");
  if(bg) bg.style.display = "none";
}

function setCartModeNew(){
  state.cartMode = "new";
  state.cartReservationId = null;
}

function setCartModeModify(resId){
  state.cartMode = "modify";
  state.cartReservationId = String(resId||"");
}

function cartItemList(){
  const out = [];
  for(const [pid, qtyRaw] of Object.entries(state.cart||{})){
    const qty = Math.max(0, Number(qtyRaw||0) || 0);
    if(!qty) continue;
    const p = (state.productsDoc.products||[]).find(x=>String(x.id)===String(pid));
    if(!p) continue;
    out.push({ p, qty, unitPrice: effectivePrice(p) });
  }
  out.sort((a,b)=> (getName(a.p)+" "+getFlavor(a.p)).localeCompare(getName(b.p)+" "+getFlavor(b.p), locale()));
  return out;
}

function addToCart(pid, delta=1){
  pid = String(pid||"");
  if(!pid) return;
  const p = (state.productsDoc.products||[]).find(x=>String(x.id)===pid);
  if(!p) return;
  if(isSoon(p)) return;

  const avail = availQtyForProduct(p);
  const cur = cartQty(pid);
  const next = Math.max(0, cur + delta);
  if(next > avail) return;

  state.cart[pid] = next;
  if(!state.cart[pid]) delete state.cart[pid];
  updateCartBadge();
}

function renderCart(){
  ensureCartModal();
  const body = document.querySelector("#svCartBody");
  const foot = document.querySelector("#svCartFoot");
  const title = document.querySelector("#svCartTitle");
  if(!body || !foot || !title) return;

  const items = cartItemList();
  const total = items.reduce((a,it)=>a + it.qty*it.unitPrice, 0);

  title.textContent = state.cartMode === "modify" ? "Foglalás módosítása" : "Kosár";

  if(state.cartView === "done"){
    body.innerHTML = `
      <div class="small-muted">Kész ✅</div>
      <div style="margin-top:10px;font-size:34px;font-weight:900;letter-spacing:1px;">${escapeHtml(state.cartPublicCode || "—")}</div>
      <div class="small-muted">Rendelésazonosító</div>
    `;
    foot.innerHTML = `<button class="primary" type="button" id="svCartDone">Oké</button>`;
    document.querySelector("#svCartDone").onclick = () => {
      closeCart();
      // ürítés
      state.cart = {};
      updateCartBadge();
      setCartModeNew();
    };
    return;
  }

  if(!items.length){
    body.innerHTML = `<div class="small-muted">A kosár üres.</div>`;
    foot.innerHTML = `<button class="ghost" type="button" id="svCartClose2">Bezár</button>`;
    document.querySelector("#svCartClose2").onclick = closeCart;
    return;
  }

  if(state.cartView === "summary"){
    const now = Date.now();
    const locked = now < state.cartUnlockAt;
    const left = Math.max(0, Math.ceil((state.cartUnlockAt - now)/1000));

    body.innerHTML = `
      <div class="small-muted">Összegzés</div>
      <div class="cart-sum">
        ${items.map(it => {
          const name = (getName(it.p) + (getFlavor(it.p) ? " • "+getFlavor(it.p) : "")).trim();
          return `<div class="cart-line">
            <div class="cart-line-name">${escapeHtml(name)}</div>
            <div class="cart-line-qty">× <b>${it.qty}</b></div>
            <div class="cart-line-price"><b>${fmtFt(it.qty*it.unitPrice)}</b></div>
          </div>`;
        }).join("")}
      </div>
      <div class="cart-total">Összesen: <b>${fmtFt(total)}</b></div>
      <div class="small-muted" style="margin-top:8px;">A "Megerősítés" gomb <b>3 másodperc</b> múlva lesz kattintható.</div>
    `;

    foot.innerHTML = `
      <button class="ghost" type="button" id="svBackEdit">Vissza</button>
      <button class="primary" type="button" id="svConfirmBtn" ${locked ? "disabled":""}>Megerősítés${locked ? ` (${left})`:""}</button>
    `;
    document.querySelector("#svBackEdit").onclick = () => { state.cartView="edit"; renderCart(); };
    const btn = document.querySelector("#svConfirmBtn");
    btn.onclick = async () => {
      if(Date.now() < state.cartUnlockAt) return;
      await commitReservation();
    };

    if(locked){
      setTimeout(() => { if(state.cartView==="summary") renderCart(); }, 250);
    }
    return;
  }

  // edit view
  body.innerHTML = `
    <div class="cart-list">
      ${items.map(it => {
        const pid = String(it.p.id);
        const name = (getName(it.p) + (getFlavor(it.p) ? " • "+getFlavor(it.p) : "")).trim();
        const avail = availQtyForProduct(it.p);
        const resv = reservedQty(pid);
        const stock = Math.max(0, Number(it.p.stock||0)||0);
        const remaining = Math.max(0, avail - it.qty);

        const confirm = state.cartConfirmDel === pid;

        return `<div class="cart-item">
          <div class="cart-item-top">
            <div>
              <div class="cart-item-name">${escapeHtml(name)}</div>
              <div class="small-muted">Készlet: <b>${stock}</b> • Foglalt: <b>${resv}</b> • Elérhető: <b>${avail}</b></div>
            </div>
            <div class="cart-ctrl">
              <button class="ghost" type="button" data-minus="${escapeHtml(pid)}">−</button>
              <div class="cart-qty">${it.qty}</div>
              <button class="ghost" type="button" data-plus="${escapeHtml(pid)}" ${remaining<=0 ? "disabled":""}>+</button>
            </div>
          </div>
          ${confirm ? `<div class="cart-confirm">
            <div style="font-weight:800;">Biztos szeretnéd törölni a "${escapeHtml(name)}" terméket?</div>
            <div style="display:flex;gap:10px;margin-top:10px;">
              <button class="danger" type="button" data-yesdel="${escapeHtml(pid)}">Igen</button>
              <button class="ghost" type="button" data-nodel="${escapeHtml(pid)}">Mégse</button>
            </div>
          </div>` : ``}
        </div>`;
      }).join("")}
    </div>
    <div class="cart-total">Összesen: <b>${fmtFt(total)}</b></div>
  `;

  foot.innerHTML = `
    <button class="ghost" type="button" id="svCloseEdit">Bezár</button>
    <button class="primary" type="button" id="svReserveBtn">${state.cartMode==="modify" ? "Foglalás módosítása" : "Foglalás"}</button>
  `;

  document.querySelector("#svCloseEdit").onclick = closeCart;
  document.querySelector("#svReserveBtn").onclick = () => {
    state.cartView = "summary";
    state.cartUnlockAt = Date.now() + 3000;
    renderCart();
  };

  body.querySelectorAll("button[data-plus]").forEach(b => {
    b.onclick = () => { addToCart(b.dataset.plus, +1); renderCart(); };
  });
  body.querySelectorAll("button[data-minus]").forEach(b => {
    b.onclick = () => {
      const pid = b.dataset.minus;
      const cur = cartQty(pid);
      if(cur <= 1){
        state.cartConfirmDel = pid;
        renderCart();
      }else{
        addToCart(pid, -1);
        renderCart();
      }
    };
  });
  body.querySelectorAll("button[data-yesdel]").forEach(b => {
    b.onclick = () => {
      const pid = b.dataset.yesdel;
      delete state.cart[pid];
      state.cartConfirmDel = null;
      updateCartBadge();
      renderCart();
    };
  });
  body.querySelectorAll("button[data-nodel]").forEach(b => {
    b.onclick = () => {
      state.cartConfirmDel = null;
      renderCart();
    };
  });
}

function genId(prefix){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function genPublicCode(reservations){
  // 3 számjegy, próbáljon nem ütközni aktívval
  const activeCodes = new Set((reservations||[]).filter(r=>r && r.status==="active").map(r=>String(r.publicCode||"")));
  for(let i=0;i<50;i++){
    const code = String(Math.floor(100 + Math.random()*900));
    if(!activeCodes.has(code)) return code;
  }
  return String(Math.floor(100 + Math.random()*900));
}

function getWriteCfg(){
  const token = (localStorage.getItem("sv_token") || "").trim();
  const owner = (localStorage.getItem("sv_owner") || "").trim();
  const repo = (localStorage.getItem("sv_repo") || "").trim();
  const branch = (localStorage.getItem("sv_branch") || "").trim() || "main";
  if(!token || !owner || !repo) return null;
  return { token, owner, repo, branch };
}

async function loadReservationsForWrite(cfg){
  try{
    const f = await ShadowGH.getFile({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: "data/reservations.json" });
    const list = normalizeReservations(JSON.parse(f.content || "[]"));
    return { sha: f.sha || null, list };
  }catch(e){
    if(Number(e?.status || 0) === 404){
      return { sha: null, list: [] };
    }
    throw e;
  }
}

async function saveReservationsForWrite(cfg, list, sha){
  const text = JSON.stringify(list, null, 2);
  const res = await ShadowGH.putFileSafe({
    token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
    path: "data/reservations.json",
    message: "Update reservations.json",
    content: text,
    sha
  });
  return res?.content?.sha || sha || null;
}

async function commitReservation(){
  const items = cartItemList();
  if(!items.length) return;

  // final stock check against current view
  for(const it of items){
    const avail = availQtyForProduct(it.p);
    if(it.qty > avail) return;
  }

  const cfg = getWriteCfg();
  // fallback local-only
  if(!cfg){
    const raw = localStorage.getItem("sv_reservations_local") || "[]";
    let list = [];
    try{ list = normalizeReservations(JSON.parse(raw)); }catch{ list = []; }

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 48*3600*1000).toISOString();
    const publicCode = genPublicCode(list);

    let oldId = null;
    if(state.cartMode === "modify" && state.cartReservationId){
      oldId = String(state.cartReservationId);
      const old = list.find(r => r.id === oldId);
      if(old && old.status === "active"){
        old.status = "superseded";
        old.supersededBy = "pending";
      }
    }

    const newId = genId("r");
    const r = {
      id: newId,
      publicCode,
      createdAt,
      expiresAt,
      status: "active",
      modifiedFlag: (state.cartMode === "modify"),
      modifiedAck: false,
      modifiedFrom: oldId,
      items: items.map(it => ({ productId: String(it.p.id), qty: it.qty, unitPrice: it.unitPrice }))
    };

    if(oldId){
      const old = list.find(x=>x.id===oldId);
      if(old){
        old.supersededBy = newId;
      }
    }

    list.unshift(r);
    try{ localStorage.setItem("sv_reservations_local", JSON.stringify(list)); }catch{}

    applyReservationsIfChanged(list);
    state.cartPublicCode = publicCode;
    state.cartView = "done";
    renderCart();
    return;
  }

  // GH save
  const pack = await loadReservationsForWrite(cfg);
  let list = pack.list;
  let sha = pack.sha;

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48*3600*1000).toISOString();
  const publicCode = genPublicCode(list);

  let oldId = null;
  if(state.cartMode === "modify" && state.cartReservationId){
    oldId = String(state.cartReservationId);
    const old = list.find(r => r.id === oldId);
    if(!old || old.status !== "active"){
      setCartModeNew();
      return;
    }
    old.status = "superseded";
    old.supersededBy = "pending";
  }

  const newId = genId("r");
  const r = {
    id: newId,
    publicCode,
    createdAt,
    expiresAt,
    status: "active",
    modifiedFlag: (state.cartMode === "modify"),
    modifiedAck: false,
    modifiedFrom: oldId,
    items: items.map(it => ({ productId: String(it.p.id), qty: it.qty, unitPrice: it.unitPrice }))
  };

  if(oldId){
    const old = list.find(x=>x.id===oldId);
    if(old) old.supersededBy = newId;
  }

  list.unshift(r);
  sha = await saveReservationsForWrite(cfg, list, sha);

  applyReservationsIfChanged(list);
  state.cartPublicCode = publicCode;
  state.cartView = "done";
  renderCart();
}

function openReservationLookup(){
  ensureCartModal();
  const body = document.querySelector("#svCartBody");
  const foot = document.querySelector("#svCartFoot");
  const title = document.querySelector("#svCartTitle");
  if(!body || !foot || !title) return;

  title.textContent = "Foglalásaim";
  body.innerHTML = `
    <div class="small-muted">Add meg a foglalás ID-t (amit adminon látsz).</div>
    <input id="svResIdInp" placeholder="pl. r_..." class="cart-input" />
    <div class="small-muted" id="svResErr" style="margin-top:10px;display:none;color:var(--danger);">Nem találom ezt a foglalást.</div>
  `;
  foot.innerHTML = `
    <button class="ghost" type="button" id="svResCancel">Mégse</button>
    <button class="primary" type="button" id="svResLoad">Betöltés</button>
  `;
  document.querySelector("#svCartBg").style.display = "flex";
  document.querySelector("#svResCancel").onclick = () => { closeCart(); };
  document.querySelector("#svResLoad").onclick = async () => {
    const rid = (document.querySelector("#svResIdInp").value||"").trim();
    if(!rid) return;

    try{ await loadAll({ forceBust:true }); }catch{}

    const r = (state.reservations||[]).find(x=>String(x.id)===rid && x.status==="active");
    if(!r){
      const err = document.querySelector("#svResErr");
      if(err) err.style.display = "block";
      return;
    }

    state.cart = {};
    for(const it of (r.items||[])){
      state.cart[String(it.productId)] = Math.max(1, Number(it.qty||1)||1);
    }
    setCartModeModify(rid);
    updateCartBadge();
    state.cartView = "edit";
    state.cartConfirmDel = null;
    renderCart();
  };
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

      // Foglalásaim gomb közvetlenül az Összes termék alatt
      if(c.id === "all"){
        const rbtn = document.createElement("button");
        rbtn.className = "nav-res-btn";
        rbtn.textContent = "Foglalásaim";
        rbtn.onclick = () => openReservationLookup();
        nav.appendChild(rbtn);
      }
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
      const baseStock = Math.max(0, Number(p.stock || 0));
      const reserved = reservedQty(p.id);
      const available = soon ? 0 : Math.max(0, baseStock - reserved);
      const stockShown = out ? 0 : (soon ? baseStock : available);
      const price = effectivePrice(p);

      // Determine card classes based on status
      let cardClass = "card fade-in";
      if (out) cardClass += " dim outline-red";
      else if (soon) cardClass += " outline-yellow";
      if (featured) cardClass += " outline-orange";

      const card = document.createElement("div");
      card.className = cardClass;

      const hero = document.createElement("div");
      hero.className = "hero";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = (name + (flavor ? " - " + flavor : "")).trim();
      img.src = p.image || "";

      // sold-out legyen szürke (CSS is)
      if (out) {
        img.style.filter = "grayscale(.75) contrast(.95) brightness(.85)";
      } else if (soon) {
        // hamarosan: kicsit szürkébb, de ne annyira mint az elfogyott
        img.style.filter = "grayscale(.25) contrast(.98) brightness(.92)";
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
        
        // Add expected month badge if available
        if (p.soonEta) {
          const expectedBadge = document.createElement("div");
          expectedBadge.className = "badge soon";
          expectedBadge.textContent = `📅 ${t("expected")}: ${formatMonth(p.soonEta)}`;
          badges.appendChild(expectedBadge);
        }
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

    updateCartBadge();

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
    const queue = buildPopupQueue();
    if(!queue.length) return;

    // Remove existing popup if any
    const existing = document.getElementById("popupBg");
    if(existing) existing.remove();

    // Create popup container
    const bg = document.createElement("div");
    bg.id = "popupBg";
    bg.className = "popup-backdrop";

    const modal = document.createElement("div");
    modal.className = "popup-modal";

    const header = document.createElement("div");
    header.className = "popup-header";

    const content = document.createElement("div");
    content.className = "popup-content";

    const slider = document.createElement("div");
    slider.className = "popup-slider";

    const footer = document.createElement("div");
    footer.className = "popup-footer";

    modal.appendChild(header);
    modal.appendChild(content);
    modal.appendChild(footer);
    bg.appendChild(modal);
    document.body.appendChild(bg);

    let currentPopup = 0;
    let currentSlide = 0; // kategória slide index
    let currentProductSlide = 0; // termék slide index
    let slides = []; // termék slide-ok
    let slideInterval = null;

    function renderPopup() {
        if (currentPopup >= queue.length) {
            bg.remove();
            return;
        }

        const popupData = queue[currentPopup];
        const popup = popupData.popup;
        const categories = popupData.categories;

        if (currentSlide >= categories.length) {
            currentPopup++;
            currentSlide = 0;
            renderPopup();
            return;
        }

        const category = categories[currentSlide];
        const products = category.products;

        if (products.length === 0) {
            currentSlide++;
            renderPopup();
            return;
        }

        // Clear existing slides
        slider.innerHTML = "";
        slides = [];

        // Create slides for each product
        products.forEach((product, index) => {
            const slide = document.createElement("div");
            slide.className = "popup-slide";
            
            const name = getName(product);
            const flavor = getFlavor(product);
            const price = effectivePrice(product);
            const stock = product.stock;
            const isProductSoon = isSoon(product);
            const isProductOut = isOut(product);
            const imgFilter = isProductOut
              ? "grayscale(.75) contrast(.95) brightness(.85)"
              : (isProductSoon ? "grayscale(.25) contrast(.98) brightness(.92)" : "none");
            
            slide.innerHTML = `
                <div class="popup-product-image">
                    <img src="${product.image || ''}" alt="${name} ${flavor}" loading="lazy" style="object-fit: contain;max-height:350px;width:100%;filter:${imgFilter};">
                </div>
                <div class="popup-product-info">
                    <div class="popup-product-name">${name}</div>
                    <div class="popup-product-flavor">${flavor}</div>
                    <div class="popup-product-price">${fmtFt(price)}</div>
                    <div class="popup-product-stock">${t("stock")}: <b>${isProductSoon ? "—" : (isProductOut ? 0 : stock)} ${isProductSoon ? "" : t("pcs")}</b></div>
                    ${product.soonEta ? `<div class="popup-product-expected">${t("expected")}: ${formatMonth(product.soonEta)}</div>` : ''}
                </div>
            `;
            
            slider.appendChild(slide);
            slides.push(slide);
        });

        // ✅ Infinite slider setup: only clone the first slide and append to the end (csak jobbról balra)
        if (slides.length > 1) {
            const firstClone = slides[0].cloneNode(true);
            slider.appendChild(firstClone);
        }

        const totalSlides = slides.length;

        // 🔧 Fontos: a slider szélessége maradjon 100% (különben "szétcsúszik" / belenagyít)
        slider.style.width = "100%";

        function goToSlide(index, animate = true) {
            if (totalSlides <= 1) return;

            currentProductSlide = index;

            if (animate) {
                slider.style.transition = 'transform 0.5s ease';
            } else {
                slider.style.transition = 'none';
            }

            const offset = -currentProductSlide * 100;
            slider.style.transform = `translateX(${offset}%)`;

            // ✅ Ha elérjük a klónt (utolsó slide), azonnal ugorjunk vissza az elsőre (láthatatlan ugrás)
            if (currentProductSlide === totalSlides) {
                setTimeout(() => {
                    slider.style.transition = 'none';
                    currentProductSlide = 0;
                    slider.style.transform = `translateX(0%)`;
                }, 500);
            }

            updateDots();
        }

        function nextSlide() {
            if (slides.length <= 1) return;
            goToSlide(currentProductSlide + 1, true);
        }

        function prevSlide() {
            if (slides.length <= 1) return;
            let newIndex = currentProductSlide - 1;
            if (newIndex < 0) {
                // Ha az elsőnél vagyunk és visszamegyünk, ugorjunk az utolsó igazi slide-ra
                newIndex = totalSlides - 1;
                // Először ugorjunk a klónra (láthatatlan), majd animálva az utolsóra
                slider.style.transition = 'none';
                currentProductSlide = totalSlides;
                slider.style.transform = `translateX(-${currentProductSlide * 100}%)`;
                
                setTimeout(() => {
                    goToSlide(newIndex, true);
                }, 50);
                return;
            }
            goToSlide(newIndex, true);
        }

        // Create dots
        const dots = document.createElement("div");
        dots.className = "popup-dots";
        
        function updateDots() {
            dots.innerHTML = '';
            for(let i = 0; i < totalSlides; i++) {
                const dot = document.createElement("div");
                const displayIndex = currentProductSlide >= totalSlides ? 0 : currentProductSlide;
                dot.className = `popup-dot ${i === displayIndex ? 'active' : ''}`;
                dot.addEventListener('click', () => goToSlide(i));
                dots.appendChild(dot);
            }
        }

        // ✅ Auto slide (csak jobbra)
        if(slideInterval) clearInterval(slideInterval);
        if(totalSlides > 1) {
            slideInterval = setInterval(nextSlide, 4000);
        }

        // Update header and footer
        header.innerHTML = `
            <div class="popup-title">${popup.title_hu || t("newAvail")}</div>
            <div class="popup-subtitle">${category.label}</div>
        `;

        footer.innerHTML = '';
        
        const dontShow = document.createElement("label");
        dontShow.className = "chk";
        dontShow.innerHTML = `<input type="checkbox" id="dontShowAgain"> ${t("dontShow")}`;
        
        // ✅ "Skip all" csak akkor, ha több popup van
        const buttons = document.createElement("div");
        buttons.className = "popup-buttons";
        
        if(queue.length > 1) {
            const skipAllBtn = document.createElement("button");
            skipAllBtn.className = "ghost";
            skipAllBtn.textContent = t("skipAll");
            skipAllBtn.onclick = () => {
                // Hide all popups
                queue.forEach(q => {
                    try {
                        localStorage.setItem(popupHideKey(q.popup), "1");
                    } catch {}
                });
                if(slideInterval) clearInterval(slideInterval);
                bg.remove();
            };
            buttons.appendChild(skipAllBtn);
        }
        
        const understoodBtn = document.createElement("button");
        understoodBtn.className = "primary";
        understoodBtn.textContent = t("understood");
        understoodBtn.onclick = () => {
            const checkbox = document.getElementById("dontShowAgain");
            if(checkbox && checkbox.checked) {
                try {
                    localStorage.setItem(popupHideKey(popup), "1");
                } catch {}
            }
            currentSlide++;
            if(slideInterval) clearInterval(slideInterval);
            renderPopup();
        };
        buttons.appendChild(understoodBtn);
        
        footer.appendChild(dontShow);
        if(totalSlides > 1) footer.appendChild(dots);
        footer.appendChild(buttons);

        // ✅ Navigation arrows (mindkét irányba)
        if(totalSlides > 1) {
            const prevArrow = document.createElement("button");
            prevArrow.className = "popup-arrow prev";
            prevArrow.textContent = "‹";
            prevArrow.onclick = prevSlide;
            
            const nextArrow = document.createElement("button");
            nextArrow.className = "popup-arrow next";
            nextArrow.textContent = "›";
            nextArrow.onclick = nextSlide;
            
            content.appendChild(prevArrow);
            content.appendChild(nextArrow);
        }

        content.innerHTML = '';
        content.appendChild(slider);
        if(totalSlides > 1) updateDots();
        goToSlide(0, false);
    }

    renderPopup();

    // ✅ Swipe support for mobile (mindkét irány)
    let touchStartX = 0;
    let touchEndX = 0;

    content.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });

    content.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;

        if(Math.abs(diff) > swipeThreshold) {
            if(diff > 0) {
                // Swipe left - next
                nextSlide();
            } else {
                // Swipe right - previous
                prevSlide();
            }
        }
    }

    // Close on background click
    bg.addEventListener("click", (e) => {
        if(e.target === bg) {
            if(slideInterval) clearInterval(slideInterval);
            bg.remove();
        }
    });
  }

  /* ----------------- Init ----------------- */
  function setLangUI(){
    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#search").placeholder = "Keresés...";
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

      // sales: csak akkor frissnek tekintjük, ha a payload ténylegesen tartalmaz sales adatot
      const salesChanged = applySalesIfChanged(normalizeSales(payload.sales || []), { fresh: true });
      const resChanged = ("reservations" in payload) ? applyReservationsIfChanged(payload.reservations || []) : false;

      if(docChanged || salesChanged || resChanged){
        computeFeaturedByCategory();
      }
      return (docChanged || salesChanged || resChanged);
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


    // reservations (foglalások)
    try{
      const resRaw = await fetchReservations({ forceBust });
      const rChanged = applyReservationsIfChanged(resRaw || []);
      if(rChanged) changed = true;
    }catch{
      const rChanged = applyReservationsIfChanged([]);
      if(rChanged) changed = true;
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

    ensureTopbarCart();
    ensureCartModal();

    // show app
    $("#loader").style.display = "none";
    $("#app").style.display = "grid";

    // popups
    setTimeout(() => showPopupsIfNeeded(), 500);

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
          if("reservations" in e.data){
            changed = applyReservationsIfChanged(e.data.reservations || []) || changed;
          }
          if(changed){
            computeFeaturedByCategory();
            renderNav();
            renderGrid();
            ensureTopbarCart();
            updateCartBadge();
            setTimeout(() => showPopupsIfNeeded(), 100);
          }
        }catch{}
      };
    }catch{}

    // polling (light) - increased interval for mobile
    const loop = async () => {
      try{
        const changed = await loadAll({ forceBust:false });
        if(changed){
          renderNav();
          renderGrid();
          ensureTopbarCart();
          updateCartBadge();
          setTimeout(() => showPopupsIfNeeded(), 100);
        }
      }catch{}
      setTimeout(loop, 30_000);
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadAll({ forceBust:true }).then((changed)=>{ if(changed){ renderNav(); renderGrid(); } setTimeout(() => showPopupsIfNeeded(), 100); }).catch(()=>{});
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. (Nyisd meg a konzolt.) Ha telefonon vagy ...vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
  });
})();
