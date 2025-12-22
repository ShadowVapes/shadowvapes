const state = {
  products: [],
  filter: "all",
  q: ""
};

function $(sel){ return document.querySelector(sel); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function normalizeCat(cat){
  return (cat || "").toLowerCase().trim();
}

async function loadProducts(){
  const res = await fetch("data/products.json", { cache: "no-store" });
  if(!res.ok) throw new Error("Nem tudtam betölteni a products.json-t.");
  state.products = await res.json();
}

function categories(){
  const cats = new Map();
  for(const p of state.products){
    const c = normalizeCat(p.category);
    cats.set(c, (cats.get(c)||0) + 1);
  }
  return cats;
}

function applyFilters(list){
  let out = list.slice();

  if(state.filter !== "all"){
    out = out.filter(p => normalizeCat(p.category) === state.filter);
  }
  if(state.q){
    const q = state.q.toLowerCase().trim();
    out = out.filter(p =>
      (p.name||"").toLowerCase().includes(q) ||
      (p.desc||"").toLowerCase().includes(q)
    );
  }
  return out;
}

function qtyClass(qty){
  if(qty <= 0) return "zero";
  if(qty <= 2) return "low";
  return "";
}

function renderNav(){
  const nav = $("#nav");
  if(!nav) return;

  const cats = categories();

  const btnAll = document.createElement("button");
  btnAll.className = state.filter === "all" ? "active" : "";
  btnAll.innerHTML = `<span>Összes termék</span><span class="badge">${state.products.length}</span>`;
  btnAll.onclick = () => { state.filter="all"; render(); };
  nav.appendChild(btnAll);

  const wanted = [
    { key: "gamer eger", label: "Gamer egér" },
    { key: "gamer billentyuzet", label: "Gamer billentyűzet" }
  ];

  for(const w of wanted){
    const count = cats.get(w.key) || 0;
    const b = document.createElement("button");
    b.className = state.filter === w.key ? "active" : "";
    b.innerHTML = `<span>${w.label}</span><span class="badge">${count}</span>`;
    b.onclick = () => { state.filter = w.key; render(); };
    nav.appendChild(b);
  }
}

function renderGrid(){
  const grid = $("#grid");
  if(!grid) return;

  grid.innerHTML = "";
  const filtered = applyFilters(state.products);

  if(filtered.length === 0){
    grid.innerHTML = `<div class="panel" style="grid-column:1/-1">
      <h2>Nincs találat</h2>
      <div style="color:var(--muted);font-size:13px">Próbáld más szűrővel vagy kereséssel.</div>
    </div>`;
    return;
  }

  filtered.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.animationDelay = `${Math.min(i*40, 280)}ms`;

    const img = p.img ? `style="background-image:url('${escapeHtml(p.img)}')"` : "";
    const q = Number(p.qty ?? 0);

    card.innerHTML = `
      <div class="cardImg" ${img}></div>
      <div class="cardBody">
        <h3 class="cardTitle">${escapeHtml(p.name || "Névtelen termék")}</h3>
        <p class="cardDesc">${escapeHtml(p.desc || "")}</p>
        <div class="row">
          <div class="pill">${escapeHtml(p.category || "egyéb")}</div>
          <div class="pill">
            Készlet: <span class="qty ${qtyClass(q)}">${q}</span>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function render(){
  const nav = $("#nav");
  if(nav) nav.innerHTML = "";
  renderNav();
  renderGrid();
}

function hideLoader(){
  const l = $("#loader");
  if(!l) return;
  setTimeout(() => l.classList.add("hide"), 350);
}

async function boot(){
  // loader text
  const lt = $("#loaderText");
  if(lt) lt.textContent = "Betöltöm a termékeket…";

  try{
    await loadProducts();
    render();

    const search = $("#searchInput");
    if(search){
      search.addEventListener("input", (e) => {
        state.q = e.target.value;
        renderGrid();
      });
    }
  }catch(err){
    const grid = $("#grid");
    if(grid){
      grid.innerHTML = `<div class="panel"><h2>Hiba</h2><div style="color:var(--muted)">${escapeHtml(err.message)}</div></div>`;
    }
  }finally{
    hideLoader();
  }
}

document.addEventListener("DOMContentLoaded", boot);

/* ---------------- ADMIN ---------------- */

function adminGuard(){
  const adminWrap = $("#admin");
  if(!adminWrap) return false;

  // nagyon basic védelem: prompt (nem banki security)
  const ok = sessionStorage.getItem("admin_ok");
  if(ok === "1") return true;

  const pass = prompt("Admin jelszó:");
  // Itt állítsd át magadnak:
  const REAL = "tESO123";

  if(pass === REAL){
    sessionStorage.setItem("admin_ok", "1");
    return true;
  }
  adminWrap.innerHTML = `<div class="panel">
    <h2>Hozzáférés megtagadva</h2>
    <div style="color:var(--muted);font-size:13px">
      Rossz jelszó. Frissíts rá és próbáld újra.
    </div>
  </div>`;
  return false;
}

async function adminLoad(){
  await loadProducts();
  renderAdminTable();
  fillCategorySelect();
}

function fillCategorySelect(){
  const sel = $("#a_category");
  if(!sel) return;
  sel.innerHTML = `
    <option value="gamer eger">gamer egér</option>
    <option value="gamer billentyuzet">gamer billentyűzet</option>
    <option value="egyeb">egyéb</option>
  `;
}

function renderAdminTable(){
  const tbody = $("#a_tbody");
  if(!tbody) return;
  tbody.innerHTML = "";

  state.products.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(p.id||"")}</td>
      <td>${escapeHtml(p.name||"")}</td>
      <td>${escapeHtml(p.category||"")}</td>
      <td><input data-id="${escapeHtml(p.id)}" class="qtyInput" type="number" value="${Number(p.qty??0)}" style="width:90px"></td>
      <td>
        <button class="btn" data-edit="${escapeHtml(p.id)}">Szerkeszt</button>
        <button class="btn danger" data-del="${escapeHtml(p.id)}">Töröl</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".qtyInput").forEach(inp => {
    inp.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const val = Number(e.target.value);
      const p = state.products.find(x => x.id === id);
      if(p) p.qty = Number.isFinite(val) ? val : 0;
    });
  });

  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const p = state.products.find(x => x.id === id);
      if(!p) return;
      $("#a_id").value = p.id || "";
      $("#a_name").value = p.name || "";
      $("#a_img").value = p.img || "";
      $("#a_desc").value = p.desc || "";
      $("#a_category").value = normalizeCat(p.category) || "egyeb";
      $("#a_qty").value = Number(p.qty ?? 0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  tbody.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      const p = state.products.find(x => x.id === id);
      if(!p) return;
      if(confirm(`Törlöd ezt? ${p.name}`)){
        state.products = state.products.filter(x => x.id !== id);
        renderAdminTable();
      }
    });
  });
}

function upsertProductFromForm(){
  const idField = $("#a_id");
  const id = (idField.value || "").trim() || ("p" + Math.random().toString(16).slice(2,8));

  const prod = {
    id,
    name: ($("#a_name").value || "").trim(),
    category: ($("#a_category").value || "").trim(),
    qty: Number($("#a_qty").value || 0),
    desc: ($("#a_desc").value || "").trim(),
    img: ($("#a_img").value || "").trim()
  };

  const idx = state.products.findIndex(x => x.id === id);
  if(idx >= 0) state.products[idx] = prod;
  else state.products.unshift(prod);

  idField.value = prod.id;
  renderAdminTable();
}

function exportJson(){
  const blob = new Blob([JSON.stringify(state.products, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "products.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireAdmin(){
  const saveBtn = $("#a_save");
  const exportBtn = $("#a_export");
  const clearBtn = $("#a_clear");

  if(saveBtn) saveBtn.addEventListener("click", () => upsertProductFromForm());
  if(exportBtn) exportBtn.addEventListener("click", () => exportJson());
  if(clearBtn) clearBtn.addEventListener("click", () => {
    $("#a_id").value = "";
    $("#a_name").value = "";
    $("#a_img").value = "";
    $("#a_desc").value = "";
    $("#a_qty").value = "0";
    $("#a_category").value = "gamer eger";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if($("#admin")){
    if(!adminGuard()) return;
    await adminLoad();
    wireAdmin();
    hideLoader();
  }
});
