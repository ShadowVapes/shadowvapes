import { DATA_PATH } from "./config.js";

const grid = document.getElementById("grid");
const catNav = document.getElementById("catNav");
const infoLine = document.getElementById("infoLine");

let state = null;
let activeCategory = "Összes termék";

function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function loadData(){
  // cache-bust, hogy ne ragadjon be a GitHub Pages cache
  const url = `./${DATA_PATH}?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`Nem tudtam betölteni: ${res.status}`);
  return await res.json();
}

function renderCategories(){
  catNav.innerHTML = "";
  const cats = state.categories || ["Összes termék"];
  const unique = Array.from(new Set(cats));
  unique.forEach(cat => {
    const btn = document.createElement("button");
    btn.textContent = cat;
    btn.className = (cat === activeCategory) ? "active" : "";
    btn.onclick = () => {
      activeCategory = cat;
      renderCategories();
      renderProducts();
    };
    catNav.appendChild(btn);
  });
}

function renderProducts(){
  const products = state.products || [];
  const filtered = activeCategory === "Összes termék"
    ? products
    : products.filter(p => p.category === activeCategory);

  infoLine.textContent = `${filtered.length} termék (${activeCategory})`;

  grid.innerHTML = filtered.map(p => {
    const sold = !!p.soldOut || (Number(p.quantity) <= 0);
    return `
      <article class="card ${sold ? "soldout":""}">
        <img src="${escapeHtml(p.image || "")}" alt="${escapeHtml(p.name || "")}">
        <div class="pad">
          <h3>${escapeHtml(p.name || "")}</h3>
          <p>${escapeHtml(p.description || "")}</p>
          <div class="badges">
            <span class="badge">${escapeHtml(p.category || "—")}</span>
            <span class="badge">${sold ? "Elfogyott" : `Készlet: ${Number(p.quantity)||0}`}</span>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

(async function init(){
  try{
    state = await loadData();
    // biztos legyen benne az Összes termék
    if(!state.categories?.includes("Összes termék")){
      state.categories = ["Összes termék", ...(state.categories||[])];
    }
    renderCategories();
    renderProducts();
  }catch(err){
    infoLine.textContent = "Hiba a betöltésnél.";
    grid.innerHTML = `<div class="panel">Hiba: ${escapeHtml(String(err.message || err))}</div>`;
  }
})();
