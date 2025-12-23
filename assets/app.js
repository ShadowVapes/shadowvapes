const $ = (s) => document.querySelector(s);

const state = {
  lang: localStorage.getItem("sv_lang") || "hu",
  active: "all",
  search: "",
  categories: [],
  products: []
};

const TXT = {
  hu: { all: "Összes termék", soon: "Hamarosan", stock: "Készlet", pcs: "db" },
  en: { all: "All products",  soon: "Coming soon", stock: "Stock", pcs: "pcs" }
};

const tr = (k) => (TXT[state.lang] && TXT[state.lang][k]) || k;

function norm(s){
  return (s || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getName(p){
  return state.lang === "en"
    ? (p.name_en || p.name_hu || p.name || "")
    : (p.name_hu || p.name_en || p.name || "");
}
function getFlavor(p){
  return state.lang === "en"
    ? (p.flavor_en || p.flavor_hu || p.flavor || "")
    : (p.flavor_hu || p.flavor_en || p.flavor || "");
}
function catLabel(c){
  return state.lang === "en" ? (c.label_en || c.label_hu || c.id) : (c.label_hu || c.label_en || c.id);
}

function hideLoader(){
  const l = $("#loader");
  if(l) l.style.display = "none";
}

function buildCategories(){
  // kategóriák a products.json-ből, + virtuális all/soon
  const cats = (state.categories || [])
    .filter(c => c && c.id && c.id !== "all" && c.id !== "soon")
    .map(c => ({
      id: String(c.id),
      label_hu: c.label_hu || c.id,
      label_en: c.label_en || c.label_hu || c.id
    }));

  // stabil rendezés név szerint
  cats.sort((a,b) => catLabel(a).localeCompare(catLabel(b), state.lang === "hu" ? "hu" : "en"));

  // ✅ all first, ✅ soon last
  return [
    { id: "all", virtual: true },
    ...cats,
    { id: "soon", virtual: true }
  ];
}

function renderNav(){
  const nav = $("#nav");
  nav.innerHTML = "";

  const cats = buildCategories();
  for(const c of cats){
    const btn = document.createElement("button");
    const label = c.id === "all" ? tr("all") : (c.id === "soon" ? tr("soon") : catLabel(c));
    btn.textContent = label;
    btn.className = (state.active === c.id) ? "active" : "";
    btn.onclick = () => {
      state.active = c.id;
      $("#title").textContent = label;
      renderNav();
      renderGrid();
    };
    nav.appendChild(btn);
  }
}

function filterList(){
  const q = norm(state.search);

  let list = state.products.filter(p => {
    const st = (p.status || "ok");
    const stock = Math.max(0, Number(p.stock || 0));

    // ✅ soon csak a Hamarosanban
    if(st === "soon") return state.active === "soon";
    if(state.active === "soon") return false;

    // ✅ kategória filter
    if(state.active !== "all"){
      return String(p.categoryId || "") === String(state.active);
    }
    return true;
  });

  // search (név+íz mindkét nyelven)
  if(q){
    list = list.filter(p => {
      const hay = norm([
        p.name_hu, p.name_en, p.flavor_hu, p.flavor_en, p.name, p.flavor
      ].filter(Boolean).join(" "));
      return hay.includes(q);
    });
  }

  // ✅ csoportosítás: azonos nevűek egymás mellett
  // kulcs: name_hu fallback name_en, így stabil
  const groupMap = new Map();
  for(const p of list){
    const key = norm(p.name_hu || p.name_en || p.name || "");
    if(!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(p);
  }

  const keys = [...groupMap.keys()].sort((a,b)=> a.localeCompare(b, "hu"));
  const out = [];
  for(const k of keys){
    const items = groupMap.get(k);
    items.sort((a,b) => norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), "hu"));
    out.push(...items);
  }

  return out;
}

function badgeInfo(p){
  const st = (p.status || "ok");
  const stock = Math.max(0, Number(p.stock || 0));
  if(st === "soon") return { txt: tr("soon"), cls: "soon" };
  if(st === "out" || stock <= 0) return { txt: "Elfogyott", cls: "out" };
  return { txt: "Elérhető", cls: "ok" };
}

function fmtPrice(p){
  const v = Number(p.price || 0);
  if(!Number.isFinite(v)) return "—";
  return v.toLocaleString(state.lang === "hu" ? "hu-HU" : "en-US") + " Ft";
}

function renderGrid(){
  const grid = $("#grid");
  const empty = $("#empty");
  grid.innerHTML = "";

  const list = filterList();
  $("#count").textContent = String(list.length);
  empty.style.display = list.length ? "none" : "block";

  for(const p of list){
    const st = (p.status || "ok");
    const stock = Math.max(0, Number(p.stock || 0));
    const sold = (st === "out" || stock <= 0);

    const card = document.createElement("div");
    card.className = "card fade-in" + (sold ? " dim" : "");

    const hero = document.createElement("div");
    hero.className = "hero";

    const img = document.createElement("img");
    img.src = p.image || "";
    img.alt = getName(p);
    img.loading = "lazy";
    img.onerror = () => { img.removeAttribute("src"); };
    hero.appendChild(img);

    const badges = document.createElement("div");
    badges.className = "badges";

    const b = badgeInfo(p);
    const badge = document.createElement("div");
    badge.className = "badge " + b.cls;
    badge.textContent = b.txt;
    badges.appendChild(badge);

    hero.appendChild(badges);

    // ✅ név+íz overlay a képen (1000×1000-re fix)
    const ov = document.createElement("div");
    ov.className = "overlay-title";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = getName(p);

    const flavor = document.createElement("div");
    flavor.className = "flavor";
    flavor.textContent = getFlavor(p) || "";

    ov.appendChild(name);
    ov.appendChild(flavor);
    hero.appendChild(ov);

    const body = document.createElement("div");
    body.className = "card-body";

    const meta = document.createElement("div");
    meta.className = "meta-row";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = fmtPrice(p);

    const stockEl = document.createElement("div");
    stockEl.className = "stock";
    if(st === "soon"){
      stockEl.innerHTML = `${tr("stock")}: <b>—</b>`;
    }else{
      stockEl.innerHTML = `${tr("stock")}: <b>${stock}</b> ${tr("pcs")}`;
    }

    meta.appendChild(price);
    meta.appendChild(stockEl);
    body.appendChild(meta);

    card.appendChild(hero);
    card.appendChild(body);

    grid.appendChild(card);
  }
}

async function init(){
  $("#langBtn").textContent = state.lang.toUpperCase();

  $("#langBtn").onclick = () => {
    state.lang = state.lang === "hu" ? "en" : "hu";
    localStorage.setItem("sv_lang", state.lang);
    $("#langBtn").textContent = state.lang.toUpperCase();
    renderNav();
    renderGrid();
  };

  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value || "";
    renderGrid();
  });

  $("#clear").onclick = () => {
    state.search = "";
    $("#search").value = "";
    renderGrid();
  };

  const res = await fetch("data/products.json", { cache: "no-store" });
  const data = await res.json();

  // kompatibilis: tömb vagy doc
  if(Array.isArray(data)){
    state.products = data;
    state.categories = [];
  }else{
    state.products = Array.isArray(data.products) ? data.products : [];
    state.categories = Array.isArray(data.categories) ? data.categories : [];
  }

  renderNav();
  renderGrid();
  hideLoader();
}

init().catch(err => {
  console.error(err);
  alert("Betöltési hiba: " + err.message);
});
