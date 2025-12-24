(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu",
    active: "all",
    productsDoc: { categories: [], products: [], popups: [] },
    sales: [],
    search: "",
    etagProducts: "",
    etagSales: "",
    lastLiveTs: 0,
  };

  const UI = {
    all: { hu: "Összes termék", en: "All products" },
    soon: { hu: "Hamarosan", en: "Coming soon" },
    stock: { hu: "Készlet", en: "Stock" },
    pcs: { hu: "db", en: "pcs" },
    out: { hu: "Elfogyott", en: "Sold out" },
    newAvail: { hu: "Új termékek elérhetőek", en: "New products available" },
    understood: { hu: "Értettem", en: "Got it" },
    dontShow: { hu: "Ne mutasd többször", en: "Don't show again" },
    skipAll: { hu: "Összes átugrása", en: "Skip all" },
    hot: { hu: "Felkapott", en: "Trending" },
  };

  const t = (k) => {
    const v = UI[k];
    if (!v) return k;
    return state.lang === "en" ? (v.en || v.hu) : (v.hu || v.en);
  };

  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  function localeForLang() {
    return state.lang === "en" ? "en" : "hu";
  }

  function catLabel(c) {
    if (!c) return "";
    return state.lang === "en" ? (c.label_en || c.label_hu || c.id) : (c.label_hu || c.label_en || c.id);
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
    return (p && p.status) === "soon";
  }

  function isVisible(p) {
    // adminból állítható
    if (p && typeof p.visible === "boolean") return p.visible;
    return true;
  }

  /* ----------------- Source resolving (RAW preferált, custom domainen is) ----------------- */
  let source = null; // {owner, repo, branch}

  async function validateSource(s) {
    try {
      if (!s || !s.owner || !s.repo || !s.branch) return false;
      const testUrl = `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${s.branch}/data/products.json?_=${Date.now()}`;
      const r = await fetch(testUrl, { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
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

  function applySyncParams() {
    try {
      const u = new URL(location.href);
      const o = (u.searchParams.get("sv_owner") || "").trim();
      const r = (u.searchParams.get("sv_repo") || "").trim();
      const b = (u.searchParams.get("sv_branch") || "").trim();
      if (o && r) {
        localStorage.setItem("sv_owner", o);
        localStorage.setItem("sv_repo", r);
        if (b) localStorage.setItem("sv_branch", b);
        const src = { owner: o, repo: r, branch: b || "main" };
        localStorage.setItem("sv_source", JSON.stringify(src));
        u.searchParams.delete("sv_owner");
        u.searchParams.delete("sv_repo");
        u.searchParams.delete("sv_branch");
        history.replaceState({}, "", u.pathname + (u.search ? u.search : "") + u.hash);
      }
    } catch {}
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
        try {
          localStorage.removeItem("sv_source");
        } catch {}
      }
    } catch {}

    // stabil fájl (admin írja): data/sv_source.json
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

  function mkFetchHeaders() {
    return {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    };
  }

  async function fetchJsonSmart(path, { forceBust = false } = {}) {
    const src = await resolveSource();
    const relBase = `data/${path}`;
    const rawBase = src ? `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/data/${path}` : null;

    const mkUrl = (base) => (forceBust ? `${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}` : base);

    // 1) RAW
    if (rawBase) {
      try {
        const r = await fetch(mkUrl(rawBase), { cache: "no-store", headers: mkFetchHeaders() });
        if (r.ok) return await r.json();
        try {
          localStorage.removeItem("sv_source");
        } catch {}
        source = null;
      } catch {
        try {
          localStorage.removeItem("sv_source");
        } catch {}
        source = null;
      }
    }

    // 2) fallback
    const r = await fetch(mkUrl(relBase), { cache: "no-store", headers: mkFetchHeaders() });
    if (!r.ok) throw new Error(`Nem tudtam betölteni: ${path} (${r.status})`);
    return await r.json();
  }

  function normalizeDoc(data) {
    if (Array.isArray(data)) return { categories: [], products: data, popups: [] };
    const categories = data && Array.isArray(data.categories) ? data.categories : [];
    const products = data && Array.isArray(data.products) ? data.products : [];
    const popups = data && Array.isArray(data.popups) ? data.popups : [];
    return { categories, products, popups };
  }

  function applyDoc(doc) {
    state.productsDoc = {
      categories: (doc.categories || []).map((c) => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id,
        basePrice: Number(c.basePrice || 0),
        trending: typeof c.trending === "boolean" ? c.trending : true,
      })),
      products: (doc.products || [])
        .map((p) => ({
          ...p,
          id: String(p.id || ""),
          categoryId: String(p.categoryId || ""),
          status: p.status === "soon" || p.status === "out" || p.status === "ok" ? p.status : "ok",
          stock: Math.max(0, Number(p.stock || 0)),
          visible: typeof p.visible === "boolean" ? p.visible : true,
        }))
        .filter((p) => p.id),
      popups: (doc.popups || []).map((x) => ({
        id: String(x.id || ""),
        title_hu: x.title_hu || "",
        title_en: x.title_en || "",
        enabled: typeof x.enabled === "boolean" ? x.enabled : true,
        categoryIds: Array.isArray(x.categoryIds) ? x.categoryIds.map(String) : [],
        productIds: Array.isArray(x.productIds) ? x.productIds.map(String) : [],
      })).filter(x => x.id),
    };

    renderNav();
    renderGrid();

    // popup check (csak init után, és csak ha van mit)
    queuePopupFlow();
  }

  /* ----------------- Trending (felkapott) ----------------- */
  function computeTrendingByCategory() {
    // returns Map(categoryId -> productId) where qty > 0
    const qtyByPid = new Map();

    for (const s of state.sales || []) {
      const items = Array.isArray(s.items) ? s.items : [];
      for (const it of items) {
        const pid = String(it.productId || it.pid || "");
        if (!pid) continue;
        const q = Math.max(0, Number(it.qty || it.quantity || 0));
        if (!q) continue;
        qtyByPid.set(pid, (qtyByPid.get(pid) || 0) + q);
      }
    }

    const byCat = new Map();
    const locale = localeForLang();

    for (const p of state.productsDoc.products || []) {
      if (!isVisible(p)) continue;
      const sold = qtyByPid.get(String(p.id)) || 0;
      if (sold <= 0) continue;
      const cid = String(p.categoryId || "");
      if (!cid) continue;

      const cur = byCat.get(cid);
      if (!cur) {
        byCat.set(cid, { pid: p.id, sold, flavor: getFlavor(p) });
        continue;
      }
      if (sold > cur.sold) {
        byCat.set(cid, { pid: p.id, sold, flavor: getFlavor(p) });
      } else if (sold === cur.sold) {
        // tie: flavor abc (lang szerint)
        const a = (getFlavor(p) || "").toString();
        const b = (cur.flavor || "").toString();
        if (a.localeCompare(b, locale) < 0) {
          byCat.set(cid, { pid: p.id, sold, flavor: a });
        }
      }
    }

    const out = new Map();
    for (const [cid, v] of byCat.entries()) out.set(cid, v.pid);
    return out;
  }

  function trendingEnabledForCategory(cid) {
    const c = (state.productsDoc.categories || []).find((x) => String(x.id) === String(cid));
    return c ? (typeof c.trending === "boolean" ? c.trending : true) : true;
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
        trending: typeof c.trending === "boolean" ? c.trending : true,
      }))
      .sort((a, b) => catLabel(a).localeCompare(catLabel(b), localeForLang()));

    return [
      { id: "all", label_hu: t("all"), label_en: t("all"), virtual: true },
      ...cats,
      { id: "soon", label_hu: t("soon"), label_en: t("soon"), virtual: true },
    ];
  }

  function filterList() {
    const q = norm(state.search);

    let list = (state.productsDoc.products || [])
      .filter((p) => isVisible(p))
      .map((p) => ({
        ...p,
        categoryId: String(p.categoryId || ""),
        status: p.status === "soon" || p.status === "out" || p.status === "ok" ? p.status : "ok",
        stock: Math.max(0, Number(p.stock || 0)),
      }));

    if (state.active === "soon") {
      list = list.filter((p) => isSoon(p));
    } else if (state.active !== "all") {
      list = list.filter((p) => String(p.categoryId) === String(state.active));
    }

    if (q) {
      list = list.filter((p) => norm(getName(p) + " " + getFlavor(p)).includes(q));
    }

    // rang: ok -> soon -> out (mindegyik tabon)
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
      const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, localeForLang()));
      const out = [];
      for (const k of keys) {
        const items = map.get(k) || [];
        items.sort((a, b) => norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), localeForLang()));
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

    $("#langLabel").textContent = state.lang.toUpperCase();
  }

  function makeCard(p, { hot = false } = {}) {
    const name = getName(p);
    const flavor = getFlavor(p);
    const out = isOut(p);
    const soon = isSoon(p);
    const stockShown = out ? 0 : Math.max(0, Number(p.stock || 0));
    const price = effectivePrice(p);

    const card = document.createElement("div");
    card.className = "card fade-in" + (out ? " dim" : "") + (hot ? " hot" : "");

    const hero = document.createElement("div");
    hero.className = "hero";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = (name + (flavor ? " - " + flavor : "")).trim();
    img.src = p.image || "";

    // státusz alapú szűrés (out szürke, soon ne legyen durván szürke)
    if (out) {
      img.style.filter = "grayscale(.65) contrast(.95) brightness(.85)";
    } else if (soon) {
      img.style.filter = "contrast(1.02) brightness(.95)";
    }

    const badges = document.createElement("div");
    badges.className = "badges";
    if (hot) {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = t("hot");
      badges.appendChild(b);
    }
    if (soon) {
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

    const overlay = document.createElement("div");
    overlay.className = "overlay-title";
    overlay.innerHTML = `
      <div class="name">${escapeHtml(name)}</div>
      <div class="flavor">${escapeHtml(flavor)}</div>
    `;

    hero.appendChild(img);
    hero.appendChild(badges);
    hero.appendChild(overlay);

    const body = document.createElement("div");
    body.className = "card-body";

    const meta = document.createElement("div");
    meta.className = "meta-row";
    meta.innerHTML = `
      <div class="price">${fmtFt(price)}</div>
      <div class="stock">${t("stock")}: <b>${soon ? "—" : stockShown}</b> ${t("pcs")}</div>
    `;

    body.appendChild(meta);

    card.appendChild(hero);
    card.appendChild(body);

    return card;
  }

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    grid.innerHTML = "";

    const list = filterList();
    $("#count").textContent = String(list.length);
    empty.style.display = list.length ? "none" : "block";

    // Trending: kategóriánként 1, és mindig legelöl (a tabon belül)
    const trendingMap = computeTrendingByCategory();

    if (state.active !== "soon") {
      if (state.active !== "all") {
        const cid = state.active;
        if (trendingEnabledForCategory(cid)) {
          const pid = trendingMap.get(String(cid));
          if (pid) {
            const p = (state.productsDoc.products || []).find((x) => String(x.id) === String(pid));
            if (p) grid.appendChild(makeCard(p, { hot: true }));
          }
        }
      } else {
        // all tab: minden kategóriából 1-1 felkapott, felül
        const cats = (state.productsDoc.categories || []).slice().sort((a, b) => catLabel(a).localeCompare(catLabel(b), localeForLang()));
        const picks = [];
        for (const c of cats) {
          if (!trendingEnabledForCategory(c.id)) continue;
          const pid = trendingMap.get(String(c.id));
          if (!pid) continue;
          const p = (state.productsDoc.products || []).find((x) => String(x.id) === String(pid));
          if (p) picks.push(p);
        }
        if (picks.length) {
          for (const p of picks) grid.appendChild(makeCard(p, { hot: true }));
        }
      }
    }

    // normal lista (ha hot termék benne van, itt is megjelenne, de ez ok — user akarta, hogy ne számítson szabály)
    for (const p of list) {
      // all tabon, ne duplikáljuk a hot kártyát
      if (state.active === "all") {
        const isHot = trendingMap.get(String(p.categoryId)) === String(p.id) && trendingEnabledForCategory(p.categoryId);
        if (isHot) continue;
      } else if (state.active !== "soon") {
        const isHot = trendingMap.get(String(state.active)) === String(p.id) && trendingEnabledForCategory(state.active);
        if (isHot) continue;
      }

      grid.appendChild(makeCard(p, { hot: false }));
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  /* ----------------- Popup flow (új termékek) ----------------- */
  let popupScheduled = false;
  let popupOpen = false;

  function popupDismissKey(popupId, signature) {
    return `sv_popup_dismiss:${popupId}:${signature}`;
  }

  function signatureForPopup(popup, productsInPopup, categoriesInPopup) {
    // ha változik a tartalom / készlet / státusz, akkor újra dobja fel
    const parts = [];
    const cids = (categoriesInPopup || []).map(String).sort();
    parts.push("c:" + cids.join(","));
    const prods = (productsInPopup || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const p of prods) {
      parts.push(`${p.id}:${p.status}:${Number(p.stock || 0)}:${p.visible ? 1 : 0}`);
    }
    const raw = parts.join("|");
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return String(h);
  }

  function buildPopupPlan() {
    const popups = (state.productsDoc.popups || []).filter((p) => p && p.enabled);

    const byId = new Map((state.productsDoc.products || []).map((p) => [String(p.id), p]));
    const catsById = new Map((state.productsDoc.categories || []).map((c) => [String(c.id), c]));

    const plans = [];

    for (const pu of popups) {
      const catIds = (pu.categoryIds || []).map(String).filter((id) => catsById.has(id));
      const prodIds = (pu.productIds || []).map(String).filter((id) => byId.has(id));

      // termékek: kategóriából + konkrét kiválasztások
      let products = [];
      for (const pid of prodIds) {
        const p = byId.get(pid);
        if (p && isVisible(p)) products.push(p);
      }
      for (const cid of catIds) {
        for (const p of state.productsDoc.products || []) {
          if (!isVisible(p)) continue;
          if (String(p.categoryId) !== String(cid)) continue;
          products.push(p);
        }
      }

      // dedupe
      const seen = new Set();
      products = products.filter((p) => {
        const k = String(p.id);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (!products.length) continue;

      // csoport: kategóriánként, ABC sorrendben (lang szerint)
      const groups = new Map();
      for (const p of products) {
        const cid = String(p.categoryId || "");
        if (!groups.has(cid)) groups.set(cid, []);
        groups.get(cid).push(p);
      }

      // kategóriák sorrendje
      const catOrder = [...groups.keys()].sort((a, b) => {
        const ca = catsById.get(a);
        const cb = catsById.get(b);
        return catLabel(ca).localeCompare(catLabel(cb), localeForLang());
      });

      // csoporton belül: ok -> soon -> out, majd flavor ABC
      for (const cid of catOrder) {
        const arr = groups.get(cid) || [];
        arr.sort((a, b) => {
          const ra = isOut(a) ? 2 : (isSoon(a) ? 1 : 0);
          const rb = isOut(b) ? 2 : (isSoon(b) ? 1 : 0);
          if (ra !== rb) return ra - rb;
          return (getFlavor(a) || "").localeCompare((getFlavor(b) || ""), localeForLang());
        });
      }

      const signature = signatureForPopup(pu, products, catOrder);
      const key = popupDismissKey(pu.id, signature);
      const dismissed = localStorage.getItem(key) === "1";
      if (dismissed) continue;

      plans.push({ popup: pu, catOrder, groups, signature });
    }

    return plans;
  }

  function ensurePopupDom() {
    if ($("#popupBg")) return;

    const bg = document.createElement("div");
    bg.className = "popup-backdrop";
    bg.id = "popupBg";
    bg.innerHTML = `
      <div class="popup" role="dialog" aria-modal="true">
        <div class="popup-top">
          <div>
            <div class="popup-title" id="popupTitle">${escapeHtml(t("newAvail"))}</div>
            <div class="popup-sub" id="popupSub"></div>
          </div>
          <button class="popup-x" id="popupClose">✕</button>
        </div>

        <div class="popup-body">
          <div class="popup-stage">
            <div class="popup-hero"><img id="popupImg" alt="" /></div>
            <div class="popup-info">
              <div class="popup-name" id="popupName"></div>
              <div class="popup-flavor" id="popupFlavor"></div>
              <div class="popup-meta">
                <div class="popup-price" id="popupPrice"></div>
                <div class="popup-stock" id="popupStock"></div>
              </div>
              <div class="small-muted" id="popupCounter"></div>
            </div>
          </div>
        </div>

        <div class="popup-footer">
          <div class="popup-left">
            <label><input type="checkbox" id="popupDont" /> <span>${escapeHtml(t("dontShow"))}</span></label>
          </div>
          <div class="popup-actions">
            <button class="ghost" id="popupSkipAll">${escapeHtml(t("skipAll"))}</button>
            <button id="popupOk">${escapeHtml(t("understood"))}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    bg.addEventListener("click", (e) => {
      if (e.target === bg) closePopup("close");
    });
  }

  function openPopupFlow(plans) {
    if (!plans || !plans.length) return;

    ensurePopupDom();
    popupOpen = true;

    const bg = $("#popupBg");
    const titleEl = $("#popupTitle");
    const subEl = $("#popupSub");
    const imgEl = $("#popupImg");
    const nameEl = $("#popupName");
    const flavorEl = $("#popupFlavor");
    const priceEl = $("#popupPrice");
    const stockEl = $("#popupStock");
    const counterEl = $("#popupCounter");
    const dontEl = $("#popupDont");

    let planIndex = 0;
    let catIndex = 0;
    let itemIndex = 0;
    let timer = null;

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function startTimer() {
      stopTimer();
      // desktop lag fix: lassabb és kevesebb anim
      timer = setInterval(() => {
        // jobbról-balra "lapozás": csak a tartalom vált, kép fade
        itemIndex++;
        renderCurrent(true);
      }, 2600);
    }

    function curPlan() {
      return plans[planIndex];
    }

    function curCategoryId() {
      const p = curPlan();
      return p ? p.catOrder[catIndex] : null;
    }

    function curList() {
      const p = curPlan();
      const cid = curCategoryId();
      if (!p || !cid) return [];
      return p.groups.get(cid) || [];
    }

    function fmtStock(p) {
      if (isSoon(p)) return "—";
      const v = isOut(p) ? 0 : Math.max(0, Number(p.stock || 0));
      return `${t("stock")}: <b>${v}</b> ${t("pcs")}`;
    }

    function renderCurrent(animate = false) {
      const p = curPlan();
      if (!p) return closePopup("done");
      const cid = curCategoryId();
      const list = curList();

      if (!cid || !list.length) {
        // next category
        catIndex++;
        itemIndex = 0;
        return renderCurrent(false);
      }

      if (itemIndex >= list.length) itemIndex = 0;

      const item = list[itemIndex];

      // subtitle: kategória + (popup title)
      const cat = (state.productsDoc.categories || []).find((x) => String(x.id) === String(cid));
      const baseTitle =
        state.lang === "en"
          ? (p.popup.title_en || p.popup.title_hu || t("newAvail"))
          : (p.popup.title_hu || p.popup.title_en || t("newAvail"));

      titleEl.textContent = baseTitle || t("newAvail");
      subEl.textContent = cat ? catLabel(cat) : "";

      const price = effectivePrice(item);
      nameEl.textContent = getName(item);
      flavorEl.textContent = getFlavor(item);
      priceEl.textContent = fmtFt(price);
      stockEl.innerHTML = fmtStock(item);

      const total = list.length;
      counterEl.textContent = `${itemIndex + 1}/${total}`;

      if (animate) {
        imgEl.style.opacity = "0";
        requestAnimationFrame(() => {
          imgEl.src = item.image || "";
          imgEl.alt = (getName(item) + " - " + getFlavor(item)).trim();
          imgEl.style.opacity = "1";
        });
      } else {
        imgEl.src = item.image || "";
        imgEl.alt = (getName(item) + " - " + getFlavor(item)).trim();
        imgEl.style.opacity = "1";
      }

      // ha csak 1, akkor ne menjen a timer
      if (total <= 1) stopTimer();
      else startTimer();
    }

    function dismissPlanPermanent() {
      const p = curPlan();
      if (!p) return;
      const key = popupDismissKey(p.popup.id, p.signature);
      localStorage.setItem(key, "1");
    }

    function dismissAllPermanent() {
      for (const p of plans) {
        const key = popupDismissKey(p.popup.id, p.signature);
        localStorage.setItem(key, "1");
      }
    }

    function nextCategoryOrPopup() {
      const p = curPlan();
      if (!p) return closePopup("done");

      catIndex++;
      itemIndex = 0;

      if (catIndex < p.catOrder.length) {
        renderCurrent(false);
        return;
      }

      // next popup
      planIndex++;
      catIndex = 0;
      itemIndex = 0;

      if (planIndex >= plans.length) return closePopup("done");
      renderCurrent(false);
    }

    function closePopup(mode) {
      stopTimer();
      bg.style.display = "none";
      popupOpen = false;
      // session skip
      if (mode === "skip") {
        try {
          sessionStorage.setItem("sv_popup_skip_session", "1");
        } catch {}
      }
    }

    // wire
    $("#popupClose").onclick = () => {
      const dont = !!dontEl.checked;
      if (dont) dismissPlanPermanent();
      nextCategoryOrPopup();
    };
    $("#popupOk").onclick = () => {
      const dont = !!dontEl.checked;
      if (dont) dismissPlanPermanent();
      nextCategoryOrPopup();
    };
    $("#popupSkipAll").onclick = () => {
      const dont = !!dontEl.checked;
      if (dont) dismissAllPermanent(); // ✅ bugfix: ha bepipálta és skip all, akkor mindet tiltsa
      closePopup("skip");
    };

    // show
    dontEl.checked = false;
    bg.style.display = "flex";
    renderCurrent(false);
  }

  function queuePopupFlow() {
    if (popupScheduled || popupOpen) return;

    // ha user egyszer már sessionben skipelt, ne zavarjuk tovább
    try {
      if (sessionStorage.getItem("sv_popup_skip_session") === "1") return;
    } catch {}

    popupScheduled = true;
    setTimeout(() => {
      popupScheduled = false;
      if (popupOpen) return;

      const plans = buildPopupPlan();
      if (!plans.length) return;
      openPopupFlow(plans);
    }, 220);
  }

  /* ----------------- init / live update / polling ----------------- */
  async function init() {
    applySyncParams();

    $("#langBtn").addEventListener("click", () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem("sv_lang", state.lang);
      $("#langLabel").textContent = state.lang.toUpperCase();
      $("#search").placeholder = state.lang === "en" ? "Search..." : "Keresés...";
      renderNav();
      renderGrid();
      // popup szövegek is nyelvhez igazodjanak, de ne nyissuk újra
      if ($("#popupBg")) {
        $("#popupSkipAll").textContent = t("skipAll");
        $("#popupOk").textContent = t("understood");
        $("#popupTitle").textContent = t("newAvail");
        $("#popupDont").nextElementSibling.textContent = t("dontShow");
      }
    });

    $("#search").addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderGrid();
    });

    // ugyanazon böngészőben azonnali update admin mentésnél
    try {
      const cached = localStorage.getItem("sv_live_payload");
      if (cached) {
        const j = JSON.parse(cached);
        if (j && j.doc) {
          state.lastLiveTs = Number(j.ts || Date.now());
          applyDoc(normalizeDoc(j.doc));
        }
        if (j && Array.isArray(j.sales)) state.sales = j.sales;
      }
    } catch {}

    try {
      const ch = new BroadcastChannel("sv_live");
      ch.onmessage = (ev) => {
        const j = ev.data;
        if (j && j.doc) {
          state.lastLiveTs = Number(j.ts || Date.now());
          applyDoc(normalizeDoc(j.doc));
        }
        if (j && Array.isArray(j.sales)) state.sales = j.sales;
      };
    } catch {}

    // initial fetch
    const docRaw = await fetchJsonSmart("products.json", { forceBust: true });
    applyDoc(normalizeDoc(docRaw));

    try {
      const salesRaw = await fetchJsonSmart("sales.json", { forceBust: true });
      state.sales = Array.isArray(salesRaw) ? salesRaw : (salesRaw && salesRaw.sales ? salesRaw.sales : salesRaw) || [];
      renderGrid();
    } catch {
      state.sales = [];
    }

    // show app
    $("#app").style.display = "grid";
    $("#loader").style.display = "none";

    async function pollOnce(forceBust = false) {
      // ne pörögjön 2 másodpercenként (lag + dupla friss)
      // ha kaptunk live update-et frissen, 10s-ig ne polloljunk
      if (Date.now() - state.lastLiveTs < 10000) return;

      try {
        const data = await fetchJsonSmart("products.json", { forceBust });
        if (data) applyDoc(normalizeDoc(data));
      } catch {}

      // sales ritkábban
      try {
        const salesRaw = await fetchJsonSmart("sales.json", { forceBust });
        state.sales = Array.isArray(salesRaw) ? salesRaw : (salesRaw && salesRaw.sales ? salesRaw.sales : salesRaw) || [];
        renderGrid();
      } catch {}
    }

    async function burst() {
      for (let i = 0; i < 2; i++) {
        await pollOnce(true);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    let n = 0;
    async function loop() {
      n++;
      const force = n % 8 === 0; // kb 2 percenként 1 force-bust
      await pollOnce(force);
      setTimeout(loop, document.hidden ? 60000 : 15000);
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) burst();
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. Ha telefonon vagy custom domainen vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
  });
})();
