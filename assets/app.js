const $ = (sel) => document.querySelector(sel);

const state = {
  lang: localStorage.getItem("sv_lang") || "hu",
  products: [],
  categories: [],
  activeCategory: "all",
  search: ""
};

const T = {
  hu: {
    brandSub: "Prémium katalógus",
    title: "Termékek",
    subtitle: "Válassz kategóriát, és válogass.",
    searchPh: "Keresés...",
    all: "Összes termék",
    soon: "Hamarosan",
    stock: "Készlet",
    pcs: "db",
    sold: "Elfogyott",
    coming: "Hamarosan",
    ok: "Elérhető",
    emptyTitle: "Nincs találat",
    emptySub: "Próbáld más kulcsszóval vagy kategóriával."
  },
  en: {
    brandSub: "Premium catalog",
    title: "Products",
    subtitle: "Pick a category and browse.",
    searchPh: "Search...",
    all: "All products",
    soon: "Coming soon",
    stock: "Stock",
    pcs: "pcs",
    sold: "Sold out",
    coming: "Coming soon",
    ok: "Available",
    emptyTitle: "No results",
    emptySub: "Try a different keyword or category."
  }
};

function tr(key){ return (T[state.lang] && T[state.lang][key]) || key; }

function normalize(s){
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
function getCategoryLabel(cat){
  if(!cat) return "";
  return state.lang === "en"
    ? (cat.label_en || cat.label_hu || cat.id)
    : (cat.label_hu || cat.label_en || cat.id);
}

async function load(){
  $("#year").textContent = new Date().getFullYear();

  // UI text
  $("#brandSub").textContent = tr("brandSub");
  $("#title").textContent = tr("title");
  $("#subtitle").textContent = tr("subtitle");
  $("#search").placeholder = tr("searchPh");
  $("#emptyTitle").textContent = tr("emptyTitle");
  $("#emptySub").textContent = tr("emptySub");
  $("#langLabel").textContent = state.lang.toUpperCase();

  const productsRes = await fetch("data/products.json", { cache: "no-store" });
  const productsData = await productsRes.json();

  state.products = Array.isArray(productsData.products)
    ? productsData.products
    : (Array.isArray(productsData) ? productsData : []);

  state.categories = Array.isArray(productsData.categories) ? productsData.categories : [];

  // Fallback categories if none
  if(state.categories.length === 0){
    const seen = new Map();
    for(const p of state.products){
      if(p.categoryId && !seen.has(p.categoryId)){
        seen.set(p.categoryId, { id: String(p.categoryId), label_hu: String(p.categoryId), label_en: String(p.categoryId) });
      }
    }
    state.categories = [...seen.values()];
  }

  // sanitize categories
  state.categories = state.categories
    .filter(c => c && c.id && c.id !== "all")
    .map(c => ({ id: String(c.id), label_hu: c.label_hu || c.id, label_en: c.label_en || c.label_hu || c.id }));

  renderTabs();
  render();
  bind();
}

function bind(){
  $("#langToggle").onclick = () => {
    state.lang = state.lang === "hu" ? "en" : "hu";
    localStorage.setItem("sv_lang", state.lang);

    $("#langLabel").textContent = state.lang.toUpperCase();
    $("#brandSub").textContent = tr("brandSub");
    $("#title").textContent = tr("title");
    $("#subtitle").textContent = tr("subtitle");
    $("#search").placeholder = tr("searchPh");
    $("#emptyTitle").textContent = tr("emptyTitle");
    $("#emptySub").textContent = tr("emptySub");

    renderTabs();
    render();
  };

  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value || "";
    render();
  });

  $("#clearSearch").onclick = () => {
    state.search = "";
    $("#search").value = "";
    render();
  };
}

function orderedCategories(){
  // "Összes termék" first (virtual), "Hamarosan" last (virtual)
  const cats = [...state.categories].filter(c => c.id !== "soon");
  cats.sort((a,b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b), state.lang === "hu" ? "hu" : "en"));
  return [
    { id: "all", virtual: true },
    ...cats,
    { id: "soon", virtual: true }
  ];
}

function renderTabs(){
  const el = $("#categoryTabs");
  el.innerHTML = "";

  const cats = orderedCategories();
  for(const c of cats){
    const btn = document.createElement("button");
    btn.className = "tab" + (state.activeCategory === c.id ? " active" : "");
    btn.textContent = c.id === "all" ? tr("all") : (c.id === "soon" ? tr("soon") : getCategoryLabel(c));
    btn.onclick = () => {
      state.activeCategory = c.id;
      renderTabs();
      render();
    };
    el.appendChild(btn);
  }
}

function groupProducts(list){
  // Group by name so same names are next to each other
  const map = new Map();
  for(const p of list){
    const key = normalize(getName(p));
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }

  const locale = state.lang === "hu" ? "hu" : "en";
  const keys = [...map.keys()].sort((a,b) => a.localeCompare(b, locale));

  const out = [];
  for(const k of keys){
    const items = map.get(k);
    items.sort((a,b) => normalize(getFlavor(a)).localeCompare(normalize(getFlavor(b)), locale));
    out.push(...items);
  }
  return out;
}

function filterProducts(){
  const q = normalize(state.search);

  let list = state.products.filter(p => {
    const st = p.status || "ok";

    if(st === "soon"){
      return state.activeCategory === "soon";
    }
    if(state.activeCategory === "soon") return false;

    if(state.activeCategory !== "all"){
      return String(p.categoryId || "") === String(state.activeCategory);
    }
    return true;
  });

  if(q){
    list = list.filter(p => {
      const n = normalize(getName(p));
      const f = normalize(getFlavor(p));
      return n.includes(q) || f.includes(q);
    });
  }

  // ok first, out after (still visible)
  list.sort((a,b) => {
    const rank = (s) => (s === "ok" ? 0 : (s === "out" ? 1 : 2));
    return rank(a.status || "ok") - rank(b.status || "ok");
  });

  return groupProducts(list);
}

function fmtPrice(p){
  const v = Number(p.price || 0);
  if(!Number.isFinite(v)) return "—";
  return v.toLocaleString(state.lang === "hu" ? "hu-HU" : "en-US") + " Ft";
}

function statusBadge(p){
  const st = p.status || "ok";
  if(st === "soon") return { text: tr("coming"), cls: "warn" };
  const stock = Number(p.stock || 0);
  if(st === "out" || stock <= 0) return { text: tr("sold"), cls: "bad" };
  return { text: tr("ok"), cls: "good" };
}

function render(){
  const grid = $("#grid");
  const empty = $("#emptyState");

  const list = filterProducts();
  $("#countPill").textContent = `${list.length} ${tr("pcs")}`;

  grid.innerHTML = "";
  empty.hidden = list.length !== 0;

  for(const p of list){
    const name = getName(p);
    const flavor = getFlavor(p);
    const stock = Math.max(0, Number(p.stock || 0));
    const st = p.status || "ok";

    const card = document.createElement("div");
    card.className = "card" + ((st === "out" || stock <= 0) ? " sold" : "") + (st === "soon" ? " soon" : "");

    const imgwrap = document.createElement("div");
    imgwrap.className = "imgwrap";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = `${name}${flavor ? " - " + flavor : ""}`;
    img.src = p.image || "";
    img.onerror = () => { img.src = ""; imgwrap.style.background = "rgba(255,255,255,.05)"; };
    imgwrap.appendChild(img);

    const b = statusBadge(p);
    const badge = document.createElement("div");
    badge.className = `badge ${b.cls}`;
    badge.textContent = b.text;
    imgwrap.appendChild(badge);

    // Overlay text (name + flavor + price + stock) on the image
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const pname = document.createElement("div");
    pname.className = "pname";
    pname.textContent = name || "";

    const pflavor = document.createElement("div");
    pflavor.className = "pflavor";
    pflavor.textContent = flavor || "";

    const meta = document.createElement("div");
    meta.className = "ometa";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = fmtPrice(p);

    const stockEl = document.createElement("div");
    stockEl.className = "stock";
    if(st === "soon"){
      stockEl.textContent = "—";
    }else{
      stockEl.textContent = `${tr("stock")}: ${stock} ${tr("pcs")}`;
    }

    meta.appendChild(price);
    meta.appendChild(stockEl);

    overlay.appendChild(pname);
    overlay.appendChild(pflavor);
    overlay.appendChild(meta);

    imgwrap.appendChild(overlay);

    card.appendChild(imgwrap);
    grid.appendChild(card);
  }
}

load().catch(err => {
  console.error(err);
  alert("Hiba a betöltésnél: " + err.message);
});
