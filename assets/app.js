(() => {
  const $ = (s) => document.querySelector(s);

  const LS = {
    lang: "sv_lang",
    owner: "sv_gh_owner",
    repo: "sv_gh_repo",
    branch: "sv_gh_branch",
    useRaw: "sv_use_raw" // "1" = próbál RAW-ot a gyorsabb frissüléshez
  };

  const state = {
    lang: localStorage.getItem(LS.lang) || "hu",
    productsDoc: { categories: [], products: [] },
    activeCategory: "all",
    q: ""
  };

  const T = {
    hu: { all: "Összes termék", soon: "Hamarosan", stock: "Készlet", pcs: "db", out: "Elfogyott", soonBadge: "Hamarosan" },
    en: { all: "All products", soon: "Coming soon", stock: "Stock", pcs: "pcs", out: "Sold out", soonBadge: "Coming soon" }
  };

  function tr(k){ return (T[state.lang] && T[state.lang][k]) || k; }
  function norm(s){
    return (s||"").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }
  function getName(p){
    return state.lang === "en" ? (p.name_en || p.name_hu || "") : (p.name_hu || p.name_en || "");
  }
  function getFlavor(p){
    return state.lang === "en" ? (p.flavor_en || p.flavor_hu || "") : (p.flavor_hu || p.flavor_en || "");
  }

  function catLabel(c){
    return state.lang === "en" ? (c.label_en || c.label_hu || c.id) : (c.label_hu || c.label_en || c.id);
  }

  function catMap(){
    const m = new Map();
    for(const c of (state.productsDoc.categories || [])){
      if(!c || !c.id) continue;
      m.set(String(c.id), c);
    }
    return m;
  }

  function resolvePrice(p, cmap){
    const pv = Number(p.price);
    if(Number.isFinite(pv) && pv > 0) return pv;
    const c = cmap.get(String(p.categoryId||""));
    const cv = c ? Number(c.basePrice) : 0;
    return Number.isFinite(cv) ? cv : 0;
  }

  // --- Data loading with cache bust, optional RAW fallback (gyorsabb frissülés)
  async function fetchJSON(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function rawUrl(){
    const owner = (localStorage.getItem(LS.owner) || "").trim();
    const repo = (localStorage.getItem(LS.repo) || "").trim();
    const branch = (localStorage.getItem(LS.branch) || "main").trim() || "main";
    if(!owner || !repo) return null;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/data/products.json`;
  }

  async function load(){
    const v = Date.now();
    const useRaw = (localStorage.getItem(LS.useRaw) === "1");
    const r = useRaw ? rawUrl() : null;

    try{
      if(r){
        state.productsDoc = await fetchJSON(`${r}?v=${v}`);
      }else{
        state.productsDoc = await fetchJSON(`data/products.json?v=${v}`);
      }
    }catch(e){
      // fallback: ha RAW elhasal, próbáljuk a site-os json-t
      try{
        state.productsDoc = await fetchJSON(`data/products.json?v=${v}`);
      }catch(e2){
        alert("Betöltés hiba: Nem tudtam betölteni products.json.");
        console.error(e, e2);
        return;
      }
    }

    // kompatibilitás: ha array volt régi formátum
    if(Array.isArray(state.productsDoc)){
      state.productsDoc = { categories: [], products: state.productsDoc };
    }
    if(!state.productsDoc.categories) state.productsDoc.categories = [];
    if(!state.productsDoc.products) state.productsDoc.products = [];

    renderSidebar();
    renderGrid();
  }

  function orderedCategories(){
    // all first, soon last
    const cats = (state.productsDoc.categories || [])
      .filter(c => c && c.id)
      .map(c => ({...c, id:String(c.id)}));

    cats.sort((a,b)=> catLabel(a).localeCompare(catLabel(b), state.lang === "hu" ? "hu" : "en"));

    return [
      { id:"all", virtual:true },
      ...cats,
      { id:"soon", virtual:true }
    ];
  }

  function renderSidebar(){
    const nav = document.querySelector(".nav");
    if(!nav) return;

    nav.innerHTML = "";
    const cats = orderedCategories();

    for(const c of cats){
      const btn = document.createElement("button");
      btn.className = (state.activeCategory === c.id) ? "active" : "";
      btn.textContent = (c.id==="all") ? tr("all") : (c.id==="soon" ? tr("soon") : catLabel(c));
      btn.onclick = () => {
        state.activeCategory = c.id;
        renderSidebar();
        renderGrid();
      };
      nav.appendChild(btn);
    }
  }

  function filteredProducts(){
    const q = norm(state.q);
    const list = (state.productsDoc.products || []).filter(p => p && p.id);

    // soon csak a "soon" tabban
    const visible = list.filter(p => {
      const st = (p.status || "ok");
      if(st === "soon") return state.activeCategory === "soon";
      if(state.activeCategory === "soon") return false;

      if(state.activeCategory === "all") return true;
      return String(p.categoryId||"") === String(state.activeCategory);
    });

    const searched = q ? visible.filter(p => {
      const n = norm(getName(p));
      const f = norm(getFlavor(p));
      return n.includes(q) || f.includes(q);
    }) : visible;

    // group same name together + sold out last
    const groups = new Map();
    for(const p of searched){
      const key = norm(getName(p));
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    const groupArr = [];
    for(const [key, items] of groups.entries()){
      // item rank: out last
      items.sort((a,b)=>{
        const ra = isOut(a) ? 1 : 0;
        const rb = isOut(b) ? 1 : 0;
        if(ra !== rb) return ra - rb;
        return norm(getFlavor(a)).localeCompare(norm(getFlavor(b)), "hu");
      });

      // group rank: ha van legalább 1 nem-out, akkor előre
      const grpRank = items.some(x => !isOut(x)) ? 0 : 1;
      const displayName = getName(items[0]) || key;
      groupArr.push({ key, items, grpRank, displayName });
    }

    groupArr.sort((a,b)=>{
      if(a.grpRank !== b.grpRank) return a.grpRank - b.grpRank;
      return norm(a.displayName).localeCompare(norm(b.displayName), "hu");
    });

    const out = [];
    for(const g of groupArr) out.push(...g.items);
    return out;
  }

  function isOut(p){
    const st = (p.status || "ok");
    const stock = Number(p.stock || 0);
    return (st === "out") || (Number.isFinite(stock) && stock <= 0);
  }

  function renderGrid(){
    const grid = document.querySelector(".grid");
    if(!grid) return;

    grid.innerHTML = "";
    const cmap = catMap();
    const list = filteredProducts();

    for(const p of list){
      const name = getName(p);
      const flavor = getFlavor(p);
      const stock = Math.max(0, Number(p.stock || 0));
      const st = (p.status || "ok");
      const price = resolvePrice(p, cmap);

      const card = document.createElement("div");
      card.className = "card fade-in" + (isOut(p) ? " dim" : "");

      // hero (1:1)
      const hero = document.createElement("div");
      hero.className = "hero";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = `${name}${flavor ? " - " + flavor : ""}`;
      img.src = p.image || "";
      hero.appendChild(img);

      const badges = document.createElement("div");
      badges.className = "badges";

      if(st === "soon"){
        const b = document.createElement("div");
        b.className = "badge soon";
        b.textContent = tr("soonBadge");
        badges.appendChild(b);
      }else if(isOut(p)){
        const b = document.createElement("div");
        b.className = "badge out";
        b.textContent = tr("out");
        badges.appendChild(b);
      }
      hero.appendChild(badges);

      // overlay title (név+íz a képen)
      const overlay = document.createElement("div");
      overlay.className = "overlay-title";
      overlay.innerHTML = `
        <div class="name"></div>
        <div class="flavor"></div>
      `;
      overlay.querySelector(".name").textContent = name || "";
      overlay.querySelector(".flavor").textContent = flavor || "";
      hero.appendChild(overlay);

      // body: csak ár + készlet (AHOGY KÉRTED)
      const body = document.createElement("div");
      body.className = "card-body";
      const meta = document.createElement("div");
      meta.className = "meta-row";

      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = (price || 0).toLocaleString("hu-HU") + " Ft";

      const stockEl = document.createElement("div");
      stockEl.className = "stock";
      stockEl.innerHTML = `${tr("stock")}: <b>${st==="soon" ? "—" : stock}</b> ${st==="soon" ? "" : tr("pcs")}`;

      meta.appendChild(priceEl);
      meta.appendChild(stockEl);
      body.appendChild(meta);

      card.appendChild(hero);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  // kereső input (ha van)
  function bindSearch(){
    const inp = document.querySelector('input[type="search"], #search, .search');
    if(!inp) return;
    inp.addEventListener("input", (e)=>{
      state.q = e.target.value || "";
      renderGrid();
    });
  }

  // nyelv váltó (ha van)
  function bindLang(){
    const btn = document.querySelector("#langToggle");
    if(!btn) return;
    btn.addEventListener("click", ()=>{
      state.lang = (state.lang === "hu") ? "en" : "hu";
      localStorage.setItem(LS.lang, state.lang);
      renderSidebar();
      renderGrid();
    });
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    bindSearch();
    bindLang();
    load();
  });
})();
