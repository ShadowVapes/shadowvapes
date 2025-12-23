const $ = (s) => document.querySelector(s);

const LS = {
  lang: "sv_lang",
  owner: "sv_gh_owner",
  repo: "sv_gh_repo",
  branch: "sv_gh_branch",
  cacheBust: "sv_cache_bust",
};

const state = {
  lang: localStorage.getItem(LS.lang) || "hu",
  doc: { categories: [], products: [] },
  activeCat: "all", // all | <categoryId> | soon
  q: "",
};

const T = {
  hu: { all: "Összes termék", soon: "Hamarosan", title: "Termékek", stock: "Készlet", out: "Elfogyott", ok: "Készleten" },
  en: { all: "All products", soon: "Coming soon", title: "Products", stock: "Stock", out: "Sold out", ok: "In stock" },
};
const tr = (k) => (T[state.lang] && T[state.lang][k]) || k;

function norm(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pName(p) {
  return state.lang === "en"
    ? (p.name_en || p.name_hu || p.name || "")
    : (p.name_hu || p.name_en || p.name || "");
}
function pFlavor(p) {
  return state.lang === "en"
    ? (p.flavor_en || p.flavor_hu || p.flavor || "")
    : (p.flavor_hu || p.flavor_en || p.flavor || "");
}
function cLabel(c) {
  return state.lang === "en"
    ? (c.label_en || c.label_hu || c.id)
    : (c.label_hu || c.label_en || c.id);
}

function catById(id) {
  return state.doc.categories.find((c) => String(c.id) === String(id)) || null;
}

function effectivePrice(p) {
  const direct = p.price;
  if (direct !== null && direct !== undefined && direct !== "" && !Number.isNaN(Number(direct))) {
    return Number(direct);
  }
  const c = catById(p.categoryId);
  const base = c ? Number(c.basePrice || 0) : 0;
  return Number.isFinite(base) ? base : 0;
}

function isSoon(p) {
  return (p.status || "ok") === "soon";
}
function isOut(p) {
  const st = (p.status || "ok");
  if (st === "out") return true;
  const stock = Math.max(0, Number(p.stock || 0));
  return stock <= 0 && st !== "soon";
}

async function fetchDoc() {
  const owner = (localStorage.getItem(LS.owner) || "").trim();
  const repo = (localStorage.getItem(LS.repo) || "").trim();
  const branch = (localStorage.getItem(LS.branch) || "main").trim();
  const cb = localStorage.getItem(LS.cacheBust) || Date.now();

  // gyorsabb: ha adminban be van állítva a repo, RAW-ról olvasunk
  if (owner && repo) {
    const url = ShadowGH.rawUrl({ owner, repo, branch, path: "data/products.json", cb });
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("Nem tudtam betölteni products.json (RAW).");
    return await r.json();
  }

  // fallback: GitHub Pages local
  const r = await fetch(`data/products.json?cb=${encodeURIComponent(cb)}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Nem tudtam betölteni products.json.");
  return await r.json();
}

function orderedCats() {
  const cats = [...(state.doc.categories || [])]
    .filter((c) => c && c.id && String(c.id) !== "all")
    .map((c) => ({
      id: String(c.id),
      label_hu: c.label_hu || c.id,
      label_en: c.label_en || c.label_hu || c.id,
      basePrice: Number(c.basePrice || 0),
    }));

  cats.sort((a, b) => cLabel(a).localeCompare(cLabel(b), state.lang === "hu" ? "hu" : "en"));

  // all first, soon last (virtual)
  return [
    { id: "all", _virtual: true },
    ...cats,
    { id: "soon", _virtual: true },
  ];
}

function filterProducts() {
  const q = norm(state.q);
  const list = (state.doc.products || []).filter((p) => {
    if (!p) return false;

    if (state.activeCat === "soon") return isSoon(p);
    if (isSoon(p)) return false; // soon csak a Hamarosan tabban

    if (state.activeCat !== "all" && String(p.categoryId) !== String(state.activeCat)) return false;

    if (!q) return true;
    const hay = `${pName(p)} ${pFlavor(p)}`;
    return norm(hay).includes(q);
  });

  // Név alapján csoport → mindig egymás mellett
  const groups = new Map();
  for (const p of list) {
    const k = norm(pName(p));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, state.lang === "hu" ? "hu" : "en"));

  // kompromisszum: out-only csoportok menjenek a végére (így “elfogyott hátul” érzés megvan)
  const groupObjs = keys.map((k) => {
    const items = groups.get(k);
    items.sort((a, b) => {
      // csoporton belül: ok/stock előbb, out később, flavor szerint
      const ao = isOut(a) ? 1 : 0;
      const bo = isOut(b) ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return norm(pFlavor(a)).localeCompare(norm(pFlavor(b)));
    });
    const allOut = items.every(isOut);
    return { k, items, allOut };
  });

  groupObjs.sort((a, b) => (a.allOut === b.allOut ? a.k.localeCompare(b.k) : (a.allOut ? 1 : -1)));

  return groupObjs.flatMap((g) => g.items);
}

function renderNav() {
  const nav = $("#categoryNav");
  nav.innerHTML = "";

  const cats = orderedCats();
  for (const c of cats) {
    const btn = document.createElement("button");
    btn.textContent = c.id === "all" ? tr("all") : (c.id === "soon" ? tr("soon") : cLabel(c));
    btn.className = (state.activeCat === c.id) ? "active" : "";
    btn.onclick = () => {
      state.activeCat = c.id;
      renderNav();
      renderGrid();
    };
    nav.appendChild(btn);
  }
}

function fmtFt(n) {
  const v = Number(n || 0);
  return `${v.toLocaleString(state.lang === "hu" ? "hu-HU" : "en-US")} Ft`;
}

function badgeFor(p) {
  if (state.activeCat === "soon" || isSoon(p)) return { cls: "soon", txt: tr("soon") };
  if (isOut(p)) return { cls: "out", txt: tr("out") };
  return { cls: "ok", txt: tr("ok") };
}

function renderGrid() {
  const grid = $("#grid");
  const empty = $("#empty");
  const items = filterProducts();

  $("#countLabel").textContent = String(items.length);
  grid.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  for (const p of items) {
    const card = document.createElement("div");
    card.className = `card fade-in${isOut(p) ? " dim" : ""}`;

    const hero = document.createElement("div");
    hero.className = "hero";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = `${pName(p)} ${pFlavor(p)}`.trim();
    img.src = p.image || "";
    hero.appendChild(img);

    const badges = document.createElement("div");
    badges.className = "badges";
    const b = badgeFor(p);
    const badge = document.createElement("div");
    badge.className = `badge ${b.cls}`;
    badge.textContent = b.txt;
    badges.appendChild(badge);
    hero.appendChild(badges);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "title-block";
    title.innerHTML = `
      <div class="name">${escapeHtml(pName(p) || "")}</div>
      <div class="flavor">${escapeHtml(pFlavor(p) || "")}</div>
    `;

    const meta = document.createElement("div");
    meta.className = "meta-row";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = fmtFt(effectivePrice(p));

    const stock = document.createElement("div");
    stock.className = "stock";
    if (isSoon(p)) {
      stock.innerHTML = `<span>${tr("stock")}:</span> <b>—</b>`;
    } else {
      const s = Math.max(0, Number(p.stock || 0));
      stock.innerHTML = `<span>${tr("stock")}:</span> <b>${s} db</b>`;
    }

    meta.appendChild(price);
    meta.appendChild(stock);

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(hero);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[m]));
}

async function boot() {
  $("#langLabel").textContent = state.lang.toUpperCase();
  $("#pageTitle").textContent = tr("title");

  $("#langBtn").onclick = async () => {
    state.lang = state.lang === "hu" ? "en" : "hu";
    localStorage.setItem(LS.lang, state.lang);
    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#pageTitle").textContent = tr("title");
    renderNav();
    renderGrid();
  };

  $("#search").addEventListener("input", (e) => {
    state.q = e.target.value || "";
    renderGrid();
  });
  $("#clear").onclick = () => {
    state.q = "";
    $("#search").value = "";
    renderGrid();
  };

  // load
  state.doc = await fetchDoc();
  if (Array.isArray(state.doc)) state.doc = { categories: [], products: state.doc };
  if (!Array.isArray(state.doc.categories)) state.doc.categories = [];
  if (!Array.isArray(state.doc.products)) state.doc.products = [];

  // show app
  $("#loader").style.display = "none";
  $("#app").style.display = "grid";

  renderNav();
  renderGrid();
}

window.addEventListener("DOMContentLoaded", () => {
  // github helper needed for RAW url
  if (!window.ShadowGH) {
    const s = document.createElement("script");
    s.src = "assets/github.js";
    s.onload = () => boot().catch((e) => alert("Betöltés hiba: " + e.message));
    document.head.appendChild(s);
  } else {
    boot().catch((e) => alert("Betöltés hiba: " + e.message));
  }
});
