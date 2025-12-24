(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu",
    active: "all",
    productsDoc: { categories: [], products: [] },
    search: "",
    etagProducts: "",
  };

  const UI = {
    all: "Összes termék",
    soon: "Hamarosan",
    stock: "Készlet",
    pcs: "db",
    out: "Elfogyott",
  };
  const t = (k) => UI[k] || k;

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
    // név HU/EN ugyanaz, szóval fixen ezt használjuk
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

  /* ----------------- Source resolving (RAW preferált, custom domainen is) ----------------- */
  let source = null; // {owner, repo, branch}

  function getOwnerRepoFromUrl() {
    // https://username.github.io/repo/...
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

  async function resolveSource() {
    if (source) return source;

    // 1) cache
    try {
      const cached = JSON.parse(localStorage.getItem("sv_source") || "null");
      if (cached && cached.owner && cached.repo && cached.branch) {
        source = cached;
        return source;
      }
    } catch {}

    // 2) stabil fájl (admin írja): data/sv_source.json
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

  async function fetchProducts({ forceBust = false } = {}) {
    const src = await resolveSource();
    const base = src
      ? `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/data/products.json`
      : `data/products.json`;

    // Cache-bust akkor, ha kell (különben ETag/304 gyorsít)
    const url = forceBust ? `${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}` : base;

    const headers = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    };
    if (!forceBust && src && state.etagProducts) headers["If-None-Match"] = state.etagProducts;

    const r = await fetch(url, { cache: "no-store", headers });
    if (r.status === 304) return null;
    if (!r.ok) throw new Error(`Nem tudtam betölteni a termékeket (${r.status})`);

    if (!forceBust && src) {
      const et = r.headers.get("ETag");
      if (et) state.etagProducts = et;
    }

    return await r.json();
  }

  function normalizeDoc(data) {
    if (Array.isArray(data)) return { categories: [], products: data };
    const categories = data && Array.isArray(data.categories) ? data.categories : [];
    const products = data && Array.isArray(data.products) ? data.products : [];
    return { categories, products };
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
      }))
      .sort((a, b) => catLabel(a).localeCompare(catLabel(b), "hu"));

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
      categoryId: String(p.categoryId || ""),
      status: p.status === "soon" || p.status === "out" || p.status === "ok" ? p.status : "ok",
      stock: Math.max(0, Number(p.stock || 0)),
    }));

    if (state.active === "soon") {
      list = list.filter((p) => p.status === "soon");
    } else {
      // soon csak Hamarosan alatt
      list = list.filter((p) => p.status !== "soon");
      if (state.active !== "all") list = list.filter((p) => String(p.categoryId) === String(state.active));
    }

    if (q) {
      list = list.filter((p) => norm(getName(p) + " " + getFlavor(p)).includes(q));
    }

    // out mindenhol leghátul
    const okPart = list.filter((p) => !isOut(p));
    const outPart = list.filter((p) => isOut(p));

    const groupSort = (arr) => {
      const map = new Map();
      for (const p of arr) {
        const key = norm(getName(p));
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
      const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, "hu"));
      const out = [];
      for (const k of keys) {
        const items = map.get(k);
        items.sort((a, b) => norm(getFlavor(a)).localeCompare(norm(getFlavor(b))));
        out.push(...items);
      }
      return out;
    };

    return [...groupSort(okPart), ...groupSort(outPart)];
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

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    grid.innerHTML = "";

    const list = filterList();
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
  let lastSig = "";

  function applyDoc(doc) {
    if (!doc) return;
    const sig = JSON.stringify(doc);
    if (sig && sig === lastSig) return;
    lastSig = sig;
    state.productsDoc = doc;
    renderNav();
    renderGrid();
    $("#loader").style.display = "none";
    $("#app").style.display = "grid";
  }

  async function init() {
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
        if (j && j.doc) applyDoc(j.doc);
      }
    } catch {}

    try {
      const ch = new BroadcastChannel("sv_live");
      ch.onmessage = (ev) => {
        if (ev && ev.data && ev.data.doc) applyDoc(ev.data.doc);
      };
    } catch {}

    window.addEventListener("storage", (e) => {
      if (e.key === "sv_live_payload" && e.newValue) {
        try {
          const j = JSON.parse(e.newValue);
          if (j && j.doc) applyDoc(j.doc);
        } catch {}
      }
    });

    $("#loaderText").textContent = "Termékek betöltése…";

    const raw = await fetchProducts({ forceBust: true });
    const doc = normalizeDoc(raw);
    applyDoc(doc);

    // poll: 2s aktív, 12s háttér; + 10s-enként forced cache-bust
    let n = 0;

    async function pollOnce(forceBust = false) {
      try {
        const data = await fetchProducts({ forceBust });
        if (!data) return;
        applyDoc(normalizeDoc(data));
      } catch {}
    }

    async function burst() {
      // fókuszkor gyorsan 1-2 mp alatt felkapja
      for (let i = 0; i < 4; i++) {
        await pollOnce(true);
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    async function loop() {
      n++;
      const force = n % 5 === 0; // kb 10s-enként
      await pollOnce(force);
      setTimeout(loop, document.hidden ? 12000 : 2000);
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) burst();
    });

    loop();
  }

  init().catch((err) => {
    console.error(err);
    $("#loaderText").textContent =
      "Betöltési hiba. Nyisd meg a konzolt (F12) vagy nézd meg, hogy létezik-e: data/sv_source.json";
  });
})();