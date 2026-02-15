(() => {
  const $ = (s) => document.querySelector(s);
  const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

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
    reservationsFresh: false,
    cart: {}, // productId -> qty
    cartOpen: false,
    cartStep: "items", // items | confirm | done
    editingReservationId: null,
    lastReservationPublicCode: null,
  };

  const UI = {
    myRes: { hu: "Foglalásaim", en: "My reservations" },
    cart: { hu: "Kosár", en: "Cart" },
    reserve: { hu: "Foglalás", en: "Reserve" },
    reserveEdit: { hu: "Foglalás módosítása", en: "Update reservation" },
    confirm: { hu: "Megerősítés", en: "Confirm" },
    reserved: { hu: "Foglalt", en: "Reserved" },
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


  /* ----------------- CART + RESERVATIONS ----------------- */
  function cartCount(){
    return Object.values(state.cart||{}).reduce((a,b)=>a+Number(b||0),0);
  }

  function persistCart(){
    try{ localStorage.setItem("sv_cart", JSON.stringify(state.cart||{})); }catch{}
  }
  function loadCart(){
    try{
      const raw = localStorage.getItem("sv_cart");
      if(raw) state.cart = JSON.parse(raw) || {};
    }catch{ state.cart = {}; }
  }

  function ensureCartUI(){
    loadCart();

    // topbar actions wrapper
    const topbar = document.querySelector(".topbar");
    if(!topbar) return;
    if(!topbar.querySelector(".topbar-actions")){
      const actions = document.createElement("div");
      actions.className = "topbar-actions";
      // move search into actions? keep existing layout: title + search, we add button after search
      // We'll just append button next to search by wrapping search + button in a flex container.
      const search = $("#search");
      if(search){
        // create wrapper for search+actions
        const rightWrap = document.createElement("div");
        rightWrap.className = "topbar-actions";
        // replace search position
        search.parentNode.insertBefore(rightWrap, search);
        rightWrap.appendChild(search);

        const btn = document.createElement("button");
        btn.className = "cart-btn";
        btn.id = "cartBtn";
        btn.innerHTML = `🛒 <span id="cartBtnLabel">${t("cart")}</span><span class="cart-badge" id="cartBadge" style="display:none">0</span>`;
        rightWrap.appendChild(btn);

        btn.onclick = () => openCart();
      }
    }

    // modal
    if(!document.querySelector("#cartBg")){
      const bg = document.createElement("div");
      bg.className = "cart-backdrop";
      bg.id = "cartBg";
      bg.innerHTML = `
        <div class="cart-modal">
          <div class="cart-head">
            <div class="cart-title" id="cartTitle">${t("cart")}</div>
            <button class="cart-close" id="cartClose">✕</button>
          </div>
          <div id="cartBody"></div>
          <div class="cart-foot" id="cartFoot"></div>
        </div>
      `;
      document.body.appendChild(bg);
      bg.addEventListener("click",(e)=>{ if(e.target===bg) closeCart(); });
      bg.querySelector("#cartClose").onclick = () => closeCart();
    }

    refreshCartBadge();
  }

  function refreshCartBadge(){
    const b = document.querySelector("#cartBadge");
    if(!b) return;
    const c = cartCount();
    b.textContent = String(c);
    b.style.display = c ? "flex" : "none";
  }

  function availableForProduct(p){
    const pid=String(p.id);
    const reservedMap = computeReservedByProduct();
    const reserved = Number(reservedMap.get(pid)||0);
    const stock = Math.max(0, Number(p.stock||0));
    const out = isOut(p);
    const soon = isSoon(p);
    if(out || soon) return 0;
    return Math.max(0, stock - reserved);
  }

  function addToCart(pid, delta=1){
    pid=String(pid);
    const p = (state.productsDoc.products||[]).find(x=>String(x.id)===pid);
    if(!p) return;
    const avail = availableForProduct(p);
    const cur = Number(state.cart[pid]||0);
    const next = cur + Number(delta||0);
    if(next <= 0){
      delete state.cart[pid];
    }else{
      if(next > avail) return; // no over
      state.cart[pid]=next;
    }
    persistCart();
    refreshCartBadge();
    renderGrid(); // update reserved/available button states and qty hint
    if(state.cartOpen) renderCart();
  }

  function openCart(){
    state.cartOpen = true;
    state.cartStep = "items";
    const bg = document.querySelector("#cartBg");
    if(bg){ bg.style.display="flex"; }
    renderCart();
  }
  function closeCart(){
    state.cartOpen = false;
    const bg = document.querySelector("#cartBg");
    if(bg){ bg.style.display="none"; }
  }

  function cartItemsResolved(){
    const items=[];
    for(const [pid,qty] of Object.entries(state.cart||{})){
      const p = (state.productsDoc.products||[]).find(x=>String(x.id)===String(pid));
      if(!p) continue;
      items.push({ pid:String(pid), qty:Number(qty||0), p });
    }
    return items;
  }

  function renderCart(){
    const body = document.querySelector("#cartBody");
    const foot = document.querySelector("#cartFoot");
    const title = document.querySelector("#cartTitle");
    if(!body || !foot || !title) return;

    const items = cartItemsResolved();

    if(state.cartStep === "confirm"){
      title.textContent = t("reserve");
      const total = items.reduce((a,it)=> a + effectivePrice(it.p)*it.qty, 0);
      body.innerHTML = `
        <div class="notice">
          <div style="font-weight:900;margin-bottom:6px;">Összegzés</div>
          ${items.map(it=>{
            const name=getName(it.p); const flavor=getFlavor(it.p);
            return `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:6px;">
              <div><b>${escapeHtml(name)}${flavor?`, ${escapeHtml(flavor)}`:""}</b> <span class="small-muted">× ${it.qty}</span></div>
              <div><b>${fmtFt(effectivePrice(it.p)*it.qty)}</b></div>
            </div>`;
          }).join("")}
          <div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);">
            <div class="small-muted">Végösszeg</div>
            <div style="font-weight:1000;">${fmtFt(total)}</div>
          </div>
        </div>
        <div class="small-muted" style="margin-top:10px;">A megerősítés gomb 3 másodperc múlva lesz kattintható.</div>
        <div id="confirmMsg" class="small-muted" style="margin-top:6px;"></div>
      `;
      foot.innerHTML = `
        <button class="cart-ghost" id="backToCart">Vissza</button>
        <button class="cart-primary" id="confirmBtn" disabled>${t("confirm")}</button>
      `;
      foot.querySelector("#backToCart").onclick = ()=>{ state.cartStep="items"; renderCart(); };
      const confirmBtn = foot.querySelector("#confirmBtn");
      const msg = body.querySelector("#confirmMsg");
      let left=3;
      msg.textContent = `Még ${left} mp...`;
      const timer = setInterval(()=>{
        left--;
        if(left<=0){
          clearInterval(timer);
          msg.textContent = "Mehet!";
          confirmBtn.disabled = false;
        }else{
          msg.textContent = `Még ${left} mp...`;
        }
      },1000);
      confirmBtn.onclick = async ()=> {
        confirmBtn.disabled=true;
        await submitReservation();
      };
      return;
    }

    if(state.cartStep === "done"){
      title.textContent = t("reserve");
      body.innerHTML = `
        <div class="notice">
          <div style="font-weight:900;">Foglalás létrehozva ✅</div>
          <div class="small-muted" style="margin-top:6px;">Rendelésazonosító:</div>
          <div style="margin-top:10px;"><span class="code3">${escapeHtml(state.lastReservationPublicCode || "000")}</span></div>
          <div class="small-muted" style="margin-top:10px;">Ezt az azonosítót add meg a pultnál.</div>
        </div>
      `;
      foot.innerHTML = `<button class="cart-primary" id="doneOk">Oké</button>`;
      foot.querySelector("#doneOk").onclick = ()=>{ closeCart(); };
      return;
    }

    // items
    title.textContent = t("cart");
    if(!items.length){
      body.innerHTML = `<div class="small-muted" style="margin-top:12px;">A kosár üres.</div>`;
      foot.innerHTML = `<button class="cart-primary" disabled>${t("reserve")}</button>`;
      return;
    }

    body.innerHTML = items.map(it=>{
      const name=getName(it.p); const flavor=getFlavor(it.p);
      return `
        <div class="cart-item">
          <img src="${escapeHtml(it.p.image||"")}" alt="">
          <div>
            <div class="ci-name">${escapeHtml(name)}</div>
            <div class="ci-sub">${escapeHtml(flavor||"")}</div>
            <div class="small-muted" style="margin-top:6px;">${fmtFt(effectivePrice(it.p))} / db</div>
          </div>
          <div class="ci-right">
            <button class="qty-btn" data-minus="${escapeHtml(it.pid)}">−</button>
            <div class="qty-val">${it.qty}</div>
            <button class="qty-btn" data-plus="${escapeHtml(it.pid)}">+</button>
          </div>
        </div>
      `;
    }).join("");

    foot.innerHTML = `
      <button class="cart-ghost" id="clearCart">Ürítés</button>
      <button class="cart-primary" id="reserveBtn">${state.editingReservationId ? t("reserveEdit") : t("reserve")}</button>
    `;

    body.querySelectorAll("button[data-plus]").forEach(b=>{
      b.onclick=()=>addToCart(b.getAttribute("data-plus"), +1);
    });
    body.querySelectorAll("button[data-minus]").forEach(b=>{
      b.onclick=()=>{
        const pid=b.getAttribute("data-minus");
        const cur=Number(state.cart[pid]||0);
        if(cur===1){
          const p=(state.productsDoc.products||[]).find(x=>String(x.id)===String(pid));
          const nm=p?`${getName(p)}${getFlavor(p)?`, ${getFlavor(p)}`:""}`:"terméket";
          // inline confirm
          const bg=document.querySelector("#cartBg");
          const modal=bg.querySelector(".cart-modal");
          const ask=document.createElement("div");
          ask.className="notice";
          ask.innerHTML=`<div style="font-weight:900;">Biztos szeretnéd törölni a "${escapeHtml(nm)}" terméket?</div>
            <div style="display:flex;gap:10px;margin-top:10px;justify-content:flex-end;">
              <button class="cart-ghost" id="noDel">Mégse</button>
              <button class="cart-primary" id="yesDel">Igen</button>
            </div>`;
          // remove old ask if exists
          modal.querySelectorAll(".notice.__ask").forEach(x=>x.remove());
          ask.classList.add("__ask");
          modal.appendChild(ask);
          ask.querySelector("#noDel").onclick=()=>ask.remove();
          ask.querySelector("#yesDel").onclick=()=>{ ask.remove(); addToCart(pid,-1); };
        }else{
          addToCart(pid,-1);
        }
      };
    });

    foot.querySelector("#clearCart").onclick=()=>{ state.cart={}; state.editingReservationId=null; persistCart(); refreshCartBadge(); renderCart(); renderGrid(); };
    foot.querySelector("#reserveBtn").onclick=()=>{
      state.cartStep="confirm";
      renderCart();
    };
  }

  function genPublicCode(){
    return String(Math.floor(Math.random()*1000)).padStart(3,"0");
  }

  async function loadReservationsDocForWrite(){
    // Try GH write if configured
    const token = localStorage.getItem("sv_token") || "";
    const owner = localStorage.getItem("sv_owner") || "";
    const repo = localStorage.getItem("sv_repo") || "";
    const branch = localStorage.getItem("sv_branch") || "main";
    if(token && owner && repo && window.ShadowGH){
      try{
        const r = await ShadowGH.getFile({ token, owner, repo, branch, path:"data/reservations.json" });
        return { mode:"gh", token, owner, repo, branch, sha:r.sha, list: normalizeReservations(JSON.parse(r.content||"[]")) };
      }catch(e){
        if(Number(e?.status||0)===404){
          return { mode:"gh", token, owner, repo, branch, sha:null, list: [] };
        }
        throw e;
      }
    }
    // fallback local
    let list=[];
    try{ list = normalizeReservations(JSON.parse(localStorage.getItem("sv_reservations_local")||"[]")); }catch{}
    return { mode:"local", list };
  }

  async function saveReservationsDoc(ctx){
    if(ctx.mode==="gh"){
      const text = JSON.stringify(ctx.list||[], null, 2);
      const res = await ShadowGH.putFileSafe({
        token: ctx.token, owner: ctx.owner, repo: ctx.repo, branch: ctx.branch,
        path:"data/reservations.json",
        message:"Update reservations.json",
        content: text,
        sha: ctx.sha
      });
      ctx.sha = res?.content?.sha || ctx.sha;
      return true;
    }else{
      try{ localStorage.setItem("sv_reservations_local", JSON.stringify(ctx.list||[])); }catch{}
      return true;
    }
  }

  async function submitReservation(){
    const items = cartItemsResolved();
    if(!items.length){ state.cartStep="items"; renderCart(); return; }

    // build reservation object
    const now = new Date();
    const exp = new Date(Date.now() + 48*60*60*1000);
    const resId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)));
    const code = genPublicCode();

    const resObj = {
      id: resId,
      publicCode: code,
      createdAt: now.toISOString(),
      expiresAt: exp.toISOString(),
      status: "active",
      modified: false,
      modifiedAck: false,
      replacedBy: null,
      previousId: state.editingReservationId || null,
      items: items.map(it=>({
        productId: String(it.pid),
        qty: Number(it.qty),
        price: Number(effectivePrice(it.p)),
        name: getName(it.p),
        flavor: getFlavor(it.p),
        image: it.p.image || ""
      }))
    };

    const ctx = await loadReservationsDocForWrite();
    ctx.list = normalizeReservations(ctx.list||[]);
    // clean expired
    ctx.list = ctx.list.map(r=>{
      if(r.status==="active" && r.expiresAt && Date.parse(r.expiresAt) <= Date.now()){
        return { ...r, status:"expired" };
      }
      return r;
    });

    if(state.editingReservationId){
      const oldId=String(state.editingReservationId);
      ctx.list = ctx.list.map(r=>{
        if(String(r.id)===oldId){
          return { ...r, status:"superseded", modified:true, modifiedAck:false, replacedBy: resId };
        }
        return r;
      });
    }

    ctx.list.unshift(resObj);
    await saveReservationsDoc(ctx);

    // update local state (for stock calc)
    state.reservations = ctx.list;
    state.lastReservationPublicCode = code;
    state.cartStep="done";
    state.cart={};
    state.editingReservationId=null;
    persistCart();
    refreshCartBadge();
    renderGrid();
    renderCart();
  }

  function injectMyReservationsNav(){
    // after nav built
    const nav = document.querySelector("#nav");
    if(!nav) return;
    if(nav.querySelector('[data-special="myres"]')) return;

    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.setAttribute("data-special","myres");
    btn.innerHTML = `🧾 <span>${t("myRes")}</span>`;
    btn.onclick = () => openMyReservationPrompt();
    // insert after first button (all)
    const first = nav.querySelector("button");
    if(first && first.nextSibling) nav.insertBefore(btn, first.nextSibling);
    else nav.appendChild(btn);
  }

  function openMyReservationPrompt(){
    const bg = document.querySelector("#cartBg");
    if(!bg) { ensureCartUI(); }
    openCart();
    const body = document.querySelector("#cartBody");
    const foot = document.querySelector("#cartFoot");
    const title = document.querySelector("#cartTitle");
    title.textContent = t("myRes");
    body.innerHTML = `
      <div class="small-muted" style="margin-top:10px;">Írd be a foglalás belső ID-jét (ezt csak az admin látja).</div>
      <input id="resLookup" placeholder="Foglalás ID..." style="margin-top:10px;width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(11,15,23,.35);color:var(--text);padding:12px;outline:none;">
      <div id="resLookupMsg" class="small-muted" style="margin-top:10px;"></div>
    `;
    foot.innerHTML = `
      <button class="cart-ghost" id="backCart">Vissza</button>
      <button class="cart-primary" id="loadResBtn">Betöltés</button>
    `;
    foot.querySelector("#backCart").onclick=()=>{ state.cartStep="items"; renderCart(); };
    foot.querySelector("#loadResBtn").onclick=async ()=>{
      const id = (body.querySelector("#resLookup").value||"").trim();
      const msg = body.querySelector("#resLookupMsg");
      msg.textContent = "Keresés...";
      try{
        const raw = await fetchReservations({ forceBust:true });
        const list = normalizeReservations(raw||[]);
        const r = list.find(x=>String(x.id)===String(id));
        if(!r || !isReservationActive(r)){
          msg.textContent = "Nincs ilyen aktív foglalás.";
          return;
        }
        // load into cart
        state.cart = {};
        for(const it of (r.items||[])){
          state.cart[String(it.productId)] = Number(it.qty||0);
        }
        state.editingReservationId = String(r.id);
        persistCart();
        refreshCartBadge();
        renderGrid();
        msg.textContent = "Betöltve a kosárba ✅";
        setTimeout(()=>{ state.cartStep="items"; renderCart(); }, 650);
      }catch(e){
        msg.textContent = "Nem sikerült betölteni.";
      }
    };
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
  async function fetchReservations({ forceBust=false } = {}){
    return await fetchJson("data/reservations.json", { forceBust });
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

  function normalizeReservations(arr){
    const now = Date.now();
    const list = Array.isArray(arr) ? arr : [];
    return list.map(r => ({
      id: String(r.id || ""),
      publicCode: String(r.publicCode || ""),
      createdAt: r.createdAt || null,
      expiresAt: r.expiresAt || null,
      status: String(r.status || "active"), // active | converted | expired | superseded
      modified: !!r.modified,
      modifiedAck: !!r.modifiedAck,
      replacedBy: r.replacedBy ? String(r.replacedBy) : null,
      previousId: r.previousId ? String(r.previousId) : null,
      items: Array.isArray(r.items) ? r.items.map(it => ({
        productId: String(it.productId || ""),
        qty: Number(it.qty || 0),
        price: Number(it.price || 0),
        name: String(it.name || ""),
        flavor: String(it.flavor || ""),
        image: String(it.image || "")
      })).filter(x => x.productId && x.qty>0) : []
    })).filter(r => r.id);
  }

  function isReservationActive(r){
    if(!r) return false;
    if(String(r.status) !== "active") return false;
    const exp = r.expiresAt ? Date.parse(r.expiresAt) : 0;
    if(exp && exp <= Date.now()) return false;
    return true;
  }

  function computeReservedByProduct(){
    const map = new Map();
    for(const r of (state.reservations||[])){
      if(!isReservationActive(r)) continue;
      for(const it of (r.items||[])){
        const k=String(it.productId);
        map.set(k, (map.get(k)||0) + Number(it.qty||0));
      }
    }
    return map;
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

  function applyReservationsIfChanged(list, { fresh=false } = {}){
    const h = JSON.stringify(list || []);
    if(h === state.resHash) {
      if(fresh) state.reservationsFresh = true;
      return false;
    }
    state.reservations = list || [];
    state.resHash = h;
    if(fresh) state.reservationsFresh = true;
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
      const reserved = Number(reservedMap.get(String(p.id)) || 0);
      const baseStock = Math.max(0, Number(p.stock || 0));
      const stockShown = out ? 0 : (soon ? baseStock : Math.max(0, baseStock - reserved));
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

      const addBtn = document.createElement('button');
      addBtn.className = 'addcart';
      addBtn.title = 'Kosárba';
      const avail = soon || out ? 0 : Math.max(0, baseStock - reserved);
      addBtn.disabled = avail <= 0;
      addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6h15l-1.5 9h-12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 6l-2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 21a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/><path d="M18 21a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/></svg>`;
      addBtn.onclick = (e) => { e.stopPropagation(); addToCart(p.id, 1); };
      hero.appendChild(addBtn);

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
      const rChanged = applyReservationsIfChanged(normalizeReservations(resRaw || []), { fresh:true });
      if(rChanged) changed = true;
    }catch{
      state.reservationsFresh = false;
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
          if(changed){
            computeFeaturedByCategory();
            renderNav();
            injectMyReservationsNav();
            ensureCartUI();
            renderGrid();
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
