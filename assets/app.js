(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    lang: localStorage.getItem("sv_lang") || "hu",
    doc: { categories: [], products: [] },
    activeCat: "all", // all | soon | categoryId
    search: ""
  };

  const T = {
    hu: { all: "Összes termék", soon: "Hamarosan", stock: "Készlet", pcs: "db", sold: "Elfogyott", coming: "Hamarosan", products: "termék", loading: "Betöltés..." },
    en: { all: "All products", soon: "Coming soon", stock: "Stock", pcs: "pcs", sold: "Sold out", coming: "Coming soon", products: "products", loading: "Loading..." }
  };
  const tr = (k) => (T[state.lang] && T[state.lang][k]) || k;

  const norm = (s) => (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const getName = (p) => state.lang === "en" ? (p.name_en || p.name_hu || p.name || "") : (p.name_hu || p.name_en || p.name || "");
  const getFlavor = (p) => state.lang === "en" ? (p.flavor_en || p.flavor_hu || p.flavor || "") : (p.flavor_hu || p.flavor_en || p.flavor || "");

  function showLoader(on) {
    const l = $("#loader");
    const r = $("#appRoot");
    $("#loaderText").textContent = tr("loading");
    l.style.display = on ? "flex" : "none";
    r.style.display = on ? "none" : "";
  }

  async function load() {
    showLoader(true);
    const res = await fetch("data/products.json", { cache: "no-store" });
    const data = await res.json();

    // support old format: array -> products
    if (Array.isArray(data)) state.doc = { categories: [], products: data };
    else state.doc = { categories: data.categories || [], products: data.products || [] };

    // sanitize
    if (!Array.isArray(state.doc.categories)) state.doc.categories = [];
    if (!Array.isArray(state.doc.products)) state.doc.products = [];

    // ensure category IDs are strings
    state.doc.categories = state.doc.categories
      .filter(c => c && c.id)
      .map(c => ({ id: String(c.id), label_hu: c.label_hu || c.id, label_en: c.label_en || c.label_hu || c.id }));

    // store language ui
    $("#langLabel").textContent = state.lang.toUpperCase();

    renderNav();
    render();
    bind();
    showLoader(false);
  }

  function bind() {
    $("#search").addEventListener("input", (e) => {
      state.search = e.target.value || "";
      render();
    });

    $("#langBtn").addEventListener("click", () => {
      state.lang = state.lang === "hu" ? "en" : "hu";
      localStorage.setItem("sv_lang", state.lang);
      $("#langLabel").textContent = state.lang.toUpperCase();
      renderNav();
      render();
    });
  }

  function orderedCategories() {
    // All first, Soon last ALWAYS
    const cats = [...state.doc.categories];

    // stable sort by HU label (jó default)
    cats.sort((a, b) => (a.label_hu || a.id).localeCompare((b.label_hu || b.id), "hu"));

    return {
      normal: cats,
      all: { id: "all", label: tr("all") },
      soon: { id: "soon", label: tr("soon") }
    };
  }

  function renderNav() {
    const nav = $("#catNav");
    nav.innerHTML = "";

    const { normal, all, soon } = orderedCategories();

    const mkBtn = (id, label) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = (state.activeCat === id) ? "active" : "";
      b.addEventListener("click", () => {
        state.activeCat = id;
        renderNav();
        render();
      });
      return b;
    };

    nav.appendChild(mkBtn(all.id, all.label));
    for (const c of normal) nav.appendChild(mkBtn(c.id, state.lang === "en" ? (c.label_en || c.id) : (c.label_hu || c.id)));
    nav.appendChild(mkBtn(soon.id, soon.label)); // <-- ALWAYS last
  }

  function filterProducts() {
    const q = norm(state.search);

    let list = state.doc.products.filter(p => {
      const status = (p.status || "ok").toLowerCase();
      const stock = Number(p.stock || 0);

      // soon csak a soon tabban
      if (status === "soon") return state.activeCat === "soon";
      if (state.activeCat === "soon") return false;

      // kategória szűrés
      if (state.activeCat !== "all") {
        return String(p.categoryId || "") === String(state.activeCat);
      }
      return true;
    });

    if (q) {
      list = list.filter(p => {
        const n = norm(getName(p));
        const f = norm(getFlavor(p));
        return n.includes(q) || f.includes(q);
      });
    }

    // Group by name so same-name products are ALWAYS next to each other
    const map = new Map();
    for (const p of list) {
      const key = norm(getName(p));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }

    const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, state.lang === "hu" ? "hu" : "en"));

    const out = [];
    for (const k of keys) {
      const arr = map.get(k);
      // inside group by flavor
      arr.sort((a, b) => norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), "hu"));
      out.push(...arr);
    }

    return out;
  }

  function badgeFor(p) {
    const status = (p.status || "ok").toLowerCase();
    const stock = Math.max(0, Number(p.stock || 0));

    if (status === "soon") return { text: tr("coming"), cls: "soon" };
    if (status === "out" || stock <= 0) return { text: tr("sold"), cls: "out" };
    return null;
  }

  function render() {
    const grid = $("#grid");
    const empty = $("#empty");
    const title = $("#pageTitle");
    const countText = $("#countText");

    const { normal } = orderedCategories();
    const catLabel = (id) => {
      if (id === "all") return tr("all");
      if (id === "soon") return tr("soon");
      const c = normal.find(x => x.id === id);
      if (!c) return tr("all");
      return state.lang === "en" ? (c.label_en || c.id) : (c.label_hu || c.id);
    };

    title.textContent = catLabel(state.activeCat);

    const list = filterProducts();

    // counts
    countText.textContent = String(list.length);
    empty.style.display = list.length ? "none" : "block";

    grid.innerHTML = "";

    for (const p of list) {
      const name = getName(p);
      const flavor = getFlavor(p);
      const stock = Math.max(0, Number(p.stock || 0));
      const status = (p.status || "ok").toLowerCase();

      const card = document.createElement("div");
      const dim = (status === "out" || stock <= 0);
      card.className = "card fade-in" + (dim ? " dim" : "");

      const hero = document.createElement("div");
      hero.className = "hero";

      const img = document.createElement("img");
      img.alt = `${name}${flavor ? " - " + flavor : ""}`;
      img.loading = "lazy";
      img.src = p.image || "";
      hero.appendChild(img);

      const badges = document.createElement("div");
      badges.className = "badges";
      const b = badgeFor(p);
      if (b) {
        const bd = document.createElement("div");
        bd.className = "badge " + b.cls;
        bd.textContent = b.text;
        badges.appendChild(bd);
      }
      hero.appendChild(badges);

      const overlay = document.createElement("div");
      overlay.className = "overlay-title";
      overlay.innerHTML = `
        <div class="name">${escapeHtml(name)}</div>
        <div class="flavor">${escapeHtml(flavor || "")}</div>
      `;
      hero.appendChild(overlay);

      const body = document.createElement("div");
      body.className = "card-body";

      const price = Number(p.price || 0);
      body.innerHTML = `
        <div class="meta-row">
          <div class="price">${fmt(price)} Ft</div>
          <div class="stock">${status === "soon" ? "" : `${tr("stock")}: <b>${stock}</b> ${tr("pcs")}`}</div>
        </div>
      `;

      card.appendChild(hero);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  function fmt(n) {
    const v = Number(n || 0);
    return v.toLocaleString(state.lang === "en" ? "en-US" : "hu-HU");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  load().catch(err => {
    console.error(err);
    alert("Hiba: " + err.message);
    showLoader(false);
  });
})();
