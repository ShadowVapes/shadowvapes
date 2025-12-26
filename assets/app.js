(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu", // HU/EN – de EN csak az ízekhez fog kelleni
    activeCat: "all",
    search: "",
    sales: [],
    productsDoc: { categories: [], products: [], popups: [], _meta: {} },

    etagProducts: "",
    etagSales: "",
    featuredByCat: new Map(), // categoryId -> productId

    // anti-flicker / anti-stale overwrites
    docRev: 0,
    docHash: "",
    salesHash: "",
    lastLiveTs: 0,
    salesFresh: false,
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

  // ✅ Nyelv váltás CSAK az ízeket fordítja, UI mindig HU
  const t = (k) => (UI[k] ? UI[k].hu : k);

  const locale = () => "hu";

  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  function catLabel(c) {
    // ✅ Nyelv váltás csak az ízeket fordítja – kategória címek maradnak HU
    return (c && (c.label_hu || c.label_en || c.id)) || "";
  }

  function getName(p) {
    return (p && (p.name_hu || p.name_en || p.name || "")) || "";
  }

  function getFlavor(p) {
    if (!p) return "";
    return state.lang === "en"
      ? (p.flavor_en || p.flavor_hu || p.flavor || "")
      : (p.flavor_hu || p.flavor_en || p.flavor || "");
  }

  function isOut(p){ return (p && (p.status === "out")) || false; }
  function isSoon(p){ return (p && (p.status === "soon")) || false; }

  function fmtFt(n){
    const x = Number(n || 0);
    try{
      return new Intl.NumberFormat("hu-HU", { style: "currency", currency: "HUF", maximumFractionDigits: 0 }).format(x);
    }catch{
      return x.toFixed(0) + " Ft";
    }
  }

  function formatMonth(monthStr) {
    if (!monthStr) return "";
    try {
      const parts = String(monthStr).split("-");
      const month = parts[1];
      if (!month) return monthStr;

      const monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return monthStr;

      // ✅ Csak hónap kell (év nélkül) + mindig HU, mert a nyelv váltás csak az ízeket fordítja
      const monthNames = ["Január", "Február", "Március", "Április", "Május", "Június",
                          "Július", "Augusztus", "Szeptember", "Október", "November", "December"];
      return monthNames[monthNum - 1];
    } catch {
      return monthStr;
    }
  }

  function effectivePrice(p) {
    const price = p && p.price;
    if (price !== null && price !== undefined && price !== "" && Number(price) > 0) return Number(price);
    const c = (state.productsDoc.categories || []).find((x) => String(x.id) === String(p.categoryId));
    return Number(c && c.price ? c.price : 0);
  }

  function normalizeDoc(doc){
    const d = doc && typeof doc === "object" ? doc : {};
    const categories = Array.isArray(d.categories) ? d.categories : [];
    const products = Array.isArray(d.products) ? d.products : [];
    const popups = Array.isArray(d.popups) ? d.popups : [];
    const meta = d._meta && typeof d._meta === "object" ? d._meta : {};
    return { categories, products, popups, _meta: meta };
  }

  function computeFeaturedByCategory(){
    state.featuredByCat = new Map();
    const products = (state.productsDoc.products || []).filter(p=>p && p.id && p.visible !== false);

    // count sales by productId
    const m = new Map();
    for(const s of (state.sales || [])){
      const items = Array.isArray(s.items) ? s.items : [];
      for(const it of items){
        const pid = String(it.productId||"");
        const qty = Math.max(0, Number(it.qty||0));
        if(!pid || !qty) continue;
        m.set(pid, (m.get(pid)||0) + qty);
      }
    }

    // per category choose best sold product that is not out
    const cats = state.productsDoc.categories || [];
    for(const c of cats){
      const cid = String(c.id||"");
      if(!cid) continue;

      // filter products in this category
      const inCat = products.filter(p=>String(p.categoryId)===cid && !isOut(p));
      if(!inCat.length) continue;

      let bestPid = null;
      let bestQty = -1;

      for(const p of inCat){
        const pid = String(p.id);
        const qty = m.get(pid)||0;
        if(qty > bestQty){
          bestQty = qty; bestPid = pid;
        }else if(qty === bestQty && bestPid){
          // tie-break: íz név abc szerint
          const a = products.find(x=>String(x.id)===pid);
          const b = products.find(x=>String(x.id)===bestPid);
          const fa = norm((a && (a.flavor_hu || a.flavor_en || a.flavor || "")) || "");
          const fb = norm((b && (b.flavor_hu || b.flavor_en || b.flavor || "")) || "");
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

  /* ----------------- Loading ----------------- */
  async function fetchJson(url, { etagKey=null } = {}){
    const headers = {};
    if(etagKey){
      const etag = state[etagKey];
      if(etag) headers["If-None-Match"] = etag;
    }
    const res = await fetch(url, { cache:"no-store", headers });
    if(res.status === 304){
      return { data:null, etag: state[etagKey] || "" };
    }
    const etag = res.headers.get("ETag") || "";
    const data = await res.json();
    return { data, etag };
  }

  async function loadAll(){
    // always try to hydrate from live payload first
    hydrateFromLivePayload();

    const [p, s] = await Promise.all([
      fetchJson("data/products.json?ts=" + Date.now(), { etagKey:"etagProducts" }).catch(()=>({data:null,etag:""})),
      fetchJson("data/sales.json?ts=" + Date.now(), { etagKey:"etagSales" }).catch(()=>({data:null,etag:""})),
    ]);

    let changed = false;

    if(p && p.data){
      if(applyDocIfNewer(p.data, { source:"net" })) changed = true;
      if(p.etag) state.etagProducts = p.etag;
    }
    if(s && s.data){
      if(applySalesIfChanged(s.data, { fresh:false })) changed = true;
      if(s.etag) state.etagSales = s.etag;
    }

    // compute featured only if we have sales
    computeFeaturedByCategory();

    if(changed){
      renderNav();
      renderGrid();
    }else{
      // still ensure initial render
      renderNav();
      renderGrid();
    }

    // popup check
    showPopupsIfNeeded();

    // hide loader
    const l = $("#loader");
    if(l) l.style.display = "none";
  }

  /* ----------------- Rendering ----------------- */
  function currentCats(){
    const cats = state.productsDoc.categories || [];
    const all = { id:"all", label_hu: t("all"), label_en: t("all") };
    const soon = { id:"soon", label_hu: t("soon"), label_en: t("soon") };

    // order: All first, Soon last
    const filtered = cats
      .filter(c=>c && c.id && String(c.id)!=="soon")
      .sort((a,b)=>catLabel(a).localeCompare(catLabel(b), locale()));

    return [all, ...filtered, soon];
  }

  function visibleProducts(){
    const ps = (state.productsDoc.products || []).filter(p=>p && p.id && p.visible !== false);
    return ps;
  }

  function productMatchesSearch(p){
    const q = norm(state.search);
    if(!q) return true;
    const name = norm(getName(p));
    const flv = norm(getFlavor(p));
    return name.includes(q) || flv.includes(q);
  }

  function inActiveCategory(p){
    const cat = state.activeCat;
    if(cat === "all") return true;
    if(cat === "soon") return isSoon(p);
    return String(p.categoryId) === String(cat);
  }

  function renderNav(){
    const nav = $("#catNav");
    if(!nav) return;

    const cats = currentCats();
    const prods = visibleProducts();

    nav.innerHTML = "";

    for(const c of cats){
      const btn = document.createElement("button");
      btn.className = (String(state.activeCat) === String(c.id)) ? "active" : "";
      btn.dataset.cat = String(c.id);

      const label = document.createElement("div");
      label.textContent = catLabel(c);

      const count = document.createElement("div");
      count.className = "count";

      const cnt = prods.filter(p=>{
        if(c.id === "all") return productMatchesSearch(p);
        if(c.id === "soon") return isSoon(p) && productMatchesSearch(p);
        return String(p.categoryId) === String(c.id) && productMatchesSearch(p);
      }).length;

      count.textContent = cnt ? String(cnt) : "";

      btn.appendChild(label);
      btn.appendChild(count);

      btn.onclick = () => {
        state.activeCat = String(c.id);
        renderNav();
        renderGrid();
      };

      nav.appendChild(btn);
    }

    // Title
    const title = $("#pageTitle");
    const sub = $("#pageSubtitle");
    if(title) title.textContent = catLabel(cats.find(x=>String(x.id)===String(state.activeCat)) || cats[0]);
    if(sub) sub.textContent = "Válassz ízt és nézd a készletet.";
  }

  function badge(text, cls){
    const b = document.createElement("div");
    b.className = "badge " + cls;
    b.textContent = text;
    return b;
  }

  function renderGrid(){
    const grid = $("#grid");
    const empty = $("#empty");
    if(!grid) return;

    const cats = currentCats();
    const products = visibleProducts();

    // filter by search and category
    let list = products.filter(p => productMatchesSearch(p) && inActiveCategory(p));

    // group by same name (same HU or fallback name)
    const groups = new Map();
    for(const p of list){
      const key = norm(getName(p));
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    // flatten grouped list by name group, but keep in original category order
    let flattened = [];
    for(const [k, arr] of groups.entries()){
      // sort inside group by flavor
      arr.sort((a,b)=>norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), locale()));
      flattened.push(...arr);
    }

    // sort overall by category label (except all/soon views have different behavior)
    if(state.activeCat === "all"){
      // keep by category label, but ensure "featured" always first globally
      flattened.sort((a,b)=>{
        const fa = isOut(a), fb = isOut(b);
        // don't reorder by out here; keep stable
        const ca = (state.productsDoc.categories || []).find(x=>String(x.id)===String(a.categoryId));
        const cb = (state.productsDoc.categories || []).find(x=>String(x.id)===String(b.categoryId));
        const cl = catLabel(ca).localeCompare(catLabel(cb), locale());
        if(cl !== 0) return cl;
        const na = norm(getName(a));
        const nb = norm(getName(b));
        const nl = na.localeCompare(nb, locale());
        if(nl !== 0) return nl;
        return norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), locale());
      });

      // move featured to top if any
      const featuredIds = new Set([...state.featuredByCat.values()].map(String));
      const feat = flattened.filter(p=>featuredIds.has(String(p.id)));
      const rest = flattened.filter(p=>!featuredIds.has(String(p.id)));
      flattened = [...feat, ...rest];
    }else{
      // within a category just group by name then flavor
      flattened.sort((a,b)=>{
        const na = norm(getName(a));
        const nb = norm(getName(b));
        const nl = na.localeCompare(nb, locale());
        if(nl !== 0) return nl;
        return norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), locale());
      });

      // if it's a real category, put its featured first
      if(state.activeCat !== "soon"){
        const fid = state.featuredByCat.get(String(state.activeCat));
        if(fid){
          const feat = flattened.filter(p=>String(p.id)===String(fid));
          const rest = flattened.filter(p=>String(p.id)!==String(fid));
          flattened = [...feat, ...rest];
        }
      }
    }

    // render
    grid.innerHTML = "";

    for(const p of flattened){
      const out = isOut(p);
      const soon = isSoon(p);
      const featured = (state.activeCat === "all")
        ? ([...state.featuredByCat.values()].map(String).includes(String(p.id)))
        : (state.featuredByCat.get(String(state.activeCat)) === String(p.id));

      const name = getName(p);
      const flavor = getFlavor(p);
      const stockShown = soon ? "—" : (out ? 0 : Math.max(0, Number(p.stock || 0)));
      const price = effectivePrice(p);

      // Determine card classes based on status
      let cardClass = "card fade-in";
      if (out) cardClass += " dim outline-red";
      else if (soon) cardClass += " outline-yellow soon-dim";
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
      }

      const badges = document.createElement("div");
      badges.className = "badges";

      if(featured){
        badges.appendChild(badge(t("hot"), "hot"));
      }

      if(out){
        badges.appendChild(badge(t("out"), "out"));
      }else if(soon){
        badges.appendChild(badge(t("soon"), "soon"));
        if(p.soonEta){
          badges.appendChild(badge(`📅 ${t("expected")}: ${formatMonth(p.soonEta)}`, "calendar"));
        }
      }

      const overlay = document.createElement("div");
      overlay.className = "overlay";

      const overlayTitle = document.createElement("div");
      overlayTitle.className = "overlay-title";

      const nm = document.createElement("div");
      nm.className = "name";
      nm.textContent = name || "—";

      const fl = document.createElement("div");
      fl.className = "flavor";
      fl.textContent = flavor || "";

      overlayTitle.appendChild(nm);
      overlayTitle.appendChild(fl);
      overlay.appendChild(overlayTitle);

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

    if(empty){
      empty.style.display = flattened.length ? "none" : "";
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
            
            slide.innerHTML = `
                <div class="popup-product-image">
                    <img src="${product.image || ''}" alt="${name} ${flavor}" loading="lazy" style="object-fit: contain;max-height:350px;width:100%;">
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
        // ✅ Fix: ne állítsunk sliderWidth %-ot, mert belenagyít / elcsúszik (slide = 100%)
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

        // Update header and footer (cím mindig HU, mert nyelv váltás csak íz)
        header.innerHTML = `
            <div class="popup-title">${(popup.title_hu || t("newAvail"))}</div>
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

        // ✅ Render content
        content.innerHTML = '';
        content.appendChild(slider);

        // ✅ Navigation arrows (mindkét irányba) – fix: content törlés után kell beszúrni
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
    // ✅ Nyelv váltás csak az ízeket érinti – kereső marad HU
    $("#search").placeholder = "Keresés...";
  }

  function initLang(){
    $("#langBtn").onclick = () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem("sv_lang", state.lang);
      setLangUI();
      renderNav();
      renderGrid();
      // popups ízek miatt – újrarender
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
      const salesChanged = applySalesIfChanged(payload.sales || [], { fresh:true });

      if(docChanged || salesChanged){
        computeFeaturedByCategory();
        renderNav();
        renderGrid();
      }
      return true;
    }catch{
      return false;
    }
  }

  function initSearch(){
    const inp = $("#search");
    if(!inp) return;
    inp.value = "";
    inp.oninput = () => {
      state.search = inp.value || "";
      renderNav();
      renderGrid();
    };
  }

  function startLiveListener(){
    window.addEventListener("storage", (e) => {
      if(e && e.key === "sv_live_payload"){
        hydrateFromLivePayload();
      }
    });
  }

  function boot(){
    setLangUI();
    initLang();
    initSearch();
    startLiveListener();
    loadAll().catch(()=>{
      const l = $("#loader");
      if(l) l.style.display = "none";
      renderNav();
      renderGrid();
    });
  }

  boot();
})();
