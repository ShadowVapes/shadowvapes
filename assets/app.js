const state = {
  data: null,
  lang: localStorage.getItem("sv_lang") || null,
  activeCategory: "Összes termék"
};

function qs(sel){ return document.querySelector(sel); }
function el(tag, cls){ const e=document.createElement(tag); if(cls) e.className=cls; return e; }

function showLoader(text="Betöltés..."){
  qs("#loader").style.display="flex";
  qs("#loader .loader-sub").textContent = text;
}
function hideLoader(){
  const l = qs("#loader");
  l.style.opacity = "0";
  setTimeout(()=>{ l.style.display="none"; l.style.opacity="1"; }, 220);
}

async function loadData(){
  // Live from repo raw (fast) -> if fails, fallback to local file
  const owner = localStorage.getItem("gh_owner");
  const repo  = localStorage.getItem("gh_repo");
  const branch= localStorage.getItem("gh_branch") || "main";

  const urls = [];
  if(owner && repo){
    urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/data/products.json?ts=${Date.now()}`);
  }
  urls.push(`data/products.json?ts=${Date.now()}`);

  for(const u of urls){
    try{
      const r = await fetch(u, { cache:"no-store" });
      if(!r.ok) continue;
      return await r.json();
    }catch{}
  }
  throw new Error("Nem tudtam betölteni a products.json-t.");
}

function ensureLangModal(){
  const backdrop = qs("#langModal");
  if(state.lang) return;

  backdrop.style.display="flex";
  const setLang = (l)=>{
    state.lang = l;
    localStorage.setItem("sv_lang", l);
    backdrop.style.display="none";
    render();
  };

  qs("#btnHu").onclick = ()=> setLang("hu");
  qs("#btnEn").onclick = ()=> setLang("en");
}

function setBrandName(name){
  qs("#brandName").textContent = name || "ShadowVapes";
  qs("#loaderBrand").textContent = name || "ShadowVapes";
}

function buildSidebar(categories){
  const nav = document.getElementById("nav");
  nav.innerHTML = "";

  const fixedTop = ["Összes termék"];
  const fixedBottom = ["Hamarosan"];

  const middle = categories.filter(
    c => !fixedTop.includes(c) && !fixedBottom.includes(c)
  );

  const finalCats = [...fixedTop, ...middle, ...fixedBottom];

  finalCats.forEach(cat=>{
    const b = document.createElement("button");
    b.textContent = cat;
    if(state.activeCategory === cat) b.classList.add("active");
    b.onclick = ()=>{
      state.activeCategory = cat;
      render();
    };
    nav.appendChild(b);
  });
}


function formatMoney(v){
  if(v == null || v === "") return "—";
  const n = Number(v);
  if(Number.isNaN(n)) return String(v);
  return `${n.toLocaleString("hu-HU")} Ft`;
}

function getLocalized(prod, keyBase){
  // keyBase: name / flavor
  if(state.lang === "en") return prod[`${keyBase}En`] || prod[`${keyBase}Hu`] || "";
  return prod[`${keyBase}Hu`] || prod[`${keyBase}En`] || "";
}

function productCard(p){
  const card = el("div", "card fade-in" + (p.status==="out" ? " dim" : ""));
  const hero = el("div", "hero");

  const img = el("img");
  img.src = p.image || "https://images.unsplash.com/photo-1523978591478-c753949ff840?auto=format&fit=crop&w=1200&q=60";
  img.alt = getLocalized(p,"name");
  hero.appendChild(img);

  const badges = el("div","badges");
  if(p.status==="out"){
    const bd = el("div","badge out");
    bd.textContent = "Elfogyott";
    badges.appendChild(bd);
  }
  if(p.status==="soon"){
    const bd = el("div","badge soon");
    bd.textContent = "Hamarosan";
    badges.appendChild(bd);
  }
  hero.appendChild(badges);

  const overlay = el("div","overlay-title");
  const name = el("div","name"); name.textContent = getLocalized(p,"name");
  const flavor = el("div","flavor"); flavor.textContent = getLocalized(p,"flavor");
  overlay.appendChild(name);
  if(getLocalized(p,"flavor")) overlay.appendChild(flavor);
  hero.appendChild(overlay);

  const body = el("div","card-body");
  const row = el("div","meta-row");
  const price = el("div","price"); price.textContent = formatMoney(p.price);
  const stock = el("div","stock");
  const stockNum = Number(p.stock || 0);
  stock.innerHTML = `Készlet: <b>${stockNum}</b> db`;
  row.appendChild(price);
  row.appendChild(stock);

  body.appendChild(row);

  card.appendChild(hero);
  card.appendChild(body);
  return card;
}

function render(){
  setBrandName(state.data?.shopName || "ShadowVapes");
  buildSidebar(state.data?.categories || []);
  ensureLangModal();

  const title = qs("#pageTitle");
  title.textContent = state.activeCategory;

  const grid = qs("#grid");
  grid.innerHTML = "";

  const products = (state.data?.products || []).slice();

  // Filtering rules:
  // - Összes termék: show ONLY status !== "soon"
  // - Hamarosan: show ONLY status === "soon"
  // - Category: show matching category, exclude soon unless category is Hamarosan
  let list = [];
  if(state.activeCategory === "Összes termék"){
    list = products.filter(p=> p.status !== "soon");
  } else if(state.activeCategory === "Hamarosan"){
    list = products.filter(p=> p.status === "soon");
  } else {
    list = products.filter(p=> (p.category === state.activeCategory) && p.status !== "soon");
  }

  // Sorting: in-stock first, out last
 list.sort((a,b)=>{
  const nameA = (getLocalized(a,"name") || "").toLowerCase();
  const nameB = (getLocalized(b,"name") || "").toLowerCase();

  if(nameA !== nameB) return nameA.localeCompare(nameB);

  const sa = a.status === "out" ? 1 : 0;
  const sb = b.status === "out" ? 1 : 0;
  return sa - sb;
});


  if(list.length === 0){
    const empty = el("div","panel fade-in");
    empty.innerHTML = `<div class="small-muted">Nincs mit mutatni itt még 👀</div>`;
    grid.appendChild(empty);
    return;
  }

  list.forEach(p=> grid.appendChild(productCard(p)));
}

function bindLangSwitcher(){
  qs("#langSwitch").onclick = ()=>{
    state.lang = (state.lang === "en") ? "hu" : "en";
    localStorage.setItem("sv_lang", state.lang);
    render();
  };
}

async function main(){
  showLoader("Adatok töltése...");
  bindLangSwitcher();
  state.data = await loadData();
  hideLoader();
  render();
}

main().catch(err=>{
  console.error(err);
  showLoader("Hiba: " + err.message);
});
