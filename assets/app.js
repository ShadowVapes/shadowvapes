(() => {
  const $ = (s) => document.querySelector(s);

  const LS = {
    lang: "sv_lang",
    source: "sv_source",
    dismissed: "sv_pp_dismissed",
    live: "sv_live_payload",
  };

  const state = {
    lang: localStorage.getItem(LS.lang) || "hu",
    active: "all",
    search: "",
    productsDoc: { categories: [], products: [] },
    sales: [],
    popups: [],
    hotByCat: {},

    source: null, // {owner, repo, branch, rawBase}
    etag: { products: "", sales: "", popups: "", sourceFile: "" },

    lastRenderSig: "",
    popup: {
      sessionClosed: false,
      queue: [],
      popupIndex: 0,
      itemIndex: 0,
      timer: null,
      lastQueueSig: "",
      open: false,
      dontShow: false,
      dragging: false,
      dragStartX: 0,
      dragDX: 0,
      dragId: null,
    },
  };

  const TXT = {
    hu: {
      all: "Összes termék",
      soon: "Hamarosan",
      stock: "Készlet",
      pcs: "db",
      out: "Elfogyott",

      popupTitle: "Új termékek elérhetőek",
      popupSub: "Lapozhatsz nyilakkal vagy húzással – amúgy magától is csúszik.",
      dontShow: "Ne mutasd többet",
      skipAll: "Összes átugrása",
      ok: "Értettem",
      prev: "◀",
      next: "▶",
    },
    en: {
      all: "All products",
      soon: "Coming soon",
      stock: "Stock",
      pcs: "pcs",
      out: "Sold out",

      popupTitle: "New products available",
      popupSub: "Use arrows or swipe – it also auto-slides.",
      dontShow: "Don’t show again",
      skipAll: "Skip all",
      ok: "Got it",
      prev: "◀",
      next: "▶",
    },
  };
  const t = (k) => (TXT[state.lang] && TXT[state.lang][k]) || TXT.hu[k] || k;

  const locale = () => (state.lang === "hu" ? "hu" : "en");

  const norm = (s) => String(s ?? "").trim();

  const getName = (p) =>
    state.lang === "hu"
      ? norm(p.name_hu || p.name_en || "")
      : norm(p.name_en || p.name_hu || "");

  const getFlavor = (p) =>
    state.lang === "hu"
      ? norm(p.flavor_hu || p.flavor_en || "")
      : norm(p.flavor_en || p.flavor_hu || "");

  const isOut = (p) => p && p.status === "out";
  const isSoon = (p) => p && p.status === "soon";
  const isVisible = (p) => p && p.visible !== false;

  const effectivePrice = (p) => {
    const v = Number(p.price);
    if (Number.isFinite(v) && v > 0) return v;
    const c = (state.productsDoc.categories || []).find((x) => String(x.id) === String(p.categoryId));
    const b = Number(c && c.basePrice);
    return Number.isFinite(b) ? b : 0;
  };

  const catLabel = (c) =>
    state.lang === "hu"
      ? norm(c.label_hu || c.label_en || c.id || "")
      : norm(c.label_en || c.label_hu || c.id || "");

  /* ---------------- Source (raw GH) ---------------- */

  const parseQuery = () => new URLSearchParams(location.search);

  function applySyncParams() {
    const q = parseQuery();
    const owner = norm(q.get("sv_owner") || "");
    const repo = norm(q.get("sv_repo") || "");
    const branch = norm(q.get("sv_branch") || q.get("sv_ref") || "");
    if (owner && repo) {
      const src = { owner, repo, branch: branch || "main" };
      try {
        localStorage.setItem(LS.source, JSON.stringify(src));
      } catch {}
    }
  }

  function getOwnerRepoFromUrl() {
    const host = String(location.hostname || "");
    const path = String(location.pathname || "/");
    // owner.github.io/repo/...
    if (host.endsWith("github.io")) {
      const owner = host.split(".")[0];
      const seg = path.split("/").filter(Boolean);
      const repo = seg[0] || "";
      if (owner && repo) return { owner, repo, branch: "gh-pages" };
    }
    return null;
  }

  function getOwnerRepoCfg() {
    try {
      const j = JSON.parse(localStorage.getItem(LS.source) || "null");
      if (j && j.owner && j.repo) return { owner: String(j.owner), repo: String(j.repo), branch: String(j.branch || "main") };
    } catch {}
    return null;
  }

  async function fetchJsonWithEtag(url, etagKey, { forceBust = false, timeoutMs = 6500 } = {}) {
    const headers = { "Cache-Control": "no-store" };
    const prevEtag = state.etag[etagKey] || "";
    if (!forceBust && prevEtag) headers["If-None-Match"] = prevEtag;

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const bustUrl = forceBust ? (url + (url.includes("?") ? "&" : "?") + "_=" + Date.now()) : url;
      const res = await fetch(bustUrl, { cache: "no-store", headers, signal: controller.signal });
      if (res.status === 304) return { ok: true, notModified: true };
      if (!res.ok) return { ok: false, status: res.status };
      const et = res.headers.get("etag") || "";
      if (et) state.etag[etagKey] = et;
      const json = await res.json();
      return { ok: true, json };
    } catch (e) {
      return { ok: false, error: e };
    } finally {
      clearTimeout(to);
    }
  }

  async function resolveSource({ force = false } = {}) {
    if (state.source && !force) return state.source;

    // 1) data/sv_source.json (works on custom domain too)
    try {
      const r = await fetchJsonWithEtag("data/sv_source.json", "sourceFile", { forceBust: true, timeoutMs: 4500 });
      if (r.ok && r.json && r.json.owner && r.json.repo) {
        const owner = String(r.json.owner).trim();
        const repo = String(r.json.repo).trim();
        const branch = String(r.json.branch || r.json.ref || "main").trim() || "main";
        state.source = { owner, repo, branch, rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}` };
        try {
          localStorage.setItem(LS.source, JSON.stringify({ owner, repo, branch }));
        } catch {}
        return state.source;
      }
    } catch {}

    // 2) localStorage (sync link)
    const cfg = getOwnerRepoCfg();
    if (cfg && cfg.owner && cfg.repo) {
      state.source = { ...cfg, rawBase: `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || "main"}` };
      return state.source;
    }

    // 3) github.io inference
    const inf = getOwnerRepoFromUrl();
    if (inf && inf.owner && inf.repo) {
      // branch guess gh-pages first, but fallback later by just using relative if raw fails
      state.source = { ...inf, rawBase: `https://raw.githubusercontent.com/${inf.owner}/${inf.repo}/${inf.branch}` };
      return state.source;
    }

    return null;
  }

  async function fetchDataFile(path, etagKey, { forceBust = false } = {}) {
    const relUrl = path;
    const src = await resolveSource();
    if (src && src.rawBase) {
      const rawUrl = `${src.rawBase}/${path}`;
      // raw first (faster propagation), fallback to relative
      const raw = await fetchJsonWithEtag(rawUrl, etagKey, { forceBust });
      if (raw.ok) return raw;
      const rel = await fetchJsonWithEtag(relUrl, etagKey, { forceBust });
      return rel;
    }
    return await fetchJsonWithEtag(relUrl, etagKey, { forceBust });
  }

  /* ---------------- Normalize ---------------- */

  function normalizeDoc(data) {
    const doc = Array.isArray(data)
      ? { categories: [], products: data, popups: [], featuredEnabled: true }
      : { categories: Array.isArray(data && data.categories) ? data.categories : [], products: Array.isArray(data && data.products) ? data.products : [], popups: Array.isArray(data && data.popups) ? data.popups : [], featuredEnabled: (data && data.featuredEnabled) !== false };

    doc.categories = doc.categories
      .filter((c) => c && c.id)
      .map((c) => ({
        ...c,
        id: String(c.id),
        label_hu: c.label_hu ?? c.label ?? c.id,
        label_en: c.label_en ?? c.label ?? c.id,
        basePrice: c.basePrice ?? 0,
        // kompat: régi név 'featuredEnabled'
        featuredEnabled: (c.featuredEnabled !== false),
        showHot: (c.showHot !== false) && (c.featuredEnabled !== false),
      }));

    doc.products = doc.products
      .filter((p) => p && p.id)
      .map((p) => ({
        ...p,
        id: String(p.id),
        categoryId: String(p.categoryId || ""),
        status: p.status || "ok",
        stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
        visible: p.visible !== false,
      }));

    return doc;
  }

  function normalizeSales(sales) {
    return Array.isArray(sales) ? sales : [];
  }

  function normalizePopups(popups) {
    const arr = Array.isArray(popups) ? popups : [];
    const seen = new Set();
    return arr
      .filter((p) => p && (p.id || p.title_hu || p.title_en))
      .map((p) => ({
        id: String(p.id || ("pp_" + Math.random().toString(16).slice(2))),
        rev: Number.isFinite(Number(p.rev)) ? Number(p.rev) : 1,
        active: !!p.active,
        title_hu: String(p.title_hu || p.title || TXT.hu.popupTitle),
        title_en: String(p.title_en || p.title || TXT.en.popupTitle),
        categories: Array.isArray(p.categories) ? [...new Set(p.categories.map(String).filter(Boolean))] : [],
        products: Array.isArray(p.products) ? [...new Set(p.products.map(String).filter(Boolean))] : [],
      }))
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
  }

  /* ---------------- Hot per category ---------------- */

  function computeHotByCat(doc, sales) {
    if (doc && doc.featuredEnabled === false) return {};
    const counts = new Map();
    for (const s of sales || []) {
      const items = Array.isArray(s.items) ? s.items : [];
      for (const it of items) {
        const pid = String(it.productId || "");
        const qty = Number(it.qty || it.quantity || 0);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        counts.set(pid, (counts.get(pid) || 0) + qty);
      }
    }

    const out = {};
    const loc = locale();

    const flavorKey = (p) => getFlavor(p) || "";

    for (const c of doc.categories || []) {
      if (!c || !c.id || c.id === "soon") continue;
      if (c.showHot === false) continue;
      if (c.featuredEnabled === false) continue;

      const inCat = (doc.products || [])
        .filter((p) => isVisible(p))
        .filter((p) => String(p.categoryId) === String(c.id))
        .filter((p) => !isSoon(p)); // soon not hot

      let best = null;
      let bestCount = 0;

      for (const p of inCat) {
        const cnt = counts.get(String(p.id)) || 0;
        if (cnt > bestCount) {
          bestCount = cnt;
          best = p;
          continue;
        }
        if (cnt === bestCount && cnt > 0) {
          if (!best) {
            best = p;
            continue;
          }
          const a = flavorKey(p);
          const b = flavorKey(best);
          const cmp = a.localeCompare(b, loc, { sensitivity: "base" });
          if (cmp < 0) best = p;
          else if (cmp === 0) {
            if (String(p.id).localeCompare(String(best.id)) < 0) best = p;
          }
        }
      }

      if (best && bestCount > 0) out[String(c.id)] = String(best.id);
    }

    return out;
  }

  /* ---------------- Sorting / filtering ---------------- */

  function orderedCategories() {
    const base = (state.productsDoc.categories || []).filter((c) => c && c.id);
    // keep user order but ensure "all" first and "soon" last
    const list = [{ id: "all", label_hu: t("all"), label_en: t("all") }, ...base, { id: "soon", label_hu: t("soon"), label_en: t("soon") }];
    // de-dupe ids
    const seen = new Set();
    return list.filter((c) => {
      const id = String(c.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function filterList() {
    const doc = state.productsDoc;
    const q = norm(state.search).toLowerCase();

    const prods = (doc.products || []).filter((p) => p && isVisible(p));

    const match = (p) => {
      if (!q) return true;
      const hay = (getName(p) + " " + getFlavor(p)).toLowerCase();
      return hay.includes(q);
    };

    const byCat = (p) => {
      if (state.active === "all") return true;
      if (state.active === "soon") return isSoon(p);
      return String(p.categoryId) === String(state.active);
    };

    const list = prods.filter(byCat).filter(match);

    // partition: hot -> ok -> soon -> out (but in soon tab, only soon)
    const hotIds = new Set();
    if (state.active === "all") {
      for (const k of Object.keys(state.hotByCat || {})) hotIds.add(String(state.hotByCat[k]));
    } else if (state.active !== "soon") {
      const hid = state.hotByCat && state.hotByCat[String(state.active)];
      if (hid) hotIds.add(String(hid));
    }

    const hotPart = [];
    const okPart = [];
    const soonPart = [];
    const outPart = [];

    for (const p of list) {
      const pid = String(p.id);
      if (hotIds.has(pid) && !isSoon(p) && !isOut(p)) hotPart.push(p);
      else if (isSoon(p)) soonPart.push(p);
      else if (isOut(p)) outPart.push(p);
      else okPart.push(p);
    }

    const groupSort = (arr) => {
      const map = new Map();
      for (const p of arr) {
        const key = norm(getName(p)).toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
      const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, locale(), { sensitivity: "base" }));
      const out = [];
      for (const k of keys) {
        const items = map.get(k);
        items.sort((a, b) => getFlavor(a).localeCompare(getFlavor(b), locale(), { sensitivity: "base" }));
        out.push(...items);
      }
      return out;
    };

    if (state.active === "soon") return groupSort(soonPart);

    // hot: keep their original order based on category ordering (for all) else just one
    const hotSorted = (() => {
      if (hotPart.length <= 1) return hotPart;
      // "all": order by category list, then flavor
      const catOrder = new Map();
      orderedCategories().forEach((c, idx) => catOrder.set(String(c.id), idx));
      return [...hotPart].sort((a, b) => {
        const ca = catOrder.get(String(a.categoryId)) ?? 999;
        const cb = catOrder.get(String(b.categoryId)) ?? 999;
        if (ca !== cb) return ca - cb;
        const f = getFlavor(a).localeCompare(getFlavor(b), locale(), { sensitivity: "base" });
        if (f !== 0) return f;
        return String(a.id).localeCompare(String(b.id));
      });
    })();

    return [...hotSorted, ...groupSort(okPart), ...groupSort(soonPart), ...groupSort(outPart)];
  }

  function fmtFt(n) {
    const v = Number(n || 0);
    return v.toLocaleString("hu-HU") + " Ft";
  }

  /* ---------------- Rendering ---------------- */

  function renderNav() {
    const nav = $("#nav");
    if (!nav) return;
    nav.innerHTML = "";

    for (const c of orderedCategories()) {
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

  function makeCard(p) {
    const name = getName(p);
    const flavor = getFlavor(p);
    const out = isOut(p);
    const soon = isSoon(p);
    const price = effectivePrice(p);
    const stockShown = out ? 0 : Math.max(0, Number(p.stock || 0));

    const card = document.createElement("div");
    card.className = "card fade-in";
    if (out) card.classList.add("out");
    if (soon) card.classList.add("soon");
    if (p.__hot) card.classList.add("hot");

    const hero = document.createElement("div");
    hero.className = "hero";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = (name + (flavor ? " - " + flavor : "")).trim();
    img.src = p.image || "";

    if (out) img.style.filter = "grayscale(1) brightness(0.26) contrast(0.95)";
    else if (soon) img.style.filter = "grayscale(0.75) brightness(0.82) contrast(1.02)";

    hero.appendChild(img);

    const badges = document.createElement("div");
    badges.className = "badges";
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
    } else if (p.__hot) {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = "HOT";
      b.style.background = "rgba(255,145,60,.16)";
      b.style.borderColor = "rgba(255,145,60,.45)";
      b.style.color = "rgba(255,205,160,.98)";
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

    ov.appendChild(n);
    ov.appendChild(f);
    hero.appendChild(ov);

    const body = document.createElement("div");
    body.className = "card-body";

    const meta = document.createElement("div");
    meta.className = "meta-row";

    const priceEl = document.createElement("div");
    priceEl.className = "price";
    priceEl.textContent = fmtFt(price);

    const stockEl = document.createElement("div");
    stockEl.className = "stock";
    stockEl.innerHTML =
      soon
        ? `${t("stock")}: <b>—</b>`
        : `${t("stock")}: <b>${stockShown}</b> ${t("pcs")}`;

    meta.appendChild(priceEl);
    meta.appendChild(stockEl);
    body.appendChild(meta);

    card.appendChild(hero);
    card.appendChild(body);

    return card;
  }

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    if (!grid) return;
    grid.innerHTML = "";

    const list = filterList();
    $("#count").textContent = String(list.length);
    if (empty) empty.style.display = list.length ? "none" : "block";

    // mark hot items (so card can show badge)
    const hotIds = new Set();
    if (state.active === "all") for (const k of Object.keys(state.hotByCat || {})) hotIds.add(String(state.hotByCat[k]));
    else if (state.active !== "soon") {
      const hid = state.hotByCat && state.hotByCat[String(state.active)];
      if (hid) hotIds.add(String(hid));
    }
    for (const p of list) p.__hot = hotIds.has(String(p.id));

    for (const p of list) grid.appendChild(makeCard(p));
  }

  function applyRender() {
    renderNav();
    renderGrid();
    $("#loader").style.display = "none";
    $("#app").style.display = "grid";
  }

  /* ---------------- Popup (user) ---------------- */

  function getDismissedMap() {
    try {
      const j = JSON.parse(localStorage.getItem(LS.dismissed) || "{}");
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }

  function setDismissed(id, rev) {
    const map = getDismissedMap();
    map[String(id)] = Math.max(Number(map[String(id)] || 0), Number(rev || 1));
    try {
      localStorage.setItem(LS.dismissed, JSON.stringify(map));
    } catch {}
  }

  function buildPopupItems(popup) {
    const doc = state.productsDoc;
    const prods = (doc.products || []).filter((p) => p && isVisible(p));
    const byId = new Map(prods.map((p) => [String(p.id), p]));
    const items = [];

    // categories -> all products in those cats
    const catIds = new Set((popup.categories || []).map(String));
    if (catIds.size) {
      for (const p of prods) {
        if (catIds.has(String(p.categoryId))) items.push(p);
      }
    }
    for (const pid of popup.products || []) {
      const p = byId.get(String(pid));
      if (p) items.push(p);
    }

    // unique
    const seen = new Set();
    const uniq = [];
    for (const p of items) {
      const id = String(p.id);
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(p);
    }

    // sort: by category label (abc), then name/flavor
    const catName = new Map((doc.categories || []).map((c) => [String(c.id), catLabel(c)]));
    uniq.sort((a, b) => {
      const ca = (catName.get(String(a.categoryId)) || "").localeCompare((catName.get(String(b.categoryId)) || ""), locale(), { sensitivity: "base" });
      if (ca !== 0) return ca;
      const na = getName(a).localeCompare(getName(b), locale(), { sensitivity: "base" });
      if (na !== 0) return na;
      return getFlavor(a).localeCompare(getFlavor(b), locale(), { sensitivity: "base" });
    });

    return uniq;
  }

  function ensurePopupDom() {
    if ($("#svPopupBackdrop")) return;

    const bd = document.createElement("div");
    bd.id = "svPopupBackdrop";
    bd.className = "sv-popup-backdrop";
    bd.innerHTML = `
      <div class="sv-popup" role="dialog" aria-modal="true">
        <div class="sv-popup-top">
          <div>
            <h3 id="svPTitle">${t("popupTitle")}</h3>
            <div class="sub" id="svPSub">${t("popupSub")}</div>
          </div>
          <button class="sv-btn ghost" id="svPClose" aria-label="Close">✕</button>
        </div>

        <div class="sv-popup-body">
          <div class="sv-popup-card" id="svPCardWrap">
            <div class="sv-popup-hero" id="svPHero"></div>
            <div class="sv-popup-info">
              <div>
                <div class="sv-popup-name" id="svPName">—</div>
                <div class="sv-popup-flavor" id="svPFlavor"></div>
              </div>
              <div class="sv-popup-row">
                <div class="sv-popup-price" id="svPPrice"></div>
                <div class="sv-popup-stock" id="svPStock"></div>
              </div>
            </div>
          </div>

          <div class="sv-popup-nav">
            <div class="sv-popup-arrows">
              <button class="sv-btn ghost" id="svPPrev">${t("prev")}</button>
              <button class="sv-btn ghost" id="svPNext">${t("next")}</button>
            </div>
            <div class="sv-counter" id="svPCounter">1/1</div>
          </div>
        </div>

        <div class="sv-popup-footer">
          <label><input type="checkbox" id="svPDont"> <span>${t("dontShow")}</span></label>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="sv-btn ghost" id="svPSkipAll" style="display:none;">${t("skipAll")}</button>
            <button class="sv-btn" id="svPOk">${t("ok")}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(bd);

    const close = () => popupClose(false);
    $("#svPClose").onclick = close;

    $("#svPPrev").onclick = () => popupSlide(-1);
    $("#svPNext").onclick = () => popupSlide(1);
    $("#svPOk").onclick = () => popupOk();
    $("#svPSkipAll").onclick = () => popupSkipAll();

    $("#svPDont").addEventListener("change", (e) => {
      state.popup.dontShow = !!e.target.checked;
    });

    // swipe on hero
    const hero = $("#svPHero");
    hero.style.touchAction = "pan-y";
    const start = (x, id) => {
      state.popup.dragging = true;
      state.popup.dragStartX = x;
      state.popup.dragDX = 0;
      state.popup.dragId = id;
    };
    const move = (x) => {
      if (!state.popup.dragging) return;
      state.popup.dragDX = x - state.popup.dragStartX;
      // subtle follow
      const wrap = $("#svPCardWrap");
      wrap.style.transform = `translateX(${Math.max(-28, Math.min(28, state.popup.dragDX / 6))}px)`;
    };
    const end = () => {
      if (!state.popup.dragging) return;
      const dx = state.popup.dragDX;
      state.popup.dragging = false;
      state.popup.dragDX = 0;
      state.popup.dragId = null;
      const wrap = $("#svPCardWrap");
      wrap.style.transform = "";
      if (Math.abs(dx) > 70) popupSlide(dx > 0 ? -1 : 1);
    };

    // pointer events
    hero.addEventListener("pointerdown", (e) => {
      hero.setPointerCapture(e.pointerId);
      start(e.clientX, e.pointerId);
    });
    hero.addEventListener("pointermove", (e) => move(e.clientX));
    hero.addEventListener("pointerup", end);
    hero.addEventListener("pointercancel", end);
  }

  function popupQueueBuild() {
    if (state.popup.sessionClosed) return [];

    const dismissed = getDismissedMap();
    const active = state.popups.filter((p) => p && p.active);

    const queue = [];
    for (const p of active) {
      const prevRev = Number(dismissed[String(p.id)] || 0);
      if (prevRev >= Number(p.rev || 1)) continue;

      const items = buildPopupItems(p);
      if (!items.length) continue;

      queue.push({ popup: p, items });
    }

    // stable ordering: title (abc by current lang), then id
    queue.sort((a, b) => {
      const ta = (state.lang === "hu" ? a.popup.title_hu : a.popup.title_en) || "";
      const tb = (state.lang === "hu" ? b.popup.title_hu : b.popup.title_en) || "";
      const c = ta.localeCompare(tb, locale(), { sensitivity: "base" });
      if (c !== 0) return c;
      return String(a.popup.id).localeCompare(String(b.popup.id));
    });

    return queue;
  }

  function popupMaybeOpen() {
    ensurePopupDom();

    const queue = popupQueueBuild();
    const sig = JSON.stringify(queue.map((q) => ({ id: q.popup.id, rev: q.popup.rev })));
    if (!queue.length) {
      popupClose(true);
      return;
    }

    // if already open and same queue signature, keep current
    if (state.popup.open && sig === state.popup.lastQueueSig) return;

    state.popup.queue = queue;
    state.popup.lastQueueSig = sig;
    state.popup.popupIndex = 0;
    state.popup.itemIndex = 0;
    state.popup.open = true;

    $("#svPSkipAll").style.display = queue.length > 1 ? "inline-flex" : "none";

    $("#svPopupBackdrop").style.display = "flex";
    popupRender();
    popupStartTimer();
  }

  function popupCurrent() {
    const q = state.popup.queue[state.popup.popupIndex];
    return q || null;
  }

  function popupRender() {
    const cur = popupCurrent();
    if (!cur) return;
    const popup = cur.popup;
    const items = cur.items;

    $("#svPTitle").textContent = state.lang === "hu" ? popup.title_hu : popup.title_en;
    $("#svPSub").textContent = t("popupSub");

    const idx = Math.max(0, Math.min(items.length - 1, state.popup.itemIndex));
    state.popup.itemIndex = idx;

    const p = items[idx];

    // hero
    const hero = $("#svPHero");
    hero.innerHTML = "";
    const img = document.createElement("img");
    img.loading = "eager";
    img.src = p.image || "";
    img.alt = (getName(p) + (getFlavor(p) ? " - " + getFlavor(p) : "")).trim();
    hero.appendChild(img);

    $("#svPName").textContent = getName(p) || "—";
    $("#svPFlavor").textContent = getFlavor(p) || "";
    $("#svPPrice").textContent = fmtFt(effectivePrice(p));

    const soon = isSoon(p);
    const out = isOut(p);
    const stockShown = out ? 0 : Math.max(0, Number(p.stock || 0));
    $("#svPStock").textContent = soon ? `${t("stock")}: —` : `${t("stock")}: ${stockShown} ${t("pcs")}`;

    $("#svPCounter").textContent = `${idx + 1}/${items.length}`;

    // reset dontShow checkbox UI (keep user's current selection)
    $("#svPDont").checked = !!state.popup.dontShow;
  }

  function popupAnimate(direction) {
    const wrap = $("#svPCardWrap");
    wrap.classList.remove("sv-slide-out-left", "sv-slide-in-right", "sv-slide-out-right", "sv-slide-in-left");

    if (direction > 0) {
      wrap.classList.add("sv-slide-out-left");
      setTimeout(() => {
        wrap.classList.remove("sv-slide-out-left");
        popupRender();
        wrap.classList.add("sv-slide-in-right");
        setTimeout(() => wrap.classList.remove("sv-slide-in-right"), 230);
      }, 180);
    } else {
      wrap.classList.add("sv-slide-out-right");
      setTimeout(() => {
        wrap.classList.remove("sv-slide-out-right");
        popupRender();
        wrap.classList.add("sv-slide-in-left");
        setTimeout(() => wrap.classList.remove("sv-slide-in-left"), 230);
      }, 180);
    }
  }

  function popupSlide(dir) {
    const cur = popupCurrent();
    if (!cur) return;
    const items = cur.items;
    if (items.length <= 1) return;

    popupStopTimer();

    let next = state.popup.itemIndex + dir;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    state.popup.itemIndex = next;
    popupAnimate(dir);

    popupStartTimer();
  }

  function popupStartTimer() {
    popupStopTimer();
    if (!state.popup.open) return;
    state.popup.timer = setInterval(() => {
      const cur = popupCurrent();
      if (!cur) return;
      const items = cur.items;
      if (items.length <= 1) return;

      state.popup.itemIndex = (state.popup.itemIndex + 1) % items.length;
      popupAnimate(1);
    }, 3200);
  }

  function popupStopTimer() {
    if (state.popup.timer) {
      clearInterval(state.popup.timer);
      state.popup.timer = null;
    }
  }

  function popupClose(silent) {
    popupStopTimer();
    state.popup.open = false;
    if ($("#svPopupBackdrop")) $("#svPopupBackdrop").style.display = "none";
    if (!silent) {
      // nothing
    }
  }

  function popupOk() {
    const cur = popupCurrent();
    if (!cur) {
      popupClose(true);
      return;
    }
    if (state.popup.dontShow) setDismissed(cur.popup.id, cur.popup.rev);

    // next popup if any
    if (state.popup.popupIndex < state.popup.queue.length - 1) {
      state.popup.popupIndex += 1;
      state.popup.itemIndex = 0;
      popupRender();
      popupStartTimer();
      return;
    }
    popupClose(true);
  }

  function popupSkipAll() {
    if (!state.popup.queue.length) {
      popupClose(true);
      return;
    }

    if (state.popup.dontShow) {
      for (const q of state.popup.queue) setDismissed(q.popup.id, q.popup.rev);
    }

    state.popup.sessionClosed = true;
    popupClose(true);
  }

  /* ---------------- Data + live updates ---------------- */

  function applyLivePayload(payload) {
    if (!payload) return;
    try {
      const doc = payload.doc ? normalizeDoc(payload.doc) : null;
      const sales = payload.sales ? normalizeSales(payload.sales) : null;
      const popups = payload.popups ? normalizePopups(payload.popups) : null;

      let changed = false;
      if (doc) {
        state.productsDoc = doc;
        state.popups = normalizePopups(state.productsDoc.popups || []);
        changed = true;
      }
      if (sales) {
        state.sales = sales;
        changed = true;
      }
      if (popups) {
        state.popups = popups;
        changed = true;
      }
      if (changed) {
        state.hotByCat = computeHotByCat(state.productsDoc, state.sales);
        applyRender();
        popupMaybeOpen();
      }
    } catch {}
  }

  async function initialLoad() {
    applySyncParams();

    // UI hooks
    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#langBtn").onclick = () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem(LS.lang, state.lang);
      $("#langLabel").textContent = state.lang.toUpperCase();
      renderNav();
      renderGrid();
      popupMaybeOpen();
    };

    $("#search").addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderGrid();
    });

    // live payload from admin (same browser)
    try {
      const cached = localStorage.getItem(LS.live);
      if (cached) applyLivePayload(JSON.parse(cached));
    } catch {}
    try {
      const ch = new BroadcastChannel("sv_live");
      ch.onmessage = (ev) => {
        if (ev && ev.data) applyLivePayload(ev.data);
      };
    } catch {}
    window.addEventListener("storage", (e) => {
      if (e.key === LS.live && e.newValue) {
        try {
          applyLivePayload(JSON.parse(e.newValue));
        } catch {}
      }
    });

    $("#loaderText").textContent = "Termékek betöltése…";

    // first pull (products must succeed)
    const pRes = await fetchDataFile("data/products.json", "products", { forceBust: true });
    if (!pRes.ok) throw new Error("products load failed");
    state.productsDoc = normalizeDoc(pRes.json);
    state.popups = normalizePopups(state.productsDoc.popups || []);

    // optional files
    const sRes = await fetchDataFile("data/sales.json", "sales", { forceBust: true });
    state.sales = sRes.ok ? normalizeSales(sRes.json) : [];
    state.popups = normalizePopups(state.productsDoc.popups || []);

    state.hotByCat = computeHotByCat(state.productsDoc, state.sales);

    applyRender();
    popupMaybeOpen();

    // poll loop
    let tick = 0;

    async function poll() {
      tick += 1;
      const force = tick % 5 === 0; // ~10s forced bust

      const [pR, sR] = await Promise.all([
        fetchDataFile("data/products.json", "products", { forceBust: force }),
        fetchDataFile("data/sales.json", "sales", { forceBust: force }),
      ]);

      let changed = false;

      if (pR.ok && !pR.notModified) {
        state.productsDoc = normalizeDoc(pR.json);
        state.popups = normalizePopups(state.productsDoc.popups || []);
        changed = true;
      }
      if (sR.ok && !sR.notModified) {
        state.sales = normalizeSales(sR.json);
        changed = true;
      }

      if (changed) {
        state.hotByCat = computeHotByCat(state.productsDoc, state.sales);

        // render throttling via signature (prevents double flicker)
        const sig = JSON.stringify({
          lang: state.lang,
          act: state.active,
          docLen: (state.productsDoc.products || []).length,
          docHash: (state.productsDoc.products || []).map((x) => [x.id, x.stock, x.status, x.visible, x.price]).slice(0, 200),
          hot: state.hotByCat,
        });
        if (sig !== state.lastRenderSig) {
          state.lastRenderSig = sig;
          renderNav();
          renderGrid();
        }
        popupMaybeOpen();
      }

      setTimeout(poll, document.hidden ? 4500 : 1800);
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        // burst for quick pickup
        (async () => {
          for (let i = 0; i < 3; i++) {
            await Promise.all([
              fetchDataFile("data/products.json", "products", { forceBust: true }),
              fetchDataFile("data/sales.json", "sales", { forceBust: true }),
            ]).then((arr) => {
              const [pR, sR] = arr;
              let ch = false;
              if (pR.ok && !pR.notModified) {
                state.productsDoc = normalizeDoc(pR.json);
                state.popups = normalizePopups(state.productsDoc.popups || []);
                ch = true;
              }
              if (sR.ok && !sR.notModified) {
                state.sales = normalizeSales(sR.json);
                ch = true;
              }
              if (ch) {
                state.hotByCat = computeHotByCat(state.productsDoc, state.sales);
                renderNav();
                renderGrid();
                popupMaybeOpen();
              }
            }).catch(() => {});
            await new Promise((r) => setTimeout(r, 280));
          }
        })();
      }
    });

    poll();
  }

  initialLoad().catch((err) => {
    console.error(err);
    const lt = $("#loaderText");
    if (lt) {
      lt.textContent =
        "Betöltési hiba. (Nyisd meg a konzolt.) Ha telefonon vagy custom domainen vagy: nyisd meg egyszer a Sync linket az admin Beállításokból.";
    }
  });
})();