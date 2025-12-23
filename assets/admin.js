const $ = (sel) => document.querySelector(sel);

const LS = {
  owner: "sv_gh_owner",
  repo: "sv_gh_repo",
  branch: "sv_gh_branch",
  token: "sv_gh_token",
};

const state = {
  productsDoc: { categories: [], products: [] },
  sales: [],
  loaded: false,
};

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function openModal(title, bodyEl, footButtons){
  $("#modalTitle").textContent = title;
  const body = $("#modalBody");
  const foot = $("#modalFoot");
  body.innerHTML = "";
  foot.innerHTML = "";
  body.appendChild(bodyEl);

  for(const b of footButtons){
    const btn = document.createElement("button");
    btn.className = "btn " + (b.primary ? "primary" : (b.danger ? "danger" : ""));
    btn.textContent = b.label;
    btn.onclick = b.onClick;
    foot.appendChild(btn);
  }

  $("#modal").hidden = false;
}

function closeModal(){
  $("#modal").hidden = true;
}

function ghCfg(){
  const owner = $("#ghOwner").value.trim();
  const repo = $("#ghRepo").value.trim();
  const branch = ($("#ghBranch").value.trim() || "main");
  const token = $("#ghToken").value.trim();
  return { owner, repo, branch, token };
}

function persistCfg(){
  const { owner, repo, branch, token } = ghCfg();
  localStorage.setItem(LS.owner, owner);
  localStorage.setItem(LS.repo, repo);
  localStorage.setItem(LS.branch, branch);
  localStorage.setItem(LS.token, token);
}

function loadCfg(){
  $("#ghOwner").value = localStorage.getItem(LS.owner) || "";
  $("#ghRepo").value = localStorage.getItem(LS.repo) || "";
  $("#ghBranch").value = localStorage.getItem(LS.branch) || "main";
  $("#ghToken").value = localStorage.getItem(LS.token) || "";
}

function ensureBaseDocs(){
  if(!Array.isArray(state.productsDoc.categories)) state.productsDoc.categories = [];
  if(!Array.isArray(state.productsDoc.products)) state.productsDoc.products = [];
  if(!Array.isArray(state.sales)) state.sales = [];
}

function uniqueId(prefix){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/* ---------- Load/Save ---------- */
async function loadData(){
  persistCfg();
  const { owner, repo, branch, token } = ghCfg();

  // Load from repo if configured, else from local fetch
  try{
    if(token && owner && repo){
      const p = await ShadowGH.getFile({ token, owner, repo, branch, path: "data/products.json" });
      const s = await ShadowGH.getFile({ token, owner, repo, branch, path: "data/sales.json" });
      state.productsDoc = JSON.parse(p.content);
      state.sales = JSON.parse(s.content);
    }else{
      const pr = await fetch("data/products.json", { cache: "no-store" });
      const sr = await fetch("data/sales.json", { cache: "no-store" });
      state.productsDoc = await pr.json();
      state.sales = await sr.json();
    }

    if(Array.isArray(state.productsDoc)) {
      // fallback if old format is array
      state.productsDoc = { categories: [], products: state.productsDoc };
    }
    if(!Array.isArray(state.sales)) state.sales = [];

    ensureBaseDocs();
    state.loaded = true;

    // sanitize categories
    state.productsDoc.categories = state.productsDoc.categories
      .filter(c => c && c.id && c.id !== "all")
      .map(c => ({
        id: String(c.id),
        label_hu: c.label_hu || c.id,
        label_en: c.label_en || c.label_hu || c.id
      }));

    toast("Betöltve ✅");
    renderAll();
  }catch(e){
    console.error(e);
    toast("Betöltés hiba: " + e.message);
  }
}

async function saveData(){
  if(!state.loaded){
    toast("Előbb tölts be adatot 🙃");
    return;
  }
  persistCfg();
  const { owner, repo, branch, token } = ghCfg();

  // Always keep structure stable
  ensureBaseDocs();

  // Normalize stock/status
  for(const p of state.productsDoc.products){
    p.status = (p.status === "soon" || p.status === "out" || p.status === "ok") ? p.status : "ok";
    p.stock = Math.max(0, Number(p.stock || 0));
    p.price = Number(p.price || 0);
    p.categoryId = String(p.categoryId || "");
  }

  try{
    const productsText = JSON.stringify(state.productsDoc, null, 2);
    const salesText = JSON.stringify(state.sales, null, 2);

    if(token && owner && repo){
      // Need sha for update
      const pOld = await ShadowGH.getFile({ token, owner, repo, branch, path: "data/products.json" });
      const sOld = await ShadowGH.getFile({ token, owner, repo, branch, path: "data/sales.json" });

      await ShadowGH.putFile({
        token, owner, repo, branch,
        path: "data/products.json",
        message: "Update products.json",
        content: productsText,
        sha: pOld.sha
      });
      await ShadowGH.putFile({
        token, owner, repo, branch,
        path: "data/sales.json",
        message: "Update sales.json",
        content: salesText,
        sha: sOld.sha
      });

      toast("Mentve GitHub-ra ✅");
    }else{
      // Fallback: download files
      downloadFile("products.json", productsText);
      downloadFile("sales.json", salesText);
      toast("Nincs GH config — letöltés mentésnek ✅");
    }
  }catch(e){
    console.error(e);
    toast("Mentés hiba: " + e.message);
  }
}

function downloadFile(name, content){
  const blob = new Blob([content], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

/* ---------- Render ---------- */
function renderAll(){
  renderCategories();
  renderProducts();
  renderSales();
  renderRevenue();
}

function catLabel(c){
  return `${c.label_hu || c.id} / ${c.label_en || c.label_hu || c.id}`;
}

function orderedCategories(){
  // “Hamarosan” always last, but it’s virtual on public side.
  // In admin, we allow category "soon" only as product.status, not as category.
  const cats = [...state.productsDoc.categories];
  cats.sort((a,b)=> (a.label_hu||a.id).localeCompare((b.label_hu||b.id), "hu"));
  return cats;
}

function renderCategories(){
  const root = $("#categoriesTable");
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "tgrid";

  const head = document.createElement("div");
  head.className = "trow head";
  head.innerHTML = `
    <div class="tcell">ID</div>
    <div class="tcell">Név (HU/EN)</div>
    <div class="tcell">Művelet</div>
    <div class="tcell"></div>
    <div class="tcell"></div>
    <div class="tcell"></div>
  `;
  wrap.appendChild(head);

  for(const c of orderedCategories()){
    const row = document.createElement("div");
    row.className = "trow";
    row.style.gridTemplateColumns = "1fr 2fr 1.2fr 0fr 0fr 0fr";
    row.innerHTML = `
      <div class="tcell"><span class="tag">${escapeHtml(c.id)}</span></div>
      <div class="tcell">${escapeHtml(catLabel(c))}</div>
      <div class="tcell"></div>
    `;

    const btns = document.createElement("div");
    btns.className = "row";
    const edit = document.createElement("button");
    edit.className = "btn small";
    edit.textContent = "Szerkeszt";
    edit.onclick = () => editCategory(c.id);

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Töröl";
    del.onclick = () => deleteCategory(c.id);

    btns.appendChild(edit);
    btns.appendChild(del);

    row.children[2].appendChild(btns);
    wrap.appendChild(row);
  }

  root.appendChild(wrap);
}

function renderProducts(){
  const root = $("#productsTable");
  root.innerHTML = "";

  const q = ($("#adminSearch").value || "").trim().toLowerCase();
  const cats = orderedCategories();
  const catMap = new Map(cats.map(c => [c.id, c]));

  let list = [...state.productsDoc.products];
  if(q){
    list = list.filter(p => {
      const hay = `${p.name_hu||""} ${p.name_en||""} ${p.flavor_hu||""} ${p.flavor_en||""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // Sort: by name (HU), then flavor (HU), but keep same-name next to each other
  list.sort((a,b) => {
    const an = (a.name_hu || a.name_en || "").toLowerCase();
    const bn = (b.name_hu || b.name_en || "").toLowerCase();
    if(an !== bn) return an.localeCompare(bn, "hu");
    const af = (a.flavor_hu || a.flavor_en || "").toLowerCase();
    const bf = (b.flavor_hu || b.flavor_en || "").toLowerCase();
    return af.localeCompare(bf, "hu");
  });

  const wrap = document.createElement("div");
  wrap.className = "tgrid";

  const head = document.createElement("div");
  head.className = "trow head";
  head.innerHTML = `
    <div class="tcell">Név</div>
    <div class="tcell">Íz</div>
    <div class="tcell">Kategória</div>
    <div class="tcell">Ár</div>
    <div class="tcell">Készlet</div>
    <div class="tcell">Status / Művelet</div>
  `;
  wrap.appendChild(head);

  for(const p of list){
    const row = document.createElement("div");
    row.className = "trow";
    const cat = catMap.get(String(p.categoryId || "")) || null;

    const statusTag = statusToTag(p);
    row.innerHTML = `
      <div class="tcell">${escapeHtml((p.name_hu||"") + " / " + (p.name_en||""))}</div>
      <div class="tcell">${escapeHtml((p.flavor_hu||"") + " / " + (p.flavor_en||""))}</div>
      <div class="tcell">${cat ? escapeHtml(cat.label_hu||cat.id) : "<span class='muted'>—</span>"}</div>
      <div class="tcell"><span class="tag">${fmt(p.price)} Ft</span></div>
      <div class="tcell"><span class="tag">${Math.max(0, Number(p.stock||0))} db</span></div>
      <div class="tcell"></div>
    `;

    const box = document.createElement("div");
    box.className = "row";
    const tag = document.createElement("span");
    tag.className = "tag " + statusTag.cls;
    tag.textContent = statusTag.text;

    const edit = document.createElement("button");
    edit.className = "btn small";
    edit.textContent = "Szerkeszt";
    edit.onclick = () => editProduct(p.id);

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Töröl";
    del.onclick = () => deleteProduct(p.id);

    box.appendChild(tag);
    box.appendChild(edit);
    box.appendChild(del);

    row.children[5].appendChild(box);
    wrap.appendChild(row);
  }

  root.appendChild(wrap);
}

function renderSales(){
  const root = $("#salesTable");
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "tgrid";

  const head = document.createElement("div");
  head.className = "trow head";
  head.style.gridTemplateColumns = "1fr 1.8fr .9fr 1.3fr 0fr 0fr";
  head.innerHTML = `
    <div class="tcell">Dátum</div>
    <div class="tcell">Tételek</div>
    <div class="tcell">Összeg</div>
    <div class="tcell">Művelet</div>
    <div class="tcell"></div>
    <div class="tcell"></div>
  `;
  wrap.appendChild(head);

  const prodMap = new Map(state.productsDoc.products.map(p => [p.id, p]));

  const salesSorted = [...state.sales].sort((a,b)=> String(b.date||"").localeCompare(String(a.date||"")));
  for(const s of salesSorted){
    const total = saleTotal(s);
    const itemsLabel = (s.items||[]).map(it => {
      const p = prodMap.get(it.productId);
      const name = p ? (p.name_hu || p.name_en || "??") : "??";
      const flav = p ? (p.flavor_hu || p.flavor_en || "") : "";
      return `${name}${flav?` (${flav})`:""} ×${it.qty}`;
    }).join(" • ");

    const row = document.createElement("div");
    row.className = "trow";
    row.style.gridTemplateColumns = "1fr 1.8fr .9fr 1.3fr 0fr 0fr";
    row.innerHTML = `
      <div class="tcell"><span class="tag">${escapeHtml(s.date||"")}</span></div>
      <div class="tcell">${escapeHtml(itemsLabel || "—")}</div>
      <div class="tcell"><span class="tag">${fmt(total)} Ft</span></div>
      <div class="tcell"></div>
      <div class="tcell"></div>
      <div class="tcell"></div>
    `;

    const box = document.createElement("div");
    box.className = "row";

    const view = document.createElement("button");
    view.className = "btn small";
    view.textContent = "Megnéz";
    view.onclick = () => viewSale(s.id);

    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "Töröl (rollback)";
    del.onclick = () => deleteSale(s.id);

    box.appendChild(view);
    box.appendChild(del);

    row.children[3].appendChild(box);
    wrap.appendChild(row);
  }

  root.appendChild(wrap);
}

function renderRevenue(){
  const total = state.sales.reduce((acc,s)=> acc + saleTotal(s), 0);
  $("#revTotal").textContent = fmt(total) + " Ft";

  const t = todayISO();
  const today = state.sales.filter(s => s.date === t).reduce((acc,s)=> acc + saleTotal(s), 0);
  $("#revToday").textContent = fmt(today) + " Ft";

  // Group by date
  const map = new Map();
  for(const s of state.sales){
    const d = s.date || "";
    map.set(d, (map.get(d)||0) + saleTotal(s));
  }
  const rows = [...map.entries()].sort((a,b)=> String(b[0]).localeCompare(String(a[0])));

  const root = $("#revenueTable");
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "tgrid";

  const head = document.createElement("div");
  head.className = "trow head";
  head.style.gridTemplateColumns = "1fr 1fr 0fr 0fr 0fr 0fr";
  head.innerHTML = `
    <div class="tcell">Dátum</div>
    <div class="tcell">Bevétel</div>
    <div class="tcell"></div><div class="tcell"></div><div class="tcell"></div><div class="tcell"></div>
  `;
  wrap.appendChild(head);

  for(const [d, v] of rows){
    const row = document.createElement("div");
    row.className = "trow";
    row.style.gridTemplateColumns = "1fr 1fr 0fr 0fr 0fr 0fr";
    row.innerHTML = `
      <div class="tcell"><span class="tag">${escapeHtml(d)}</span></div>
      <div class="tcell"><span class="tag good">${fmt(v)} Ft</span></div>
      <div class="tcell"></div><div class="tcell"></div><div class="tcell"></div><div class="tcell"></div>
    `;
    wrap.appendChild(row);
  }
  root.appendChild(wrap);
}

/* ---------- Category CRUD ---------- */
function editCategory(id){
  const c = state.productsDoc.categories.find(x => x.id === id);
  if(!c) return;

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="field">
      <label>ID (nem változik)</label>
      <input value="${escapeAttr(c.id)}" disabled />
    </div>
    <div class="hr"></div>
    <div class="form-grid" style="padding:0; grid-template-columns: 1fr 1fr;">
      <div class="field">
        <label>Név HU</label>
        <input id="cHu" value="${escapeAttr(c.label_hu||"")}" />
      </div>
      <div class="field">
        <label>Név EN</label>
        <input id="cEn" value="${escapeAttr(c.label_en||"")}" />
      </div>
    </div>
  `;

  openModal("Kategória szerkesztés", el, [
    { label: "Mégse", onClick: closeModal },
    { label: "Mentés", primary: true, onClick: () => {
      c.label_hu = el.querySelector("#cHu").value.trim() || c.id;
      c.label_en = el.querySelector("#cEn").value.trim() || c.label_hu || c.id;
      closeModal();
      renderCategories();
      toast("Kategória mentve ✅");
    }}
  ]);
}

function deleteCategory(id){
  // Prevent delete if products use it
  const used = state.productsDoc.products.some(p => String(p.categoryId||"") === String(id));
  if(used){
    toast("Ezt használják termékek — előbb állítsd át őket 😅");
    return;
  }
  state.productsDoc.categories = state.productsDoc.categories.filter(c => c.id !== id);
  renderCategories();
  toast("Kategória törölve ✅");
}

function addCategory(){
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="field">
      <label>ID (kicsi, ékezet nélkül ajánlott)</label>
      <input id="cid" placeholder="pl. elfbar" />
    </div>
    <div class="form-grid" style="padding:0; grid-template-columns: 1fr 1fr;">
      <div class="field">
        <label>Név HU</label>
        <input id="cHu" placeholder="pl. ELF" />
      </div>
      <div class="field">
        <label>Név EN</label>
        <input id="cEn" placeholder="pl. ELF" />
      </div>
    </div>
  `;

  openModal("Új kategória", el, [
    { label: "Mégse", onClick: closeModal },
    { label: "Létrehozás", primary: true, onClick: () => {
      const id = el.querySelector("#cid").value.trim();
      if(!id){ toast("Adj ID-t"); return; }
      if(id === "all" || id === "soon"){ toast("Ez foglalt ID"); return; }
      if(state.productsDoc.categories.some(c => c.id === id)){ toast("Már van ilyen ID"); return; }

      const c = {
        id,
        label_hu: el.querySelector("#cHu").value.trim() || id,
        label_en: el.querySelector("#cEn").value.trim() || (el.querySelector("#cHu").value.trim() || id),
      };
      state.productsDoc.categories.push(c);
      closeModal();
      renderCategories();
      toast("Kategória hozzáadva ✅");
    }}
  ]);
}

/* ---------- Product CRUD ---------- */
function statusToTag(p){
  const st = p.status || "ok";
  if(st === "soon") return { text: "soon", cls: "warn" };
  const stock = Math.max(0, Number(p.stock||0));
  if(st === "out" || stock <= 0) return { text: "out", cls: "bad" };
  return { text: "ok", cls: "good" };
}

function addProduct(){
  const cats = orderedCategories();
  const el = productFormEl({
    id: uniqueId("p"),
    categoryId: cats[0]?.id || "",
    status: "ok",
    stock: 0,
    price: 0,
    image: "",
    name_hu: "",
    name_en: "",
    flavor_hu: "",
    flavor_en: ""
  }, true);

  openModal("Új termék", el, [
    { label: "Mégse", onClick: closeModal },
    { label: "Létrehozás", primary: true, onClick: () => {
      const p = readProductForm(el);
      if(!p.name_hu && !p.name_en){ toast("Név kell"); return; }
      state.productsDoc.products.push(p);
      closeModal();
      renderProducts();
      toast("Termék hozzáadva ✅");
    }}
  ]);
}

function editProduct(id){
  const p = state.productsDoc.products.find(x => x.id === id);
  if(!p) return;

  const el = productFormEl({ ...p }, false);

  openModal("Termék szerkesztés", el, [
    { label: "Mégse", onClick: closeModal },
    { label: "Mentés", primary: true, onClick: () => {
      const next = readProductForm(el);
      Object.assign(p, next);
      closeModal();
      renderProducts();
      toast("Termék mentve ✅");
    }}
  ]);
}

function deleteProduct(id){
  // Prevent delete if sales contain it
  const used = state.sales.some(s => (s.items||[]).some(it => it.productId === id));
  if(used){
    toast("Eladásokban szerepel — előbb töröld az eladást 😬");
    return;
  }
  state.productsDoc.products = state.productsDoc.products.filter(p => p.id !== id);
  renderProducts();
  toast("Termék törölve ✅");
}

function productFormEl(p, isNew){
  const cats = orderedCategories();
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="form-grid" style="padding:0;">
      <div class="field">
        <label>ID</label>
        <input id="pid" value="${escapeAttr(p.id)}" ${isNew ? "" : "disabled"} />
      </div>
      <div class="field">
        <label>Kategória</label>
        <select id="pcat">
          ${cats.map(c => `<option value="${escapeAttr(c.id)}"${String(p.categoryId)===String(c.id)?" selected":""}>${escapeHtml(c.label_hu||c.id)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="pstatus">
          <option value="ok"${p.status==="ok"?" selected":""}>ok</option>
          <option value="out"${p.status==="out"?" selected":""}>out</option>
          <option value="soon"${p.status==="soon"?" selected":""}>soon</option>
        </select>
      </div>
      <div class="field">
        <label>Készlet</label>
        <input id="pstock" type="number" min="0" value="${escapeAttr(String(p.stock||0))}" />
      </div>
      <div class="field">
        <label>Ár (Ft)</label>
        <input id="pprice" type="number" min="0" value="${escapeAttr(String(p.price||0))}" />
      </div>
      <div class="field">
        <label>Kép URL (1000×1000)</label>
        <input id="pimg" value="${escapeAttr(p.image||"")}" placeholder="https://..." />
      </div>

      <div class="field">
        <label>Név HU</label>
        <input id="nHu" value="${escapeAttr(p.name_hu||"")}" />
      </div>
      <div class="field">
        <label>Név EN</label>
        <input id="nEn" value="${escapeAttr(p.name_en||"")}" />
      </div>
      <div class="field">
        <label>Íz HU</label>
        <input id="fHu" value="${escapeAttr(p.flavor_hu||"")}" />
      </div>
      <div class="field">
        <label>Íz EN</label>
        <input id="fEn" value="${escapeAttr(p.flavor_en||"")}" />
      </div>
    </div>
    <div class="note">
      <div class="note-title">Logika</div>
      <div class="note-body">
        soon = csak “Hamarosan” tabban látszik • out/stock=0 = katalógusban szürkítve.
      </div>
    </div>
  `;
  return el;
}

function readProductForm(el){
  const id = el.querySelector("#pid").value.trim();
  const categoryId = el.querySelector("#pcat").value;
  const status = el.querySelector("#pstatus").value;
  const stock = Math.max(0, Number(el.querySelector("#pstock").value || 0));
  const price = Math.max(0, Number(el.querySelector("#pprice").value || 0));
  const image = el.querySelector("#pimg").value.trim();

  const name_hu = el.querySelector("#nHu").value.trim();
  const name_en = el.querySelector("#nEn").value.trim();
  const flavor_hu = el.querySelector("#fHu").value.trim();
  const flavor_en = el.querySelector("#fEn").value.trim();

  return { id, categoryId, status, stock, price, image, name_hu, name_en, flavor_hu, flavor_en };
}

/* ---------- Sales ---------- */
function saleTotal(s){
  return (s.items||[]).reduce((acc,it)=> acc + (Number(it.unitPrice||0) * Number(it.qty||0)), 0);
}

function addSale(){
  const products = state.productsDoc.products.filter(p => (p.status||"ok") !== "soon");
  if(products.length === 0){
    toast("Nincs eladható termék (soon nem eladható).");
    return;
  }

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="field">
      <label>Dátum (YYYY-MM-DD)</label>
      <input id="sdate" value="${todayISO()}" placeholder="2025-12-23" />
    </div>
    <div class="hr"></div>
    <div id="items"></div>
    <div class="row" style="margin-top:10px;">
      <button class="btn small" id="addItem">+ Tétel</button>
    </div>
    <div class="note">
      <div class="note-title">Info</div>
      <div class="note-body">Mentéskor levonja a stockot. Törléskor visszaadja.</div>
    </div>
  `;

  const itemsRoot = el.querySelector("#items");

  const addItemRow = (preset) => {
    const row = document.createElement("div");
    row.className = "trow";
    row.style.gridTemplateColumns = "1.6fr .7fr .7fr .8fr .6fr .6fr";
    const opts = products.map(p => {
      const label = `${p.name_hu||p.name_en||"??"}${(p.flavor_hu||p.flavor_en) ? " • " + (p.flavor_hu||p.flavor_en) : ""} (stock:${Math.max(0, Number(p.stock||0))})`;
      return `<option value="${escapeAttr(p.id)}">${escapeHtml(label)}</option>`;
    }).join("");

    row.innerHTML = `
      <div class="tcell">
        <select class="field" style="padding:0;">
          <option value="">Válassz…</option>
          ${opts}
        </select>
      </div>
      <div class="tcell"><input class="qty" type="number" min="1" value="1" /></div>
      <div class="tcell"><input class="price" type="number" min="0" value="0" /></div>
      <div class="tcell"><span class="tag ghost">unit</span></div>
      <div class="tcell"></div>
      <div class="tcell"><button class="btn small danger">Töröl</button></div>
    `;

    const sel = row.querySelector("select");
    const qty = row.querySelector(".qty");
    const price = row.querySelector(".price");
    const unitTag = row.querySelector(".tag");

    sel.addEventListener("change", () => {
      const p = state.productsDoc.products.find(x => x.id === sel.value);
      const v = p ? Number(p.price||0) : 0;
      price.value = String(v);
      unitTag.textContent = fmt(v) + " Ft";
    });

    price.addEventListener("input", () => {
      unitTag.textContent = fmt(Number(price.value||0)) + " Ft";
    });

    row.querySelector("button").onclick = () => row.remove();

    if(preset){
      sel.value = preset.productId || "";
      qty.value = String(preset.qty || 1);
      price.value = String(preset.unitPrice || 0);
      unitTag.textContent = fmt(Number(price.value||0)) + " Ft";
    }

    itemsRoot.appendChild(row);
  };

  // start with 1 row
  addItemRow();

  el.querySelector("#addItem").onclick = () => addItemRow();

  openModal("Új eladás", el, [
    { label: "Mégse", onClick: closeModal },
    { label: "Mentés", primary: true, onClick: () => {
      const date = el.querySelector("#sdate").value.trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        toast("Dátum formátum: YYYY-MM-DD");
        return;
      }

      const rows = [...itemsRoot.children];
      const items = [];
      for(const r of rows){
        const pid = r.querySelector("select").value;
        const qty = Math.max(1, Number(r.querySelector(".qty").value || 1));
        const unitPrice = Math.max(0, Number(r.querySelector(".price").value || 0));
        if(!pid) continue;
        items.push({ productId: pid, qty, unitPrice });
      }

      if(items.length === 0){
        toast("Adj hozzá legalább 1 tételt");
        return;
      }

      // Check stock availability (for non-soon products)
      for(const it of items){
        const p = state.productsDoc.products.find(x => x.id === it.productId);
        if(!p){ toast("Ismeretlen termék"); return; }
        if((p.status||"ok")==="soon"){ toast("soon termék nem eladható"); return; }
        const s = Math.max(0, Number(p.stock||0));
        if(s < it.qty){
          toast(`Nincs elég stock: ${p.name_hu||p.name_en} (${s} db)`);
          return;
        }
      }

      // Apply stock decrease
      for(const it of items){
        const p = state.productsDoc.products.find(x => x.id === it.productId);
        p.stock = Math.max(0, Number(p.stock||0) - it.qty);
        if(p.stock <= 0 && (p.status||"ok")==="ok") p.status = "out"; // auto out when hits 0
      }

      state.sales.push({ id: uniqueId("s"), date, items });
      closeModal();
      renderProducts();
      renderSales();
      renderRevenue();
      toast("Eladás mentve ✅");
    }}
  ]);
}

function viewSale(id){
  const s = state.sales.find(x => x.id === id);
  if(!s) return;

  const prodMap = new Map(state.productsDoc.products.map(p=>[p.id,p]));
  const el = document.createElement("div");

  const lines = (s.items||[]).map(it => {
    const p = prodMap.get(it.productId);
    const name = p ? (p.name_hu||p.name_en||"??") : "??";
    const flavor = p ? (p.flavor_hu||p.flavor_en||"") : "";
    return `
      <div class="trow" style="grid-template-columns: 1.6fr .6fr .8fr .8fr 0fr 0fr;">
        <div class="tcell">${escapeHtml(name)} ${flavor?`<span class="muted">• ${escapeHtml(flavor)}</span>`:""}</div>
        <div class="tcell"><span class="tag">${it.qty} db</span></div>
        <div class="tcell"><span class="tag">${fmt(it.unitPrice)} Ft</span></div>
        <div class="tcell"><span class="tag good">${fmt(it.unitPrice*it.qty)} Ft</span></div>
        <div class="tcell"></div><div class="tcell"></div>
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <div class="row">
      <span class="tag">Dátum: ${escapeHtml(s.date||"")}</span>
      <span class="tag good">Összesen: ${fmt(saleTotal(s))} Ft</span>
    </div>
    <div class="hr"></div>
    <div class="tgrid">${lines}</div>
  `;

  openModal("Eladás részletei", el, [
    { label: "Bezár", primary: true, onClick: closeModal }
  ]);
}

function deleteSale(id){
  const idx = state.sales.findIndex(x => x.id === id);
  if(idx < 0) return;
  const s = state.sales[idx];

  // rollback stock
  for(const it of (s.items||[])){
    const p = state.productsDoc.products.find(x => x.id === it.productId);
    if(!p) continue;
    // if it was auto-out due to stock=0, allow back to ok when stock > 0
    p.stock = Math.max(0, Number(p.stock||0) + Number(it.qty||0));
    if(p.stock > 0 && (p.status||"ok")==="out") p.status = "ok";
  }

  state.sales.splice(idx, 1);
  renderProducts();
  renderSales();
  renderRevenue();
  toast("Eladás törölve + rollback ✅");
}

/* ---------- Utils ---------- */
function fmt(n){
  const v = Number(n||0);
  return v.toLocaleString("hu-HU");
}
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

/* ---------- Wire ---------- */
function bind(){
  $("#reloadBtn").onclick = () => location.reload();
  $("#loadBtn").onclick = loadData;
  $("#saveBtn").onclick = saveData;

  $("#addCategoryBtn").onclick = () => {
    if(!state.loaded){ toast("Tölts be adatot előbb"); return; }
    addCategory();
  };

  $("#addProductBtn").onclick = () => {
    if(!state.loaded){ toast("Tölts be adatot előbb"); return; }
    addProduct();
  };

  $("#addSaleBtn").onclick = () => {
    if(!state.loaded){ toast("Tölts be adatot előbb"); return; }
    addSale();
  };

  $("#adminSearch").addEventListener("input", () => renderProducts());

  $("#modalClose").onclick = closeModal;
  $("#modal").addEventListener("click", (e) => {
    if(e.target && e.target.dataset && e.target.dataset.close) closeModal();
  });

  // autosave cfg on input
  for(const id of ["#ghOwner","#ghRepo","#ghBranch","#ghToken"]){
    $(id).addEventListener("input", () => persistCfg());
  }
}

loadCfg();
bind();
