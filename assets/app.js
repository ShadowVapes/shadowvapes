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

    // reservations + cart
    reservations: [],
    resFresh: false,
    resHash: "",
    reservedByPid: new Map(), // productId -> reserved qty (active)
    cart: new Map(), // productId -> qty
    cartOpen: false,
    editingReservationId: null, // public: modifying
    convertReservationId: null, // admin: converting reservation -> sale
    isAdmin: false,
    isEmbed: false,
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
    expected: { hu: "Várható", en: "Expected" },
    reserved: { hu: "Foglalva", en: "Reserved" },
    cart: { hu: "Kosár", en: "Cart" },
    addToCart: { hu: "Kosárba", en: "Add to cart" },
    reserve: { hu: "Foglalás", en: "Reserve" },
    modifyReserve: { hu: "Foglalás módosítása", en: "Update reservation" },
    recordSale: { hu: "Eladás rögzítése", en: "Record sale" },
    confirm: { hu: "Megerősítés", en: "Confirm" },
    yes: { hu: "Igen", en: "Yes" },
    no: { hu: "Mégse", en: "Cancel" },
    myRes: { hu: "Foglalásaim", en: "My reservations" },
    salesNav: { hu: "Eladások", en: "Sales" },
    resId: { hu: "Foglalás ID", en: "Reservation ID" },
    load: { hu: "Betöltés", en: "Load" },
    orderCode: { hu: "Rendelésazonosító", en: "Order code" },
    missingToken: { hu: "Nincs beállítva mentés (token). Nyisd meg az Admin Beállításoknál a Sync részt, és mentsd el a GitHub tokent.", en: "Missing token." },
    reservationNotFound: { hu: "Nem találom ezt a foglalást (vagy már lejárt).", en: "Not found." },
    deleteConfirm: { hu: "Biztos szeretnéd törölni a következő terméket?", en: "Are you sure you want to delete this item?" },
    updated: { hu: "Módosítva", en: "Updated" }
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


  async function fetchReservations({ forceBust=false } = {}){
    const { data } = await fetchJson("data/reservations.json", { forceBust, etagKey:"sv_etag_res" });
    return data;
  }

  function normalizeReservations(list){
    if(!Array.isArray(list)) return [];
    const out = [];
    for(const r of list){
      if(!r) continue;
      const id = String(r.id || "");
      if(!id) continue;
      const createdAt = Number(r.createdAt || r.ts || 0) || (typeof r.createdAt === "string" ? Date.parse(r.createdAt) : 0) || 0;
      const expiresAt = Number(r.expiresAt || 0) || (createdAt ? (createdAt + 48*60*60*1000) : 0);
      const status = String(r.status || "active");
      const shortCode = String(r.shortCode || r.code || "");
      const needsAttention = !!r.needsAttention;
      const modifiedFrom = r.modifiedFrom ? String(r.modifiedFrom) : null;
      const itemsRaw = Array.isArray(r.items) ? r.items : [];
      const items = itemsRaw.map(it => ({
        productId: String(it.productId || ""),
        qty: Math.max(0, Number(it.qty || 0) || 0)
      })).filter(it => it.productId && it.qty > 0);
      out.push({ ...r, id, createdAt, expiresAt, status, shortCode, needsAttention, modifiedFrom, items });
    }
    return out;
  }

  function hashJson(v){
    try{
      return String(JSON.stringify(v));
    }catch{
      return String(Date.now());
    }
  }

  function applyReservationsIfChanged(list, { fresh=false } = {}){
    const h = hashJson(list);
    if(h === state.resHash && state.resFresh === fresh) return false;
    state.reservations = list;
    state.resHash = h;
    state.resFresh = fresh;
    computeReservedByPid();
    return true;
  }

  function cleanupExpiredReservations(list){
    const now = Date.now();
    let changed = false;
    const kept = [];
    for(const r of (list||[])){
      if(!r) continue;
      const status = String(r.status || "active");
      if(status === "active" && Number(r.expiresAt || 0) && now >= Number(r.expiresAt || 0)){
        changed = true;
        // drop expired
        continue;
      }
      kept.push(r);
    }
    return { list: kept, changed };
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

  /* ----------------- Toast ----------------- */
  let svToastTimer = null;
  function showToast(msg){
    if(!msg) return;
    let el = document.getElementById("svToast");
    if(!el){
      el = document.createElement("div");
      el.id = "svToast";
      el.className = "sv-toast";
      // inline safety: never affect layout
      el.style.position = "fixed";
      el.style.left = "50%";
      el.style.top = "12px";
      el.style.transform = "translateX(-50%) translateY(-10px)";
      el.style.zIndex = "10000";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    if(svToastTimer) clearTimeout(svToastTimer);
    // longer so it can be read
    svToastTimer = setTimeout(()=>{ try{ el.classList.remove("show"); }catch{} }, 3200);
  }

  /* ----------------- Reservations + Cart helpers ----------------- */
  function computeReservedByPid(){
    const m = new Map();
    const now = Date.now();
    for(const r of (state.reservations||[])){
      if(!r) continue;
      if(String(r.status||"active") !== "active") continue;
      if(Number(r.expiresAt||0) && now >= Number(r.expiresAt||0)) continue;
      for(const it of (r.items||[])){
        const pid = String(it.productId||"");
        const q = Math.max(0, Number(it.qty||0) || 0);
        if(!pid || !q) continue;
        m.set(pid, (m.get(pid)||0) + q);
      }
    }
    state.reservedByPid = m;
  }

  function getReservationById(id){
    const sid = String(id||"");
    return (state.reservations||[]).find(r => String(r.id) === sid) || null;
  }

  function getReservedQty(pid){
    const id = String(pid||"");
    let q = state.reservedByPid.get(id) || 0;
    const exclude = state.editingReservationId || state.convertReservationId;
    if(exclude){
      const r = getReservationById(exclude);
      if(r && String(r.status||"active") === "active" && (!r.expiresAt || Date.now() < Number(r.expiresAt||0))){
        for(const it of (r.items||[])){
          if(String(it.productId||"") === id){
            q = Math.max(0, q - Math.max(0, Number(it.qty||0) || 0));
          }
        }
      }
    }
    return Math.max(0, q);
  }

  function availableStock(p){
    if(!p) return 0;
    if(isSoon(p)) return 0;
    const stock = Math.max(0, Number(p.stock || 0));
    const reserved = getReservedQty(String(p.id));
    return Math.max(0, stock - reserved);
  }

  function cartCount(){
    let n = 0;
    for(const v of state.cart.values()) n += Number(v||0) || 0;
    return n;
  }

  function cartStorageKey(){
    // separate carts for public vs admin mode
    return state.isAdmin ? "sv_cart_admin_v1" : "sv_cart_v1";
  }

  function saveCartToStorage(){
    try{
      const key = cartStorageKey();
      const obj = {};
      for(const [pid, qty] of state.cart.entries()){
        const q = Math.max(0, Number(qty||0) || 0);
        if(q > 0) obj[String(pid)] = q;
      }
      localStorage.setItem(key, JSON.stringify(obj));
    }catch{}
  }

  function loadCartFromStorage(){
    try{
      const key = cartStorageKey();
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      if(!raw || typeof raw !== "object") return false;

      const entries = Object.entries(raw);
      if(!entries.length) return false;

      state.cart.clear();

      for(const [pid, qty] of entries){
        const id = String(pid||"");
        if(!id) continue;

        const p = (state.productsDoc.products||[]).find(x => String(x.id) === id);
        const maxAvail = p ? availableStock(p) : Infinity;
        const q = Math.max(0, Math.min(maxAvail, Number(qty||0) || 0));
        if(q > 0) state.cart.set(id, q);
      }

      return true;
    }catch{
      return false;
    }
  }


  function setCartQty(pid, qty){
    const id = String(pid||"");
    const q = Math.max(0, Number(qty||0) || 0);
    if(!id) return;
    if(q <= 0) state.cart.delete(id);
    else state.cart.set(id, q);
    updateCartBadge();
  }

  function addToCart(pid, delta, label){
    const id = String(pid||"");
    const d = Number(delta||0) || 0;
    if(!id || !d) return;
    const p = (state.productsDoc.products||[]).find(x => String(x.id) === id);
    if(!p) return;

    const maxAvail = availableStock(p);
    const cur = state.cart.get(id) || 0;

    let next = Math.max(0, cur + d);
    if(next > maxAvail) next = Math.max(0, maxAvail);

    if(next <= 0) state.cart.delete(id);
    else state.cart.set(id, next);

    // ensure UI exists so badge updates on first add
    if(!document.getElementById("cartBadge")){
      try{ initCartUI(); }catch{}
    }

    updateCartBadge();

    if(label && d > 0 && next > cur){
      showToast(`${label} kosárba helyezve`);
    }
  }

  function clearCart(){
    state.cart.clear();
    state.editingReservationId = null;
    state.convertReservationId = null;
    updateCartBadge();
  }

  /* ----------------- Nav ----------------- */
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

      // extra: public -> Foglalásaim, admin -> Eladások
      if(c.id === "all"){
        const extra = document.createElement("button");
        const extraId = state.isAdmin ? "sales" : "myres";
        extra.textContent = state.isAdmin ? t("salesNav") : t("myRes");
        if(state.active === extraId) extra.classList.add("active");
        extra.onclick = () => {
          state.active = extraId;
          $("#title").textContent = extra.textContent;
          renderNav();
          renderGrid();
        };
        nav.appendChild(extra);
      }
    }
  }

  function renderMyReservationsView(){
    const grid = $("#grid");
    const empty = $("#empty");
    empty.style.display = "none";
    grid.innerHTML = "";
    $("#count").textContent = "0";
    const wrap = document.createElement("div");
    wrap.className = "panel-card";
    wrap.innerHTML = `
      <div class="panel-card-title">${t("myRes")}</div>
      <div class="panel-card-sub">${t("resId")}: (admin által megadott)</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
        <input id="myResInput" placeholder="${t("resId")}" style="flex:1;min-width:240px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(11,15,23,.35);color:var(--text);padding:10px 12px;outline:none;">
        <button class="primary" id="btnLoadRes">${t("load")}</button>
      </div>
      <div class="small-muted" id="myResMsg" style="margin-top:10px;"></div>
    `;
    grid.appendChild(wrap);
    wrap.querySelector("#btnLoadRes").onclick = async () => {
      const id = String(wrap.querySelector("#myResInput").value||"").trim();
      if(!id) return;
      try{
        await loadAll({ forceBust:true });

    // restore cart after data load
    loadCartFromStorage();
    updateCartBadge();
        const r = getReservationById(id);
        const ok = r && String(r.status||"active") === "active" && (!r.expiresAt || Date.now() < Number(r.expiresAt||0));
        if(!ok){
          wrap.querySelector("#myResMsg").textContent = t("reservationNotFound");
          return;
        }
        // load items to cart
        state.cart.clear();
        for(const it of (r.items||[])){
          state.cart.set(String(it.productId), Math.max(0, Number(it.qty||0)||0));
        }
        state.editingReservationId = String(r.id);
        updateCartBadge();
        openCart();
        wrap.querySelector("#myResMsg").textContent = `${t("updated")}: ${String(r.id)}`;
      }catch(e){
        wrap.querySelector("#myResMsg").textContent = String(e && e.message ? e.message : e);
      }
    };
  }

  function renderSalesView(){
    const grid = $("#grid");
    const empty = $("#empty");
    empty.style.display = "none";
    grid.innerHTML = "";
    const q = (state.search||"").toLowerCase();
    const now = Date.now();
    const activeRes = (state.reservations||[]).filter(r => r && String(r.status||"active") === "active" && (!r.expiresAt || now < Number(r.expiresAt||0)));
    let resList = [...activeRes].sort((a,b)=> Number(b.createdAt||0) - Number(a.createdAt||0));
    if(q){
      resList = resList.filter(r => `${r.id} ${r.shortCode}`.toLowerCase().includes(q));
    }
    let salesList = [...(state.sales||[])].sort((a,b)=> String(b.date).localeCompare(String(a.date)));
    if(q){
      salesList = salesList.filter(s => (`${s.name||""} ${s.payment||""} ${s.id||""}`).toLowerCase().includes(q));
    }
    $("#count").textContent = String(resList.length + salesList.length);
    const secLeft = (ms)=> Math.max(0, Math.ceil(ms/1000));
    const fmtLeft = (r)=>{
      const left = Number(r.expiresAt||0) - now;
      const h = Math.floor(left/3600000);
      const m = Math.floor((left%3600000)/60000);
      return `${h}ó ${m}p`;
    };
    // reservations
    if(resList.length){
      const h = document.createElement("div");
      h.className = "panel-card-title";
      h.style.margin = "6px 0 10px";
      h.textContent = "Foglalások";
      grid.appendChild(h);
      for(const r of resList){
        const row = document.createElement("div");
        row.className = "rowline highlight";
        const itemsCount = (r.items||[]).reduce((a,it)=> a + Number(it.qty||0), 0);
        const leftStr = fmtLeft(r);
        row.innerHTML = `
          <div class="left" style="display:flex;gap:10px;align-items:flex-start;">
            ${r.needsAttention ? `<button class="warn" data-warn="1" title="Módosítva">!</button>` : ``}
            <div>
              <div style="font-weight:900;">${t("orderCode")}: ${escapeHtml(r.shortCode || "—")} <span class="small-muted">• ID: <b>${escapeHtml(r.id)}</b></span></div>
              <div class="small-muted">Tételek: <b>${itemsCount}</b> • Lejár: <b>${escapeHtml(leftStr)}</b></div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="primary" data-sell="${escapeHtml(r.id)}">${t("recordSale")}</button>
          </div>
        `;
        grid.appendChild(row);
        const warnBtn = row.querySelector("button.warn");
        if(warnBtn){
          warnBtn.onclick = async (e)=>{
            e.stopPropagation();
            try{ await markReservationSeen(r.id); await loadAll({ forceBust:true }); renderSalesView(); }catch{}
          };
        }
        row.querySelector("button[data-sell]").onclick = (e)=>{
          e.stopPropagation();
          state.cart.clear();
          for(const it of (r.items||[])) state.cart.set(String(it.productId), Math.max(0, Number(it.qty||0)||0));
          state.convertReservationId = String(r.id);
          updateCartBadge();
          openCart();
        };
      }
    }
    // sales
    const h2 = document.createElement("div");
    h2.className = "panel-card-title";
    h2.style.margin = "16px 0 10px";
    h2.textContent = "Eladások";
    grid.appendChild(h2);
    if(!salesList.length){
      const em = document.createElement("div");
      em.className = "small-muted";
      em.textContent = "Nincs eladás.";
      grid.appendChild(em);
      return;
    }
    for(const s of salesList.slice(0, 250)){
      const row = document.createElement("div");
      row.className = "rowline";
      const itemsCount = (s.items||[]).reduce((a,it)=> a + Number(it.qty||0), 0);
      const rev = (s.items||[]).reduce((a,it)=> a + (Number(it.qty||0)||0) * (Number(it.unitPrice||0)||0), 0);
      row.innerHTML = `
        <div class="left">
          <div style="font-weight:900;">${escapeHtml(s.date)} • ${escapeHtml(s.name||"—")} <span class="small-muted">• ${escapeHtml(s.payment||"")}</span></div>
          <div class="small-muted">Tételek: <b>${itemsCount}</b> • Bevétel: <b>${rev.toLocaleString("hu-HU")} Ft</b></div>
        </div>
      `;
      grid.appendChild(row);
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

    // special views
    if(state.active === "myres"){
      renderMyReservationsView();
      return;
    }
    if(state.active === "sales"){
      renderSalesView();
      return;
    }

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
      const soon = isSoon(p);
      const featured = featuredIds.has(String(p.id));

      const reservedTotal = state.reservedByPid.get(String(p.id)) || 0;
      const reservedEff = getReservedQty(String(p.id));
      const stockRaw = Math.max(0, Number(p.stock || 0));
      const avail = soon ? 0 : Math.max(0, stockRaw - reservedEff);

      const out = isOut(p) || (!soon && avail <= 0);
      const stockShown = out ? 0 : (soon ? stockRaw : avail);
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
      meta.className = "meta-grid";

      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = fmtFt(price);

      const stockEl = document.createElement("div");
      stockEl.className = "stock";
      stockEl.innerHTML = `${t("stock")}: <b>${soon ? "—" : stockShown} ${soon ? "" : t("pcs")}</b>`;

      const resEl = document.createElement("div");
      resEl.className = "reserved";
      resEl.innerHTML = `${t("reserved")}: <b>${soon ? "—" : reservedTotal} ${soon ? "" : t("pcs")}</b>`;

      meta.appendChild(priceEl);
      meta.appendChild(stockEl);
      meta.appendChild(resEl);
      body.appendChild(meta);

      card.appendChild(hero);
      card.appendChild(body);

      // card bottom add button
      const addBtn2 = document.createElement("button");
      addBtn2.className = "card-add-btn";
      addBtn2.type = "button";
      addBtn2.textContent = "Kosárba teszem";
      if(soon || out){
        addBtn2.disabled = true;
      }
      addBtn2.onclick = (e) => {
        e.stopPropagation();
        const label = (name + (flavor ? " • " + flavor : "")).trim();
        addToCart(String(p.id), 1, label);
        flashCart();
      };
      card.appendChild(addBtn2);

      grid.appendChild(card);
    }
  }


  /* ----------------- Cart UI ----------------- */
  let cartEls = null;

  function initCartUI(){
    // topbar: wrap search + add cart button
    try{
      const topbar = document.querySelector(".topbar");
      const search = document.getElementById("search");
      if(topbar && search && !document.getElementById("cartBtn")){
        // create right container and move search into it
        const right = document.createElement("div");
        right.className = "topbar-right";
        search.parentNode.insertBefore(right, search);
        right.appendChild(search);

        const btn = document.createElement("button");
        btn.id = "cartBtn";
        btn.className = "cart-btn";
        btn.type = "button";
        btn.innerHTML = `🛒 <span class="cart-badge" id="cartBadge">0</span>`;
        right.appendChild(btn);
        btn.onclick = () => openCart();
      }
    }catch{}

    // drawer + backdrop
    if(!document.getElementById("cartDrawer")){
      const bg = document.createElement("div");
      bg.className = "cart-backdrop";
      bg.id = "cartBg";

      const drawer = document.createElement("div");
      drawer.className = "cart-drawer";
      drawer.id = "cartDrawer";
      drawer.innerHTML = `
        <div class="cart-head">
          <div style="font-weight:900;">${t("cart")}</div>
          <button class="ghost" id="cartClose">✕</button>
        </div>
        <div class="cart-body" id="cartBody"></div>
        <div class="cart-foot">
          <div class="small-muted" id="cartHint"></div>
          <button class="primary" id="cartAction">${t("reserve")}</button>
        </div>
      `;
      bg.appendChild(drawer);
      document.body.appendChild(bg);

      cartEls = {
        bg,
        drawer,
        body: drawer.querySelector("#cartBody"),
        close: drawer.querySelector("#cartClose"),
        action: drawer.querySelector("#cartAction"),
        hint: drawer.querySelector("#cartHint"),
        badge: document.getElementById("cartBadge")
      };

      cartEls.bg.onclick = (e) => { if(e.target === cartEls.bg) closeCart(); };
      cartEls.close.onclick = () => closeCart();
      cartEls.action.onclick = () => onCartAction();
    }else{
      cartEls = {
        bg: document.getElementById("cartBg"),
        drawer: document.getElementById("cartDrawer"),
        body: document.getElementById("cartBody"),
        close: document.getElementById("cartClose"),
        action: document.getElementById("cartAction"),
        hint: document.getElementById("cartHint"),
        badge: document.getElementById("cartBadge")
      };
    }

    updateCartBadge();
  }


  function ensureCartEls(){
    try{
      if(!cartEls) return false;
      if(!cartEls.bg || !cartEls.drawer || !cartEls.body || !cartEls.action){
        cartEls = {
          bg: document.getElementById("cartBg"),
          drawer: document.getElementById("cartDrawer"),
          body: document.getElementById("cartBody"),
          close: document.getElementById("cartClose"),
          action: document.getElementById("cartAction"),
          hint: document.getElementById("cartHint"),
          badge: document.getElementById("cartBadge")
        };
      }
      return !!(cartEls.bg && cartEls.drawer && cartEls.body && cartEls.action);
    }catch{
      return false;
    }
  }

  function openCart(){
    if(!cartEls) initCartUI();
    ensureCartEls();
    // rehydrate in case something cleared visually
    loadCartFromStorage();
    updateCartBadge();

    if(!cartEls || !cartEls.bg || !cartEls.drawer) return;
    state.cartOpen = true;
    cartEls.bg.classList.add("open");
    cartEls.drawer.classList.add("open");
    renderCart();
  }

  function closeCart(){
    if(!cartEls) return;
    state.cartOpen = false;
    cartEls.drawer.classList.remove("open");
    cartEls.bg.classList.remove("open");
  }

  function flashCart(){
    // subtle pulse on cart badge
    try{
      const b = document.getElementById("cartBtn");
      if(!b) return;
      b.classList.add("pulse");
      setTimeout(() => b.classList.remove("pulse"), 260);
    }catch{}
  }

  function updateCartBadge(){
    try{
      const el = document.getElementById("cartBadge");
      if(el) el.textContent = String(cartCount());
    }catch{}
    // persist cart so it never “disappears”
    saveCartToStorage();
    if(state.cartOpen) renderCart();
  }

  function renderCart(){
    if(!cartEls) return;
    if(!ensureCartEls()) return;
    const items = [...state.cart.entries()];
    if(!items.length){
      cartEls.body.innerHTML = `<div class="small-muted">Üres.</div>`;
      cartEls.action.disabled = true;
      cartEls.hint.textContent = "";
      cartEls.action.textContent = state.isAdmin ? t("recordSale") : (state.editingReservationId ? t("modifyReserve") : t("reserve"));
      return;
    }

    cartEls.action.disabled = false;
    cartEls.action.textContent = state.isAdmin ? t("recordSale") : (state.editingReservationId ? t("modifyReserve") : t("reserve"));
    cartEls.hint.textContent = state.isAdmin
      ? "Kosár → Eladás rögzítése"
      : (state.editingReservationId ? `Foglalás módosítása • ID: ${state.editingReservationId}` : "Kosár → Foglalás");

    const rows = items.map(([pid, qty]) => {
      const p = (state.productsDoc.products||[]).find(x => String(x.id) === String(pid));
      const name = p ? getName(p) : pid;
      const flavor = p ? getFlavor(p) : "";
      const label = (name + (flavor ? " • " + flavor : "")).trim();
      const maxAvail = p ? availableStock(p) : qty;

      return `
        <div class="cart-item">
          <div class="cart-item-left">
            <div class="cart-item-name">${escapeHtml(label)}</div>
            <div class="small-muted">Max: <b>${maxAvail}</b></div>
          </div>
          <div class="cart-qty">
            <button class="ghost" data-minus="${escapeHtml(pid)}">−</button>
            <div class="cart-qty-num">${qty}</div>
            <button class="ghost" data-plus="${escapeHtml(pid)}">+</button>
          </div>
        </div>
      `;
    }).join("");

    cartEls.body.innerHTML = rows;

    cartEls.body.querySelectorAll("button[data-plus]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); addToCart(b.dataset.plus, 1); };
    });
    cartEls.body.querySelectorAll("button[data-minus]").forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const pid = b.dataset.minus;
        const cur = state.cart.get(pid) || 0;
        if(cur <= 1){
          const p = (state.productsDoc.products||[]).find(x => String(x.id) === String(pid));
          const name = p ? getName(p) : pid;
          const flavor = p ? getFlavor(p) : "";
          const label = (name + (flavor ? ", " + flavor : "")).trim();
          showConfirmModal(`${t("deleteConfirm")}<br><b>${escapeHtml(label)}</b>`, async (ok)=>{
            if(ok) setCartQty(pid, 0);
          });
          return;
        }
        addToCart(pid, -1);
      };
    });
  }

  function showConfirmModal(html, cb){
    const bg = document.createElement("div");
    bg.className = "sv-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "sv-modal";
    modal.innerHTML = `
      <div class="sv-modal-title">${t("confirm")}</div>
      <div class="sv-modal-body">${html}</div>
      <div class="sv-modal-actions">
        <button class="primary" id="svYes">${t("yes")}</button>
        <button class="ghost" id="svNo">${t("no")}</button>
      </div>
    `;
    bg.appendChild(modal);
    document.body.appendChild(bg);
    const close = (v)=>{ try{ bg.remove(); }catch{}; if(cb) cb(v); };
    bg.onclick = (e)=>{ if(e.target===bg) close(false); };
    modal.querySelector("#svNo").onclick = ()=> close(false);
    modal.querySelector("#svYes").onclick = ()=> close(true);
  }

  function showSummaryAndConfirm({ title, linesHtml, onConfirm }){
    const bg = document.createElement("div");
    bg.className = "sv-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "sv-modal";
    modal.innerHTML = `
      <div class="sv-modal-title">${escapeHtml(title)}</div>
      <div class="sv-modal-body">${linesHtml}</div>
      <div class="sv-modal-actions">
        <button class="primary" id="svConfirm" disabled>${t("confirm")}</button>
        <button class="ghost" id="svCancel">${t("no")}</button>
      </div>
      <div class="small-muted" style="margin-top:8px;">3 mp...</div>
    `;
    bg.appendChild(modal);
    document.body.appendChild(bg);

    const btnC = modal.querySelector("#svConfirm");
    const btnX = modal.querySelector("#svCancel");

    btnX.onclick = ()=> { try{ bg.remove(); }catch{}; };

    let done = false;
    setTimeout(() => {
      if(done) return;
      btnC.disabled = false;
      modal.querySelector(".small-muted").textContent = "";
    }, 3000);

    btnC.onclick = async () => {
      if(done) return;
      done = true;
      btnC.disabled = true;
      btnX.disabled = true;
      try{
        await onConfirm((infoHtml)=>{
          modal.querySelector(".sv-modal-body").innerHTML = infoHtml;
        });
      }catch(err){
        modal.querySelector(".sv-modal-body").innerHTML = `<div class="small-muted">Hiba: ${escapeHtml(String(err && err.message ? err.message : err))}</div>`;
      }finally{
        btnX.disabled = false;
      }
    };
  }

  async function onCartAction(){
    const items = [...state.cart.entries()].map(([pid, qty]) => ({ pid, qty }));
    if(!items.length) return;

    const lines = items.map(({pid, qty}) => {
      const p = (state.productsDoc.products||[]).find(x => String(x.id) === String(pid));
      const name = p ? getName(p) : pid;
      const flavor = p ? getFlavor(p) : "";
      const label = (name + (flavor ? " • " + flavor : "")).trim();
      return `<div class="rowline" style="margin:0 0 8px 0;"><div><b>${escapeHtml(label)}</b></div><div><b>${qty} ${t("pcs")}</b></div></div>`;
    }).join("");

    if(state.isAdmin){
      // sale: ask details + confirm
      const form = `
        <div class="form-grid" style="margin-bottom:10px;">
          <div class="field third"><label>Dátum</label><input id="svSaleDate" value="${todayISO()}"></div>
          <div class="field third"><label>Név</label><input id="svSaleName" placeholder="pl. Tesó"></div>
          <div class="field third"><label>Vásárlás módja</label><input id="svSalePay" placeholder="készpénz / utalás"></div>
        </div>
        ${lines}
      `;
      showSummaryAndConfirm({
        title: t("recordSale"),
        linesHtml: form,
        onConfirm: async (setBody) => {
          const name = String(document.getElementById("svSaleName")?.value || "").trim();
          const payment = String(document.getElementById("svSalePay")?.value || "").trim();
          const date = String(document.getElementById("svSaleDate")?.value || todayISO()).trim();
          const saleId = await recordSaleFromCart({ name, payment, date, fromReservationId: state.convertReservationId });
          setBody(`<div style="font-weight:900;margin-bottom:6px;">Eladás rögzítve ✅</div><div class="small-muted">ID: <b>${escapeHtml(saleId)}</b></div>`);
          clearCart();
          closeCart();
          await loadAll({ forceBust:true });

    // restore cart after data load
    loadCartFromStorage();
    updateCartBadge();
          renderNav(); renderGrid();
        }
      });
      return;
    }

    // public reservation: confirm
    const title = state.editingReservationId ? t("modifyReserve") : t("reserve");
    showSummaryAndConfirm({
      title,
      linesHtml: lines,
      onConfirm: async (setBody) => {
        const r = await createOrModifyReservationFromCart();
        setBody(`<div style="font-weight:900;margin-bottom:6px;">${t("orderCode")}: <span style="font-size:22px;">${escapeHtml(r.shortCode||"—")}</span></div><div class="small-muted">Köszönjük! (48 óráig aktív)</div>`);
        clearCart();
        closeCart();
        await loadAll({ forceBust:true });

    // restore cart after data load
    loadCartFromStorage();
    updateCartBadge();
        renderNav(); renderGrid();
      }
    });
  }

  function todayISO(){
    try{ return new Date().toISOString().slice(0,10); }catch{ return ""; }
  }

  /* ----------------- GitHub write helpers (public/app) ----------------- */
  function b64encode(str){
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64){
    return decodeURIComponent(escape(atob(b64)));
  }

  async function getWriteCfg(){
    const token = (localStorage.getItem("sv_token") || "").trim();
    if(!token) return null;
    const src = await resolveSource();
    if(!src || !src.owner || !src.repo) return null;
    return { token, owner: src.owner, repo: src.repo, branch: src.branch || "main" };
  }

  async function ghGetFile(cfg, path){
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
    const r = await fetch(url, { headers: { Authorization: `token ${cfg.token}`, Accept: "application/vnd.github+json" }});
    if(r.status === 404) return { sha:null, text:null, exists:false };
    if(!r.ok) throw new Error(`GitHub GET hiba: ${r.status}`);
    const j = await r.json();
    const content = j && j.content ? b64decode((j.content||"").replace(/\n/g,"")) : "";
    return { sha: j.sha, text: content, exists:true };
  }

  async function ghPutFile(cfg, path, text, sha, message){
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
    const body = {
      message,
      content: b64encode(text),
      branch: cfg.branch
    };
    if(sha) body.sha = sha;
    const r = await fetch(url, {
      method:"PUT",
      headers: { Authorization: `token ${cfg.token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify(body)
    });
    if(!r.ok){
      const t = await r.text().catch(()=> "");
      throw new Error(`GitHub PUT hiba: ${r.status} ${t.slice(0,200)}`);
    }
    const j = await r.json();
    return { sha: j.content?.sha || null };
  }

  async function updateJsonFile(path, updater, message){
    const cfg = await getWriteCfg();
    if(!cfg) throw new Error(t("missingToken"));
    for(let attempt=0; attempt<3; attempt++){
      const cur = await ghGetFile(cfg, path);
      const base = cur.text ? JSON.parse(cur.text) : (path.endsWith(".json") ? [] : {});
      const next = updater(base);
      const nextText = JSON.stringify(next, null, 2);
      try{
        await ghPutFile(cfg, path, nextText, cur.sha, message);
        return next;
      }catch(e){
        // retry on sha mismatch
        if(attempt === 2) throw e;
      }
    }
    throw new Error("Mentés sikertelen");
  }

  function makeUid(prefix){
    const p = String(prefix||"id_");
    const rnd = Math.random().toString(36).slice(2, 10);
    return `${p}${Date.now().toString(36)}_${rnd}`;
  }

  function makeShortCode(existing){
    const used = new Set((existing||[]).map(r => String(r.shortCode||"")).filter(Boolean));
    for(let i=0;i<25;i++){
      const code = String(100 + Math.floor(Math.random()*900));
      if(!used.has(code)) return code;
    }
    return String(100 + Math.floor(Math.random()*900));
  }

  async function createOrModifyReservationFromCart(){
    const items = [...state.cart.entries()].map(([productId, qty]) => ({ productId: String(productId), qty: Math.max(0, Number(qty||0)||0) })).filter(it=>it.productId && it.qty>0);
    if(!items.length) throw new Error("Üres.");
    const now = Date.now();
    const oldId = state.editingReservationId ? String(state.editingReservationId) : null;

    const next = await updateJsonFile("data/reservations.json", (arr) => {
      const list = Array.isArray(arr) ? [...arr] : [];
      // cleanup expired while here
      const kept = [];
      for(const r of list){
        if(!r) continue;
        const status = String(r.status||"active");
        const exp = Number(r.expiresAt||0);
        if(status === "active" && exp && now >= exp) continue;
        kept.push(r);
      }
      // mark old replaced
      let resList = kept;
      if(oldId){
        resList = resList.map(r => String(r.id)===oldId ? ({...r, status:"replaced", replacedAt: now, replacedBy: null }) : r);
      }

      const newId = makeUid("r_");
      const code = makeShortCode(resList);
      const rec = {
        id: newId,
        shortCode: code,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 48*60*60*1000,
        status: "active",
        items,
        modifiedFrom: oldId,
        needsAttention: !!oldId
      };

      // link replacedBy
      if(oldId){
        resList = resList.map(r => String(r.id)===oldId ? ({...r, replacedBy: newId}) : r);
      }

      resList.push(rec);
      return resList;
    }, oldId ? "Update reservation" : "Create reservation");

    // return new record
    const newRec = next.find(r => r && r.id && r.status==="active" && r.modifiedFrom === oldId) || next[next.length-1];
    return newRec;
  }

  async function markReservationSeen(id){
    const rid = String(id||"");
    if(!rid) return;
    await updateJsonFile("data/reservations.json", (arr) => {
      const list = Array.isArray(arr) ? [...arr] : [];
      return list.map(r => (r && String(r.id)===rid) ? ({...r, needsAttention:false}) : r);
    }, "Mark reservation seen");
  }

  async function recordSaleFromCart({ name="", payment="", date="", fromReservationId=null } = {}){
    const items = [...state.cart.entries()].map(([pid, qty]) => ({ productId: String(pid), qty: Math.max(0, Number(qty||0)||0) })).filter(it=>it.productId && it.qty>0);
    if(!items.length) throw new Error("Üres.");

    const cfg = await getWriteCfg();
    if(!cfg) throw new Error(t("missingToken"));

    // load products & sales
    const prodFile = await ghGetFile(cfg, "data/products.json");
    const salesFile = await ghGetFile(cfg, "data/sales.json");
    const doc = prodFile.text ? JSON.parse(prodFile.text) : { categories:[], products:[] };
    const sales = salesFile.text ? JSON.parse(salesFile.text) : [];

    // decrement stock
    const prods = Array.isArray(doc.products) ? doc.products : [];
    for(const it of items){
      const p = prods.find(x => String(x.id) === String(it.productId));
      if(!p) throw new Error("Hiányzó termék: " + it.productId);
      const stock = Math.max(0, Number(p.stock||0));
      if(stock < it.qty) throw new Error("Nincs elég készlet: " + (getName(p) || p.id));
      p.stock = stock - it.qty;
    }

    // sale record
    const saleId = makeUid("s_");
    const sale = {
      id: saleId,
      date: date || todayISO(),
      name,
      payment,
      items: items.map(it => {
        const p = prods.find(x => String(x.id)===String(it.productId));
        return { productId: it.productId, qty: it.qty, unitPrice: Number(effectivePrice(p)||0) };
      })
    };
    if(fromReservationId) sale.reservationId = String(fromReservationId);

    const salesNext = Array.isArray(sales) ? [...sales, sale] : [sale];

    // bump meta rev
    doc._meta = doc._meta || {};
    doc._meta.rev = Date.now();

    // save
    await ghPutFile(cfg, "data/products.json", JSON.stringify(doc, null, 2), prodFile.sha, "Sale: update stock");
    await ghPutFile(cfg, "data/sales.json", JSON.stringify(salesNext, null, 2), salesFile.sha, "Sale: append");

    // mark reservation sold if needed
    if(fromReservationId){
      await updateJsonFile("data/reservations.json", (arr) => {
        const list = Array.isArray(arr) ? [...arr] : [];
        return list.map(r => (r && String(r.id)===String(fromReservationId)) ? ({...r, status:"sold", soldAt: Date.now(), saleId }) : r);
      }, "Reservation -> sold");
    }

    return saleId;
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

    // reservations
    try{
      const resRaw = await fetchReservations({ forceBust });
      const cleaned = cleanupExpiredReservations(normalizeReservations(resRaw || []));
      const rChanged = applyReservationsIfChanged(cleaned.list, { fresh:true });
      if(rChanged || cleaned.changed) changed = true;
    }catch{
      state.resFresh = false;
      state.reservations = [];
      state.reservedByPid = new Map();
    }

    // featured depends on BOTH products+sales; csak ha változott valami (vagy ha salesFresh változott)
    if(changed || !state.salesFresh){
      computeFeaturedByCategory();
    }

    return changed;
  }

  async function init() {
    // mode flags
    try{
      const qs = new URLSearchParams(location.search);
      state.isAdmin = qs.get("sv_admin") === "1";
      state.isEmbed = qs.get("sv_embed") === "1";
      if(state.isEmbed) document.documentElement.classList.add("sv-embed");
    }catch{}

    applySyncParams();
    setLangUI();
    initLang();

    initCartUI();

    // if admin pushed live payload (same browser) use it first
    hydrateFromLivePayload();

    // load from network (RAW) to be sure
    await loadAll({ forceBust:true });

    // restore cart after data load
    loadCartFromStorage();
    updateCartBadge();

    renderNav();
    renderGrid();

    // show app
    $("#loader").style.display = "none";
    $("#app").style.display = "grid";

    // popups
    if(!state.isAdmin && !state.isEmbed) setTimeout(() => showPopupsIfNeeded(), 500);

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
            if(!state.isAdmin && !state.isEmbed) setTimeout(() => showPopupsIfNeeded(), 100);
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
          if(!state.isAdmin && !state.isEmbed) setTimeout(() => showPopupsIfNeeded(), 100);
        }
      }catch{}
      setTimeout(loop, 30_000);
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadAll({ forceBust:true }).then((changed)=>{ if(changed){ renderNav(); renderGrid(); } if(!state.isAdmin && !state.isEmbed) setTimeout(() => showPopupsIfNeeded(), 100); }).catch(()=>{});
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. (Nyisd meg a konzolt.) Ha telefonon vagy ...vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
  });
})();
