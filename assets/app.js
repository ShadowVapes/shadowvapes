(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu",
    active: "all",
    productsDoc: { categories: [], products: [] },
    search: "",
    etagProducts: "",
    etagSales: "",
    etagPopups: "",
    sales: [],
    popups: [],
    hotByCat: {},
    lastSig: "",
    popupRuntime: { open:false, queue:[], groupIndex:0, itemIndex:0, timer:null, lastQueueSig:"", sessionClosed:false },
  };

  const UI = {
    all: "Összes termék",
    soon: "Hamarosan",
    stock: "Készlet",
    pcs: "db",
    out: "Elfogyott",
  };
  
  
  const TXT = {
    hu: {
      popupTitle: "Új termékek elérhetőek",
      popupSub: "Lapozhatsz nyilakkal vagy húzással – amúgy magától is csúszik.",
      dontShow: "Ne mutasd többet",
      skipAll: "Összes átugrása",
      ok: "Értettem",
      prev: "◀",
      next: "▶"
    },
    en: {
      popupTitle: "New products available",
      popupSub: "Use arrows or swipe – it also auto-slides.",
      dontShow: "Don’t show again",
      skipAll: "Skip all",
      ok: "Got it",
      prev: "◀",
      next: "▶"
    }
  };
  const txt = (k) => {
    const pack = TXT[state.lang] || TXT.hu;
    return (pack && pack[k]) || (TXT.hu[k]) || k;
  };

async function resolveSource() {
    if (source) return source;

    // 1) cache (validáljuk is, mert telón simán lehet régi/rossz)
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
    } catch {}// 2) stabil fájl (admin írja): data/sv_source.json
    try {
      const r = await fetch(`data/sv_source.json?_=${Date.now()}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j && j.owner && j.repo) {
          const br = String(j.branch || j.ref || "main").trim();
          source = { owner: String(j.owner).trim(), repo: String(j.repo).trim(), branch: br };
          try {
            localStorage.setItem("sv_source", JSON.stringify(source));
          } catch {}
          return source;
        }
      }
    } catch {}

    // 3) github.io url / localStorage config
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
          try {
            localStorage.setItem("sv_source", JSON.stringify(source));
          } catch {}
          return source;
        }
      } catch {}
    }

    return null;
  }

  
  function _timeout(ms){
    const c = new AbortController();
    const t = setTimeout(() => c.abort("timeout"), ms);
    return { signal: c.signal, cancel: () => clearTimeout(t) };
  }

  async function fetchJsonFile({ path, etagKey, forceBust = false, timeoutMs = 6500 }){
    const rawBase = state.source && state.source.rawBase ? state.source.rawBase : null;
    const relUrl = path;
    const rawUrl = rawBase ? (rawBase.replace(/\/$/, "") + "/" + path.replace(/^\//,"")) : null;

    async function doFetch(url, allowEtag){
      const headers = { "Cache-Control": "no-store" };
      const prevEtag = state[etagKey] || "";
      if(allowEtag && prevEtag && !forceBust) headers["If-None-Match"] = prevEtag;

      const bustUrl = forceBust ? (url + (url.includes("?") ? "&" : "?") + "_=" + Date.now()) : url;
      const { signal, cancel } = _timeout(timeoutMs);
      try{
        const res = await fetch(bustUrl, { cache: "no-store", headers, signal });
        if(res.status === 304) return { ok:true, notModified:true };
        if(!res.ok) throw new Error(`${path} HTTP ${res.status}`);
        const etag = res.headers.get("etag") || "";
        if(etag) state[etagKey] = etag;
        const json = await res.json();
        return { ok:true, json };
      }finally{ cancel(); }
    }

    try{
      if(rawUrl){
        try{
          return await doFetch(rawUrl, true);
        }catch(e){
          // fallback to relative
          return await doFetch(relUrl, false);
        }
      }
      return await doFetch(relUrl, true);
    }catch(err){
      return { ok:false, err };
    }
  }

  async function fetchProducts({ forceBust = false } = {}){
    const r = await fetchJsonFile({ path:"data/products.json", etagKey:"etagProducts", forceBust });
    if(!r.ok || r.notModified) return r;
    return { ok:true, doc: normalizeDoc(r.json) };
  }

  async function fetchSales({ forceBust = false } = {}){
    const r = await fetchJsonFile({ path:"data/sales.json", etagKey:"etagSales", forceBust });
    if(!r.ok || r.notModified) return r;
    return { ok:true, sales: Array.isArray(r.json) ? r.json : [] };
  }

  async function fetchPopups({ forceBust = false } = {}){
    const r = await fetchJsonFile({ path:"data/popups.json", etagKey:"etagPopups", forceBust });
    if(!r.ok || r.notModified) return r;
    return { ok:true, popups: Array.isArray(r.json) ? r.json : [] };
  }


  function normalizeDoc(data) {
    if (Array.isArray(data)) return { categories: [], products: data };
    const categories = data && Array.isArray(data.categories) ? data.categories : [];
    const products = data && Array.isArray(data.products) ? data.products : [];
    return { categories, products };
  }

  /* ----------------- Rendering ----------------- */
  
  function normalizeSales(sales){
    return Array.isArray(sales) ? sales : [];
  }

  function normalizePopups(popups){
    if(!Array.isArray(popups)) return [];
    const seen = new Set();
    return popups
      .filter(p => p && (p.id || p.title_hu || p.title_en))
      .map(p => ({
        id: String(p.id || ("pp_" + Math.random().toString(16).slice(2))),
        rev: Number.isFinite(Number(p.rev)) ? Number(p.rev) : 1,
        active: !!p.active,
        title_hu: String(p.title_hu || p.title || txt("popupTitle")),
        title_en: String(p.title_en || p.title || TXT.en.popupTitle),
        categories: Array.isArray(p.categories) ? [...new Set(p.categories.map(String).filter(Boolean))] : [],
        products: Array.isArray(p.products) ? [...new Set(p.products.map(String).filter(Boolean))] : [],
      }))
      .filter(p => {
        if(seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
  }

  function computeHotByCat(doc, sales){
    const counts = new Map();
    for(const s of (sales||[])){
      const items = Array.isArray(s.items) ? s.items : [];
      for(const it of items){
        const pid = String(it.productId || "");
        const qty = Number(it.qty || it.quantity || 0);
        if(!pid || !Number.isFinite(qty)) continue;
        counts.set(pid, (counts.get(pid)||0) + qty);
      }
    }

    const locale = state.lang === "hu" ? "hu" : "en";
    const flavorKey = (p) => state.lang === "hu" ? (p.flavor_hu || p.flavor_en || "") : (p.flavor_en || p.flavor_hu || "");
    const out = {};

    const cats = (doc.categories || []).filter(c => c && c.id && c.id !== "soon");
    for(const c of cats){
      if(c.showHot === false) continue;

      const inCat = (doc.products || [])
        .filter(p => p && p.visible !== false)
        .filter(p => String(p.categoryId) === String(c.id))
        .filter(p => p.status !== "soon"); // hamarosan ne legyen felkapott

      let best = null;
      let bestCount = 0;

      for(const p of inCat){
        const cnt = counts.get(String(p.id)) || 0;
        if(cnt > bestCount){
          bestCount = cnt;
          best = p;
        }else if(cnt === bestCount && cnt > 0 && best){
          const a = flavorKey(p);
          const b = flavorKey(best);
          const cmp = a.localeCompare(b, locale, { sensitivity:"base" });
          if(cmp < 0) best = p;
          else if(cmp === 0){
            if(String(p.id).localeCompare(String(best.id)) < 0) best = p;
          }
        }else if(cnt === bestCount && cnt > 0 && !best){
          best = p;
        }
      }

      if(best && bestCount > 0){
        out[String(c.id)] = String(best.id);
      }
    }

    return out;
  }

function orderedCategories() {
    const cats = (state.productsDoc.categories || [])
      .filter((c) => c && c.id)
      .map((c) => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id,
        basePrice: Number(c.basePrice || 0),
      }))
      .sort((a, b) => catLabel(a).localeCompare(catLabel(b), "hu"));

    return [
      { id: "all", label_hu: t("all"), label_en: t("all"), virtual: true },
      ...cats,
      { id: "soon", label_hu: t("soon"), label_en: t("soon"), virtual: true },
    ];
  }

  
  function filterList(){
    const q = (state.search || "").trim().toLowerCase();
    const doc = state.productsDoc || { products: [], categories: [] };
    let list = (doc.products || []).filter(p => p && p.visible !== false);

    // tab filter
    if(state.active === "soon"){
      list = list.filter(p => p.status === "soon");
    }else if(state.active !== "all"){
      list = list.filter(p => String(p.categoryId) === String(state.active));
    }

    // search
    if(q){
      list = list.filter(p => {
        const fields = [
          p.name_hu, p.name_en,
          p.flavor_hu, p.flavor_en,
        ];
        return fields.some(v => String(v||"").toLowerCase().includes(q));
      });
    }

    const locale = state.lang === "hu" ? "hu" : "en";
    const nameKey = (p) => state.lang === "hu" ? (p.name_hu || p.name_en || "") : (p.name_en || p.name_hu || "");
    const flavorKey = (p) => state.lang === "hu" ? (p.flavor_hu || p.flavor_en || "") : (p.flavor_en || p.flavor_hu || "");
    const statusPrio = (s) => (s === "out" ? 2 : (s === "soon" ? 1 : 0));

    // base sort: same név egymás mellett, státusz: ok -> hamarosan -> elfogyott, aztán íz ABC
    list.sort((a,b) => {
      const cmpN = nameKey(a).localeCompare(nameKey(b), locale, { sensitivity:"base" });
      if(cmpN) return cmpN;

      const cmpS = statusPrio(a.status) - statusPrio(b.status);
      if(cmpS) return cmpS;

      return flavorKey(a).localeCompare(flavorKey(b), locale, { sensitivity:"base" });
    });

    // FELKAPOTT priorizálás
    const hot = state.hotByCat || {};
    if(state.active === "all"){
      const cats = orderedCategories().filter(c => c.id !== "all" && c.id !== "soon");
      const hotIds = [];
      for(const c of cats){
        const pid = hot[String(c.id)];
        if(pid) hotIds.push(String(pid));
      }
      if(hotIds.length){
        const hotSet = new Set(hotIds);
        const hotItems = hotIds.map(id => list.find(p => String(p.id) === id)).filter(Boolean);
        const rest = list.filter(p => !hotSet.has(String(p.id)));
        list = hotItems.concat(rest);
      }
    }else if(state.active !== "soon" && state.active !== "all"){
      const pid = hot[String(state.active)];
      if(pid){
        const idx = list.findIndex(p => String(p.id) === String(pid));
        if(idx > 0){
          const it = list.splice(idx,1)[0];
          list.unshift(it);
        }
      }
    }

    return list;
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

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    grid.innerHTML = "";

    const list = filterList();
    const hotSet = new Set(Object.values(state.hotByCat || {}).map(String));
    $("#count").textContent = String(list.length);
    empty.style.display = list.length ? "none" : "block";

    for (const p of list) {
      const name = getName(p);
      const flavor = getFlavor(p);
      const out = isOut(p);
      const stockShown = out ? 0 : Math.max(0, Number(p.stock || 0));
      const price = effectivePrice(p);

      const card = document.createElement("div");
      card.className = "card fade-in" + (out ? " dim" : "");
      if(out) card.classList.add("out");
      if(soon) card.classList.add("soon");
      if(hotSet.has(String(p.id))) card.classList.add("hot");

      const hero = document.createElement("div");
      hero.className = "hero";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = (name + (flavor ? " - " + flavor : "")).trim();
      img.src = p.image || "";

      // státusz alapú szürkeség (CSS nélkül)
      if (out) {
        img.style.filter = "grayscale(1) brightness(0.26) contrast(0.95)";
      } else if (p.status === "soon") {
        img.style.filter = "grayscale(1) brightness(0.66) contrast(0.98)";
      }
      hero.appendChild(img);

      const badges = document.createElement("div");
      badges.className = "badges";
      if (p.status === "soon") {
        const b = document.createElement("div");
        b.className = "badge soon";
        b.textContent = t("soon");
        badges.appendChild(b);
      } else if (out) {
        const b = document.createElement("div");
        b.className = "badge out";
        b.textContent = t("out");
        badges.appendChild(b);
      }
      hero.appendChild(badges);

      const ov = document.createElement("div");
      ov.className = "overlay-title";

      const n = document.createElement("div");
      n.className = "name";
      n.textContent = name || "—";

      const f = document.createElement("div");
      f.className = "flavor";
      f.textContent = flavor || "";
      // olvashatóság (CSS nélkül)
      f.style.fontSize = "16.5px";
      f.style.opacity = "0.96";
      f.style.letterSpacing = "0.2px";

      ov.appendChild(n);
      ov.appendChild(f);
      hero.appendChild(ov);

      const body = document.createElement("div");
      body.className = "card-body";

      // ár + készlet csak a kép alatt
      const meta = document.createElement("div");
      meta.className = "meta-row";

      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = fmtFt(price);

      const stockEl = document.createElement("div");
      stockEl.className = "stock";
      stockEl.innerHTML =
        p.status === "soon"
          ? `${t("stock")}: <b>—</b>`
          : `${t("stock")}: <b>${stockShown}</b> ${t("pcs")}`;
      // olvashatóbb készlet (CSS nélkül)
      stockEl.style.fontSize = "14.5px";
      stockEl.style.opacity = "0.96";
      const sb = stockEl.querySelector("b");
      if (sb) {
        sb.style.fontSize = "15.5px";
        sb.style.opacity = "1";
      }

      meta.appendChild(priceEl);
      meta.appendChild(stockEl);
      body.appendChild(meta);

      card.appendChild(hero);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  /* ----------------- Live updates ----------------- */
  

  function applyData({ doc, sales, popups } = {}) {
    let touched = false;

    if(doc){
      state.productsDoc = doc;
      touched = true;
    }
    if(sales){
      state.sales = normalizeSales(sales);
      touched = true;
    }
    if(popups){
      state.popups = normalizePopups(popups);
      touched = true;
    }

    if(!touched) return;

    // felkapott újraszámolás (sales -> hot)
    state.hotByCat = computeHotByCat(state.productsDoc, state.sales);

    const sig = JSON.stringify({
      doc: state.productsDoc,
      hot: state.hotByCat,
      popups: state.popups
    });

    if(sig && sig === state.lastSig) return;
    state.lastSig = sig;

    renderNav();
    renderGrid();

    $("#loader").style.display = "none";
    $("#app").style.display = "grid";

    maybeShowPopups();
  }

  function applyDoc(doc){
    applyData({ doc });
  }

  
  /* ---------------- Popup (public) ---------------- */
  function _getSeenMap(){
    try{ return JSON.parse(localStorage.getItem("sv_seen_popups") || "{}") || {}; }
    catch{ return {}; }
  }
  function _setSeenMap(m){
    try{ localStorage.setItem("sv_seen_popups", JSON.stringify(m || {})); }catch{}
  }

  function buildPopupQueue(){
    const doc = state.productsDoc || { products: [], categories: [] };
    const products = doc.products || [];
    const cats = doc.categories || [];
    const catById = new Map(cats.map(c => [String(c.id), c]));
    const prodById = new Map(products.map(p => [String(p.id), p]));

    const seen = _getSeenMap();
    const activePopups = (state.popups || [])
      .filter(p => p && p.active)
      .filter(p => {
        const seenRev = Number(seen[p.id] || 0);
        return seenRev < Number(p.rev || 1);
      });

    if(activePopups.length === 0) return [];

    // stabil sorrend: id szerint
    activePopups.sort((a,b) => String(a.id).localeCompare(String(b.id)));

    const locale = state.lang === "hu" ? "hu" : "en";
    const nameKey = (p) => state.lang === "hu" ? (p.name_hu || p.name_en || "") : (p.name_en || p.name_hu || "");
    const flavorKey = (p) => state.lang === "hu" ? (p.flavor_hu || p.flavor_en || "") : (p.flavor_en || p.flavor_hu || "");

    const queue = [];

    for(const popup of activePopups){
      // product set from categories + explicit products
      const set = new Map(); // id -> product
      const fromCats = Array.isArray(popup.categories) ? popup.categories : [];
      const fromProds = Array.isArray(popup.products) ? popup.products : [];

      for(const cid of fromCats){
        for(const p of products){
          if(!p || p.visible === false) continue;
          if(String(p.categoryId) !== String(cid)) continue;
          set.set(String(p.id), p);
        }
      }
      for(const pid of fromProds){
        const p = prodById.get(String(pid));
        if(p && p.visible !== false) set.set(String(p.id), p);
      }

      const byCat = new Map();
      for(const p of set.values()){
        const cid = String(p.categoryId || "misc");
        if(!byCat.has(cid)) byCat.set(cid, []);
        byCat.get(cid).push(p);
      }

      const catIds = Array.from(byCat.keys()).sort((a,b) => {
        const la = (catById.get(a)?.label_hu || catById.get(a)?.label_en || a);
        const lb = (catById.get(b)?.label_hu || catById.get(b)?.label_en || b);
        return String(la).localeCompare(String(lb), locale, { sensitivity:"base" });
      });

      for(const cid of catIds){
        const arr = byCat.get(cid) || [];
        arr.sort((a,b) => {
          const cmpN = nameKey(a).localeCompare(nameKey(b), locale, { sensitivity:"base" });
          if(cmpN) return cmpN;
          return flavorKey(a).localeCompare(flavorKey(b), locale, { sensitivity:"base" });
        });

        const cObj = catById.get(cid);
        const catLabel = state.lang === "hu"
          ? (cObj?.label_hu || cObj?.label_en || cid)
          : (cObj?.label_en || cObj?.label_hu || cid);

        queue.push({
          popupId: popup.id,
          popupRev: Number(popup.rev || 1),
          popupTitle: state.lang === "hu" ? (popup.title_hu || popup.title_en || txt("popupTitle")) : (popup.title_en || popup.title_hu || TXT.en.popupTitle),
          categoryId: cid,
          categoryLabel: String(catLabel),
          products: arr
        });
      }
    }

    // kiszűrjük az üreseket
    return queue.filter(g => Array.isArray(g.products) && g.products.length);
  }

  function ensurePopupDOM(){
    if($("#svPopupBackdrop")) return;

    const el = document.createElement("div");
    el.id = "svPopupBackdrop";
    el.className = "sv-popup-backdrop";
    el.innerHTML = `
      <div class="sv-popup" role="dialog" aria-modal="true">
        <div class="sv-popup-top">
          <div>
            <h3 id="svPopupTitle"></h3>
            <div class="sub" id="svPopupSub"></div>
          </div>
          <button class="sv-btn ghost" id="svPopupClose" aria-label="Close">✕</button>
        </div>

        <div class="sv-popup-body">
          <div class="sv-popup-card" id="svPopupCard">
            <div class="sv-popup-hero"><img id="svPopupImg" alt=""></div>
            <div class="sv-popup-info">
              <div class="sv-popup-name" id="svPopupName"></div>
              <div class="sv-popup-flavor" id="svPopupFlavor"></div>
              <div class="sv-popup-row">
                <div class="sv-popup-price" id="svPopupPrice"></div>
                <div class="sv-popup-stock" id="svPopupStock"></div>
              </div>
            </div>
          </div>

          <div class="sv-popup-nav">
            <div class="sv-popup-arrows">
              <button class="sv-btn ghost" id="svPrev">${txt("prev")}</button>
              <button class="sv-btn ghost" id="svNext">${txt("next")}</button>
            </div>
            <div class="sv-counter" id="svCounter"></div>
          </div>
        </div>

        <div class="sv-popup-footer">
          <label><input type="checkbox" id="svDontShow"><span id="svDontShowLbl"></span></label>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="sv-btn ghost" id="svSkipAll" style="display:none;"></button>
            <button class="sv-btn" id="svOk"></button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    $("#svDontShowLbl").textContent = txt("dontShow");
    $("#svSkipAll").textContent = txt("skipAll");
    $("#svOk").textContent = txt("ok");

    $("#svPopupClose").addEventListener("click", () => popupClose());
    $("#svOk").addEventListener("click", () => popupOk());
    $("#svSkipAll").addEventListener("click", () => popupSkipAll());
    $("#svPrev").addEventListener("click", () => popupPrev());
    $("#svNext").addEventListener("click", () => popupNext());
    // touch swipe (mobile)
    (function(){
      const card = $("#svPopupCard");
      let sx = 0, sy = 0, active = false;
      card.addEventListener("touchstart", (e) => {
        if(!e.touches || !e.touches.length) return;
        active = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, { passive:true });
      card.addEventListener("touchmove", (e) => {
        // prevent vertical scroll lock only if mostly horizontal
      }, { passive:true });
      card.addEventListener("touchend", (e) => {
        if(!active) return;
        active = false;
        const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
        if(!t) return;
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        if(Math.abs(dx) < 40) return;
        if(Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if(dx < 0) popupNext(false);
        else popupPrev();
      }, { passive:true });
    })();


    // backdrop click -> close
    $("#svPopupBackdrop").addEventListener("click", (e) => {
      if(e.target && e.target.id === "svPopupBackdrop") popupClose();
    });

    // swipe
    let startX = 0;
    let tracking = false;
    const card = $("#svPopupCard");
    card.addEventListener("pointerdown", (e) => {
      tracking = true;
      startX = e.clientX;
      try{ card.setPointerCapture(e.pointerId); }catch{}
    });
    card.addEventListener("pointerup", (e) => {
      if(!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      if(dx > 60) popupPrev();
      else if(dx < -60) popupNext();
    });
    card.addEventListener("pointercancel", () => { tracking = false; });
  }

  function popupOpen(queue){
    ensurePopupDOM();
    state.popupRuntime.open = true;
    state.popupRuntime.queue = queue;
    state.popupRuntime.groupIndex = 0;
    state.popupRuntime.itemIndex = 0;

    // skipAll csak ha több külön popup van
    const unique = new Set(queue.map(g => g.popupId));
    $("#svSkipAll").style.display = unique.size > 1 ? "inline-flex" : "none";

    $("#svPopupBackdrop").style.display = "flex";
    popupRender("init");
    popupStartAuto();
  }

  function popupClose(){
    if(!state.popupRuntime.open) return;
    popupStopAuto();
    $("#svPopupBackdrop").style.display = "none";
    state.popupRuntime.open = false;
    state.popupRuntime.sessionClosed = true;
  }

  function popupStopAuto(){
    if(state.popupRuntime.timer){
      clearInterval(state.popupRuntime.timer);
      state.popupRuntime.timer = null;
    }
  }
  function popupStartAuto(){
    popupStopAuto();
    state.popupRuntime.timer = setInterval(() => {
      if(!state.popupRuntime.open) return;
      popupNext(true);
    }, 3500);
  }

  function _curGroup(){
    const q = state.popupRuntime.queue || [];
    const g = q[state.popupRuntime.groupIndex];
    return g || null;
  }

  function popupRender(mode, dir){
    const g = _curGroup();
    if(!g){ popupClose(); return; }
    const total = g.products.length;
    if(!total){ popupClose(); return; }
    const i = ((state.popupRuntime.itemIndex % total) + total) % total;
    state.popupRuntime.itemIndex = i;

    $("#svPopupTitle").textContent = g.popupTitle || txt("popupTitle");
    $("#svPopupSub").textContent = g.categoryLabel || txt("popupSub");

    const p = g.products[i];
    const name = state.lang === "hu" ? (p.name_hu || p.name_en || "") : (p.name_en || p.name_hu || "");
    const flavor = state.lang === "hu" ? (p.flavor_hu || p.flavor_en || "") : (p.flavor_en || p.flavor_hu || "");
    const price = Number(p.price_ft || p.price || 0);
    const stock = Number(p.stock || 0);

    const img = $("#svPopupImg");
    img.src = String(p.image || "");
    img.alt = name;

    $("#svPopupName").textContent = name;
    $("#svPopupFlavor").textContent = flavor;
    $("#svPopupPrice").textContent = (Number.isFinite(price) && price>0) ? (price.toLocaleString("hu-HU") + " Ft") : "";
    $("#svPopupStock").textContent = (stock > 0) ? (`Készlet: ${stock}`) : (`Készlet: 0`);

    $("#svCounter").textContent = `${i+1}/${total}`;

    // slide anim
    const card = $("#svPopupCard");
    card.classList.remove("sv-slide-out-left","sv-slide-in-right","sv-slide-out-right","sv-slide-in-left");
    if(mode === "next"){
      card.classList.add("sv-slide-out-left");
      setTimeout(() => {
        card.classList.remove("sv-slide-out-left");
        card.classList.add("sv-slide-in-right");
        setTimeout(() => card.classList.remove("sv-slide-in-right"), 260);
      }, 180);
    }else if(mode === "prev"){
      card.classList.add("sv-slide-out-right");
      setTimeout(() => {
        card.classList.remove("sv-slide-out-right");
        card.classList.add("sv-slide-in-left");
        setTimeout(() => card.classList.remove("sv-slide-in-left"), 260);
      }, 180);
    }
  }

  function popupNext(fromAuto){
    const g = _curGroup();
    if(!g) return;
    const total = g.products.length;
    state.popupRuntime.itemIndex = (state.popupRuntime.itemIndex + 1) % total;
    popupRender("next");
    if(!fromAuto) popupStartAuto();
  }

  function popupPrev(){
    const g = _curGroup();
    if(!g) return;
    const total = g.products.length;
    state.popupRuntime.itemIndex = (state.popupRuntime.itemIndex - 1 + total) % total;
    popupRender("prev");
    popupStartAuto();
  }

  function _markSeen(popupIds){
    const m = _getSeenMap();
    for(const id of popupIds){
      // rev-et a queue-ból olvassuk
      const g = (state.popupRuntime.queue || []).find(x => x.popupId === id);
      const rev = g ? Number(g.popupRev||1) : 1;
      m[id] = Math.max(Number(m[id]||0), rev);
    }
    _setSeenMap(m);
  }

  function popupOk(){
    const g = _curGroup();
    if(!g) return;

    const dont = !!$("#svDontShow").checked;
    if(dont){
      _markSeen([g.popupId]);
    }

    // következő: ha dont -> ugorjuk át az adott popup összes maradék kategóriáját
    const q = state.popupRuntime.queue || [];
    if(dont){
      let gi = state.popupRuntime.groupIndex;
      const pid = g.popupId;
      while(gi < q.length && q[gi].popupId === pid) gi++;
      state.popupRuntime.groupIndex = gi;
    }else{
      state.popupRuntime.groupIndex += 1;
    }
    state.popupRuntime.itemIndex = 0;

    if(state.popupRuntime.groupIndex >= q.length){
      popupClose();
      return;
    }
    popupRender("init");
    popupStartAuto();
  }

  function popupSkipAll(){
    const dont = !!$("#svDontShow").checked;
    const q = state.popupRuntime.queue || [];
    if(dont){
      const ids = Array.from(new Set(q.map(g => g.popupId)));
      _markSeen(ids);
    }
    popupClose();
  }

  function maybeShowPopups(){
    if(state.popupRuntime.open) return;
    if(state.popupRuntime.sessionClosed) return;

    const queue = buildPopupQueue();
    const sig = JSON.stringify(queue.map(g => [g.popupId, g.popupRev, g.categoryId, (g.products||[]).map(p=>String(p.id))]));

    if(!queue.length){
      state.popupRuntime.lastQueueSig = sig;
      return;
    }

    if(sig && sig === state.popupRuntime.lastQueueSig) return;
    state.popupRuntime.lastQueueSig = sig;

    popupOpen(queue);
  }

async function init() {
    applySyncParams();
    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#langBtn").onclick = () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem("sv_lang", state.lang);
      $("#langLabel").textContent = state.lang.toUpperCase();
      renderNav();
      renderGrid();
    };

    $("#search").addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderGrid();
    });

    // ugyanazon böngészőben azonnali update admin mentésnél
    try {
      const cached = localStorage.getItem("sv_live_payload");
      if (cached) {
        const j = JSON.parse(cached);
        if (j && (j.doc || j.sales || j.popups)) applyData({ doc: j.doc, sales: j.sales, popups: j.popups });
      }
    } catch {}

    try {
      const ch = new BroadcastChannel("sv_live");
      ch.onmessage = (ev) => {
        if (ev && ev.data && (ev.data.doc || ev.data.sales || ev.data.popups)) applyData({ doc: ev.data.doc, sales: ev.data.sales, popups: ev.data.popups });
      };
    } catch {}

    window.addEventListener("storage", (e) => {
      if (e.key === "sv_live_payload" && e.newValue) {
        try {
          const j = JSON.parse(e.newValue);
          if (j && (j.doc || j.sales || j.popups)) applyData({ doc: j.doc, sales: j.sales, popups: j.popups });
        } catch {}
      }
    });

    $("#loaderText").textContent = "Termékek betöltése…";

    const raw = await fetchProducts({ forceBust: true });
    const doc = normalizeDoc(raw);
    applyDoc(doc);

    // poll: 1s aktív, 6s háttér; + 3s-enként forced cache-bust
    let n = 0;

    
    async function pollOnce(forceBust = false){
      const [pRes, sRes, ppRes] = await Promise.all([
        fetchProducts({ forceBust }),
        fetchSales({ forceBust }),
        fetchPopups({ forceBust }),
      ]);

      const upd = {};
      if(pRes && pRes.ok && pRes.doc) upd.doc = pRes.doc;
      if(sRes && sRes.ok && sRes.sales) upd.sales = sRes.sales;
      if(ppRes && ppRes.ok && ppRes.popups) upd.popups = ppRes.popups;

      if(Object.keys(upd).length) applyData(upd);
    }

    async function burst(){
      // gyors frissítés fókuszra (telón is hasznos)
      for(let i=0;i<3;i++){
        await pollOnce(true);
        await new Promise(r => setTimeout(r, 220));
      }
    }

    async function loop(){
      let n = 0;
      while(true){
        const forceBust = (n % 3 === 0); // kb 3 mp-enként hard bust
        try{ await pollOnce(forceBust); }catch(e){}

        const wait = document.hidden ? 12000 : 1100; // 1-2 mp-en belül frissüljön
        await new Promise(r => setTimeout(r, wait));
        n++;
      }
    }

document.addEventListener("visibilitychange", () => {
      if (!document.hidden) burst();
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. (Nyisd meg a konzolt.) Ha telefonon vagy custom domainen vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
  });
})();