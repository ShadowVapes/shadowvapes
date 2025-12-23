const $ = (s) => document.querySelector(s);

const LS = {
  owner: "sv_gh_owner",
  repo: "sv_gh_repo",
  branch: "sv_gh_branch",
  token: "sv_gh_token",
  cacheBust: "sv_cache_bust",
};

const PATHS = {
  products: "data/products.json",
  sales: "data/sales.json",
};

const state = {
  doc: { categories: [], products: [] },
  sales: [],
  sha: { products: null, sales: null },
  activeTab: "products",
  filters: {
    productCat: "all",
    salesCat: "all",
    chartCat: "all",
    productQ: "",
    salesQ: "",
  },
};

function setSaveState(kind, msg) {
  const dot = $("#saveDot");
  const text = $("#saveText");
  dot.classList.remove("ok", "busy", "bad");
  dot.classList.add(kind);
  text.textContent = msg;
}

function cfg() {
  return {
    owner: (localStorage.getItem(LS.owner) || "").trim(),
    repo: (localStorage.getItem(LS.repo) || "").trim(),
    branch: (localStorage.getItem(LS.branch) || "main").trim() || "main",
    token: (localStorage.getItem(LS.token) || "").trim(),
  };
}

function ensureDoc() {
  if (Array.isArray(state.doc)) state.doc = { categories: [], products: state.doc };
  if (!Array.isArray(state.doc.categories)) state.doc.categories = [];
  if (!Array.isArray(state.doc.products)) state.doc.products = [];
  if (!Array.isArray(state.sales)) state.sales = [];
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function catLabel(c) {
  return `${c.label_hu || c.id} / ${c.label_en || c.label_hu || c.id}`;
}

function catById(id) {
  return state.doc.categories.find((c) => String(c.id) === String(id)) || null;
}

function pNameHU(p) { return p.name_hu || p.name_en || ""; }
function pFlavorHU(p) { return p.flavor_hu || p.flavor_en || ""; }

function effectivePrice(p) {
  const direct = p.price;
  if (direct !== null && direct !== undefined && direct !== "" && !Number.isNaN(Number(direct))) return Number(direct);
  const c = catById(p.categoryId);
  return Number(c?.basePrice || 0);
}

function isSoon(p) { return (p.status || "ok") === "soon"; }
function isOut(p) {
  if ((p.status || "ok") === "out") return true;
  const st = Math.max(0, Number(p.stock || 0));
  return st <= 0 && !isSoon(p);
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function openModal({ title, bodyHTML, okText = "OK", cancelText = "Mégse", onOk }) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;
  $("#modalOk").textContent = okText;
  $("#modalCancel").textContent = cancelText;
  $("#modalBackdrop").style.display = "flex";

  const close = () => { $("#modalBackdrop").style.display = "none"; };

  $("#modalCancel").onclick = () => close();
  $("#modalBackdrop").onclick = (e) => { if (e.target === $("#modalBackdrop")) close(); };

  $("#modalOk").onclick = async () => {
    try {
      const res = await onOk(close);
      if (res !== false) close();
    } catch (e) {
      alert(e.message || String(e));
    }
  };
}

/* ---------- GitHub Load/Save ---------- */
async function loadAll({ forceRemote = true } = {}) {
  setSaveState("busy", "Betöltés…");

  const { owner, repo, branch, token } = cfg();
  try {
    if (forceRemote && owner && repo && token) {
      const p = await ShadowGH.getFile({ token, owner, repo, branch, path: PATHS.products });
      const s = await ShadowGH.getFile({ token, owner, repo, branch, path: PATHS.sales });
      state.sha.products = p.sha;
      state.sha.sales = s.sha;
      state.doc = JSON.parse(p.text);
      state.sales = JSON.parse(s.text);
    } else {
      // local fallback
      const pr = await fetch(`${PATHS.products}?cb=${Date.now()}`, { cache: "no-store" });
      const sr = await fetch(`${PATHS.sales}?cb=${Date.now()}`, { cache: "no-store" });
      state.doc = await pr.json();
      state.sales = await sr.json();
    }

    ensureDoc();
    normalizeData();
    renderActiveTab();

    setSaveState("ok", "Kész");
  } catch (e) {
    // konkrét branch hiba javabb üzenettel
    if ((e.message || "").includes("No commit found for the ref")) {
      setSaveState("bad", "Branch hiba");
      throw new Error("Betöltés hiba: A branch név rossz. Beállításokban a Branch legyen pl. main.");
    }
    setSaveState("bad", "Hiba");
    throw e;
  }
}

function normalizeData() {
  // categories normalize
  state.doc.categories = state.doc.categories
    .filter((c) => c && c.id && String(c.id) !== "all")
    .map((c) => ({
      id: String(c.id),
      label_hu: c.label_hu || c.id,
      label_en: c.label_en || c.label_hu || c.id,
      basePrice: Number(c.basePrice || 0),
    }));

  // products normalize
  state.doc.products = state.doc.products
    .filter(Boolean)
    .map((p) => ({
      id: String(p.id || uid("p")),
      categoryId: String(p.categoryId || (state.doc.categories[0]?.id || "")),
      status: (p.status === "ok" || p.status === "out" || p.status === "soon") ? p.status : "ok",
      stock: Math.max(0, Number(p.stock || 0)),
      // price lehet null / üres → akkor kategória basePrice
      price: (p.price === "" || p.price === null || p.price === undefined) ? null : Number(p.price),
      image: p.image || "",
      name_hu: p.name_hu || "",
      name_en: p.name_en || "",
      flavor_hu: p.flavor_hu || "",
      flavor_en: p.flavor_en || "",
    }));

  // sales normalize
  state.sales = (state.sales || []).map((s) => ({
    id: String(s.id || uid("s")),
    date: (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) ? s.date : todayISO(),
    name: s.name || "",
    method: s.method || "",
    items: Array.isArray(s.items) ? s.items.map((it) => ({
      productId: String(it.productId || ""),
      qty: Math.max(1, Number(it.qty || 1)),
      unitPrice: Math.max(0, Number(it.unitPrice || 0)),
    })).filter((it) => it.productId) : [],
  }));
}

async function saveAll({ reloadAfter = true } = {}) {
  const { owner, repo, branch, token } = cfg();
  if (!owner || !repo || !branch || !token) {
    setSaveState("bad", "Nincs GH beállítás");
    throw new Error("Beállításoknál add meg: Owner/Repo/Branch/Token.");
  }

  setSaveState("busy", "Mentés…");

  // cache bust publikus oldalon
  localStorage.setItem(LS.cacheBust, String(Date.now()));

  const productsText = JSON.stringify({ categories: state.doc.categories, products: state.doc.products }, null, 2);
  const salesText = JSON.stringify(state.sales, null, 2);

  // sha frissítés ha hiányzik
  if (!state.sha.products || !state.sha.sales) {
    const pOld = await ShadowGH.getFile({ token, owner, repo, branch, path: PATHS.products });
    const sOld = await ShadowGH.getFile({ token, owner, repo, branch, path: PATHS.sales });
    state.sha.products = pOld.sha;
    state.sha.sales = sOld.sha;
  }

  await ShadowGH.putFile({
    token, owner, repo, branch,
    path: PATHS.products,
    message: "Update products.json",
    text: productsText,
    sha: state.sha.products,
  });

  await ShadowGH.putFile({
    token, owner, repo, branch,
    path: PATHS.sales,
    message: "Update sales.json",
    text: salesText,
    sha: state.sha.sales,
  });

  setSaveState("ok", "Mentve");

  // “mentés után töltse be”
  if (reloadAfter) {
    await loadAll({ forceRemote: true });
  }
}

/* ---------- Render Tabs ---------- */
function setTab(tab) {
  state.activeTab = tab;
  for (const b of $("#tabs").querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.tab === tab);
  }
  for (const id of ["products","categories","sales","chart","settings"]) {
    $("#tab-" + id).style.display = (id === tab) ? "block" : "none";
  }
  renderActiveTab();
}

function renderActiveTab() {
  if (state.activeTab === "products") renderProductsTab();
  if (state.activeTab === "categories") renderCategoriesTab();
  if (state.activeTab === "sales") renderSalesTab();
  if (state.activeTab === "chart") renderChartTab();
  if (state.activeTab === "settings") renderSettingsTab();
}

/* ---------- Settings Tab ---------- */
function renderSettingsTab() {
  const { owner, repo, branch, token } = cfg();
  $("#tab-settings").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>GitHub Owner</label><input id="ghOwner" value="${esc(owner)}" placeholder="pl. tesouser" /></div>
      <div class="field"><label>Repo</label><input id="ghRepo" value="${esc(repo)}" placeholder="pl. shadowvapes" /></div>
      <div class="field"><label>Branch</label><input id="ghBranch" value="${esc(branch)}" placeholder="main" /></div>
      <div class="field"><label>Token</label><input id="ghToken" value="${esc(token)}" placeholder="ghp_..." type="password" /></div>
    </div>
    <div class="actions">
      <button class="ghost" id="btnLoad">Betöltés</button>
      <button class="primary" id="btnSave">Mentés (GitHub)</button>
    </div>
    <div class="small-muted" style="margin-top:10px;">
      Tipp: Ha a Branch rossz → “No commit found…” hibát kapsz. Legtöbbször <b>main</b>.
    </div>
  `;

  $("#btnLoad").onclick = () => loadAll({ forceRemote: true }).catch((e) => alert(e.message));
  $("#btnSave").onclick = () => saveAll({ reloadAfter: true }).catch((e) => alert(e.message));

  $("#ghOwner").oninput = () => localStorage.setItem(LS.owner, $("#ghOwner").value.trim());
  $("#ghRepo").oninput = () => localStorage.setItem(LS.repo, $("#ghRepo").value.trim());
  $("#ghBranch").oninput = () => localStorage.setItem(LS.branch, $("#ghBranch").value.trim() || "main");
  $("#ghToken").oninput = () => localStorage.setItem(LS.token, $("#ghToken").value.trim());
}

/* ---------- Categories Tab ---------- */
function renderCategoriesTab() {
  const rows = state.doc.categories
    .slice()
    .sort((a, b) => (a.label_hu || a.id).localeCompare(b.label_hu || b.id, "hu"))
    .map((c) => `
      <tr>
        <td><b>${esc(c.id)}</b></td>
        <td><input data-cid="${esc(c.id)}" data-k="label_hu" value="${esc(c.label_hu || "")}" /></td>
        <td><input data-cid="${esc(c.id)}" data-k="label_en" value="${esc(c.label_en || "")}" /></td>
        <td><input data-cid="${esc(c.id)}" data-k="basePrice" type="number" min="0" value="${esc(String(c.basePrice || 0))}" /></td>
        <td style="width:120px;"><button class="danger" data-del="${esc(c.id)}">Töröl</button></td>
      </tr>
    `).join("");

  $("#tab-categories").innerHTML = `
    <div class="actions" style="margin-top:0;">
      <button class="primary" id="addCat">+ Kategória</button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>ID</th><th>HU</th><th>EN</th><th>Alap ár (Ft)</th><th></th>
        </tr>
      </thead>
      <tbody>${rows || ""}</tbody>
    </table>

    <div class="small-muted">
      Tipp: ha a terméknél az ár üres / null → a kategória alap ára megy.
    </div>
  `;

  $("#addCat").onclick = () => {
    openModal({
      title: "Új kategória",
      okText: "Létrehozás",
      bodyHTML: `
        <div class="form-grid">
          <div class="field full"><label>Kategória ID (pl. elf, solo)</label><input id="n_id" placeholder="elf" /></div>
          <div class="field"><label>HU</label><input id="n_hu" placeholder="ELF" /></div>
          <div class="field"><label>EN</label><input id="n_en" placeholder="ELF" /></div>
          <div class="field third"><label>Alap ár (Ft)</label><input id="n_price" type="number" min="0" value="0" /></div>
        </div>
      `,
      onOk: async () => {
        const id = ($("#n_id").value || "").trim();
        if (!id) return alert("Adj ID-t");
        if (id === "all" || id === "soon") return alert("Foglalt ID");
        if (state.doc.categories.some((c) => c.id === id)) return alert("Van már ilyen ID");

        state.doc.categories.push({
          id,
          label_hu: ($("#n_hu").value || "").trim() || id,
          label_en: ($("#n_en").value || "").trim() || ($("#n_hu").value || "").trim() || id,
          basePrice: Math.max(0, Number($("#n_price").value || 0)),
        });

        await saveAll({ reloadAfter: true });
      },
    });
  };

  // inline edit autosave gomb nélkül? (akció után mentünk: blur)
  for (const inp of $("#tab-categories").querySelectorAll("tbody input")) {
    inp.addEventListener("blur", async () => {
      const cid = inp.dataset.cid;
      const key = inp.dataset.k;
      const c = state.doc.categories.find((x) => x.id === cid);
      if (!c) return;

      if (key === "basePrice") c.basePrice = Math.max(0, Number(inp.value || 0));
      else c[key] = (inp.value || "").trim() || c.id;

      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    });
  }

  for (const btn of $("#tab-categories").querySelectorAll("[data-del]")) {
    btn.onclick = async () => {
      const id = btn.dataset.del;
      const used = state.doc.products.some((p) => String(p.categoryId) === String(id));
      if (used) return alert("Ezt használják termékek, előbb állítsd át őket.");
      state.doc.categories = state.doc.categories.filter((c) => c.id !== id);
      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    };
  }
}

/* ---------- Products Tab ---------- */
function renderProductsTab() {
  const cats = [{ id: "all", label_hu: "Összes" }, ...state.doc.categories];
  const catOpts = cats.map((c) => `<option value="${esc(c.id)}"${state.filters.productCat===c.id?" selected":""}>${esc(c.label_hu || c.id)}</option>`).join("");

  $("#tab-products").innerHTML = `
    <div class="form-grid">
      <div class="field third">
        <label>Kategória szűrő</label>
        <select id="pCat">${catOpts}</select>
      </div>
      <div class="field">
        <label>Keresés (név/íz)</label>
        <input id="pQ" value="${esc(state.filters.productQ)}" placeholder="ELF, jég, ..."/>
      </div>
      <div class="field third">
        <label>&nbsp;</label>
        <button class="primary" id="addProduct">+ Termék</button>
      </div>
    </div>
  `;

  const prodMap = state.doc.products.slice();
  const q = (state.filters.productQ || "").toLowerCase();
  const catId = state.filters.productCat;

  let list = prodMap.filter((p) => {
    if (catId !== "all" && String(p.categoryId) !== String(catId)) return false;
    if (!q) return true;
    return `${p.name_hu||""} ${p.name_en||""} ${p.flavor_hu||""} ${p.flavor_en||""}`.toLowerCase().includes(q);
  });

  // rendezés: név szerint csoport, out-only csoportok a végére
  const groups = new Map();
  for (const p of list) {
    const k = (p.name_hu || p.name_en || "").toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const gArr = [...groups.entries()].map(([k, items]) => {
    items.sort((a,b) => {
      const ao = isOut(a) ? 1 : 0;
      const bo = isOut(b) ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return (pFlavorHU(a)).localeCompare(pFlavorHU(b), "hu");
    });
    return { k, items, allOut: items.every(isOut) };
  });
  gArr.sort((a,b) => (a.allOut===b.allOut ? a.k.localeCompare(b.k, "hu") : (a.allOut?1:-1)));
  list = gArr.flatMap((g)=>g.items);

  const rows = list.map((p) => {
    const c = catById(p.categoryId);
    return `
      <tr>
        <td><b>${esc(pNameHU(p))}</b><div class="small-muted">${esc(p.id)}</div></td>
        <td>${esc(pFlavorHU(p))}</td>
        <td>${esc(c?.label_hu || p.categoryId || "—")}</td>
        <td>
          <select data-pid="${esc(p.id)}" data-k="status">
            <option value="ok"${p.status==="ok"?" selected":""}>ok</option>
            <option value="out"${p.status==="out"?" selected":""}>out</option>
            <option value="soon"${p.status==="soon"?" selected":""}>soon</option>
          </select>
        </td>
        <td><input data-pid="${esc(p.id)}" data-k="stock" type="number" min="0" value="${esc(String(p.stock||0))}" /></td>
        <td>
          <input data-pid="${esc(p.id)}" data-k="price" type="number" min="0" value="${p.price===null? "": esc(String(p.price))}" placeholder="(kategória ár)" />
          <div class="small-muted">Eff: <b>${effectivePrice(p).toLocaleString("hu-HU")} Ft</b></div>
        </td>
        <td style="width:220px;">
          <button class="ghost" data-edit="${esc(p.id)}">Szerkeszt</button>
          <button class="danger" data-del="${esc(p.id)}">Töröl</button>
        </td>
      </tr>
    `;
  }).join("");

  $("#tab-products").insertAdjacentHTML("beforeend", `
    <table class="table">
      <thead>
        <tr>
          <th>Név</th><th>Íz</th><th>Kategória</th><th>Status</th><th>Készlet</th><th>Ár</th><th></th>
        </tr>
      </thead>
      <tbody>${rows || ""}</tbody>
    </table>
  `);

  $("#pCat").onchange = () => { state.filters.productCat = $("#pCat").value; renderProductsTab(); };
  $("#pQ").oninput = () => { state.filters.productQ = $("#pQ").value || ""; renderProductsTab(); };
  $("#addProduct").onclick = () => addOrEditProduct(null);

  // quick inline changes: blur/change után ment
  for (const el of $("#tab-products").querySelectorAll("[data-pid]")) {
    const pid = el.dataset.pid;
    const key = el.dataset.k;
    const p = state.doc.products.find((x) => x.id === pid);
    if (!p) continue;

    const handler = async () => {
      if (key === "stock") p.stock = Math.max(0, Number(el.value || 0));
      if (key === "status") p.status = el.value;
      if (key === "price") {
        const v = (el.value || "").trim();
        p.price = v === "" ? null : Math.max(0, Number(v));
      }
      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    };

    if (el.tagName === "SELECT") el.onchange = handler;
    else el.addEventListener("blur", handler);
  }

  for (const b of $("#tab-products").querySelectorAll("[data-edit]")) {
    b.onclick = () => addOrEditProduct(b.dataset.edit);
  }
  for (const b of $("#tab-products").querySelectorAll("[data-del]")) {
    b.onclick = async () => {
      const id = b.dataset.del;
      const used = state.sales.some((s) => s.items.some((it) => it.productId === id));
      if (used) return alert("Eladásokban szerepel, előbb töröld/elválaszd.");
      state.doc.products = state.doc.products.filter((p) => p.id !== id);
      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    };
  }
}

function addOrEditProduct(id) {
  const isNew = !id;
  const p = isNew ? {
    id: uid("p"),
    categoryId: state.doc.categories[0]?.id || "",
    status: "ok",
    stock: 0,
    price: null,
    image: "",
    name_hu: "",
    name_en: "",
    flavor_hu: "",
    flavor_en: "",
  } : state.doc.products.find((x) => x.id === id);

  if (!p) return;

  const cats = state.doc.categories.map((c) => `<option value="${esc(c.id)}"${String(p.categoryId)===String(c.id)?" selected":""}>${esc(c.label_hu || c.id)}</option>`).join("");

  openModal({
    title: isNew ? "Új termék" : "Termék szerkesztés",
    okText: isNew ? "Létrehozás" : "Mentés",
    bodyHTML: `
      <div class="form-grid">
        <div class="field full"><label>ID</label><input id="f_id" value="${esc(p.id)}" ${isNew ? "" : "disabled"} /></div>

        <div class="field third"><label>Kategória</label><select id="f_cat">${cats}</select></div>
        <div class="field third"><label>Status</label>
          <select id="f_status">
            <option value="ok"${p.status==="ok"?" selected":""}>ok</option>
            <option value="out"${p.status==="out"?" selected":""}>out</option>
            <option value="soon"${p.status==="soon"?" selected":""}>soon</option>
          </select>
        </div>
        <div class="field third"><label>Készlet</label><input id="f_stock" type="number" min="0" value="${esc(String(p.stock||0))}"/></div>

        <div class="field third"><label>Ár (Ft) (üres= kategória)</label>
          <input id="f_price" type="number" min="0" value="${p.price===null?"":esc(String(p.price))}" placeholder="(kategória)" />
        </div>
        <div class="field"><label>Kép URL (1000×1000)</label><input id="f_img" value="${esc(p.image||"")}" placeholder="https://..."/></div>

        <div class="field"><label>Név HU</label><input id="f_nhu" value="${esc(p.name_hu||"")}"/></div>
        <div class="field"><label>Név EN</label><input id="f_nen" value="${esc(p.name_en||"")}"/></div>
        <div class="field"><label>Íz HU</label><input id="f_fhu" value="${esc(p.flavor_hu||"")}"/></div>
        <div class="field"><label>Íz EN</label><input id="f_fen" value="${esc(p.flavor_en||"")}"/></div>
      </div>
      <div class="small-muted" style="margin-top:10px;">
        soon csak a “Hamarosan” tabban látszik. out/stock=0 → publikus oldalon szürke.
      </div>
    `,
    onOk: async () => {
      const np = {
        id: isNew ? ($("#f_id").value || "").trim() : p.id,
        categoryId: $("#f_cat").value,
        status: $("#f_status").value,
        stock: Math.max(0, Number($("#f_stock").value || 0)),
        price: ($("#f_price").value || "").trim() === "" ? null : Math.max(0, Number($("#f_price").value || 0)),
        image: ($("#f_img").value || "").trim(),
        name_hu: ($("#f_nhu").value || "").trim(),
        name_en: ($("#f_nen").value || "").trim(),
        flavor_hu: ($("#f_fhu").value || "").trim(),
        flavor_en: ($("#f_fen").value || "").trim(),
      };

      if (!np.name_hu && !np.name_en) return alert("Név kell");
      if (isNew) state.doc.products.push(np);
      else Object.assign(p, np);

      await saveAll({ reloadAfter: true });
    },
  });
}

/* ---------- Sales Tab ---------- */
function saleTotal(s, onlyCatId = "all") {
  const prod = new Map(state.doc.products.map((p) => [p.id, p]));
  let sum = 0;
  for (const it of s.items) {
    const p = prod.get(it.productId);
    if (!p) continue;
    if (onlyCatId !== "all" && String(p.categoryId) !== String(onlyCatId)) continue;
    sum += Number(it.unitPrice || 0) * Number(it.qty || 0);
  }
  return sum;
}

function saleQty(s, onlyCatId = "all") {
  const prod = new Map(state.doc.products.map((p) => [p.id, p]));
  let sum = 0;
  for (const it of s.items) {
    const p = prod.get(it.productId);
    if (!p) continue;
    if (onlyCatId !== "all" && String(p.categoryId) !== String(onlyCatId)) continue;
    sum += Number(it.qty || 0);
  }
  return sum;
}

function renderSalesTab() {
  const cats = [{ id: "all", label_hu: "Összes" }, ...state.doc.categories];
  const catOpts = cats.map((c) => `<option value="${esc(c.id)}"${state.filters.salesCat===c.id?" selected":""}>${esc(c.label_hu || c.id)}</option>`).join("");

  $("#tab-sales").innerHTML = `
    <div class="form-grid">
      <div class="field third">
        <label>Kategória szűrő</label>
        <select id="sCat">${catOpts}</select>
      </div>
      <div class="field">
        <label>Keresés (név / mód / dátum)</label>
        <input id="sQ" value="${esc(state.filters.salesQ)}" placeholder="KP, átutalás, 2025-12-23..."/>
      </div>
      <div class="field third">
        <label>&nbsp;</label>
        <button class="primary" id="addSale">+ Eladás</button>
      </div>
    </div>
  `;

  const prod = new Map(state.doc.products.map((p) => [p.id, p]));
  const q = (state.filters.salesQ || "").toLowerCase();
  const catId = state.filters.salesCat;

  let list = state.sales.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));
  if (q) {
    list = list.filter((s) => {
      const hay = `${s.date} ${s.name||""} ${s.method||""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (catId !== "all") {
    list = list.filter((s) => s.items.some((it) => {
      const p = prod.get(it.productId);
      return p && String(p.categoryId) === String(catId);
    }));
  }

  const rows = list.map((s) => {
    const t = saleTotal(s, catId);
    const qty = saleQty(s, catId);
    const itemsLabel = s.items
      .filter((it) => {
        const p = prod.get(it.productId);
        return p && (catId === "all" || String(p.categoryId) === String(catId));
      })
      .map((it) => {
        const p = prod.get(it.productId);
        const nm = p ? (p.name_hu || p.name_en || "??") : "??";
        const fl = p ? (p.flavor_hu || p.flavor_en || "") : "";
        return `${nm}${fl ? " • " + fl : ""} ×${it.qty}`;
      })
      .join(" | ");

    return `
      <tr>
        <td><b>${esc(s.date)}</b><div class="small-muted">${esc(s.name || "")}</div></td>
        <td>${esc(s.method || "")}</td>
        <td>${esc(itemsLabel)}</td>
        <td><b>${t.toLocaleString("hu-HU")} Ft</b><div class="small-muted">Db: ${qty}</div></td>
        <td style="width:140px;">
          <button class="danger" data-del-sale="${esc(s.id)}">Töröl (rollback)</button>
        </td>
      </tr>
    `;
  }).join("");

  $("#tab-sales").insertAdjacentHTML("beforeend", `
    <table class="table">
      <thead>
        <tr><th>Dátum + Név</th><th>Mód</th><th>Tételek</th><th>Összeg</th><th></th></tr>
      </thead>
      <tbody>${rows || ""}</tbody>
    </table>
  `);

  $("#sCat").onchange = () => { state.filters.salesCat = $("#sCat").value; renderSalesTab(); };
  $("#sQ").oninput = () => { state.filters.salesQ = $("#sQ").value || ""; renderSalesTab(); };
  $("#addSale").onclick = () => addSaleModal();

  for (const b of $("#tab-sales").querySelectorAll("[data-del-sale]")) {
    b.onclick = async () => {
      const id = b.dataset.delSale;
      const s = state.sales.find((x) => x.id === id);
      if (!s) return;

      // rollback
      for (const it of s.items) {
        const p = state.doc.products.find((x) => x.id === it.productId);
        if (!p) continue;
        p.stock = Math.max(0, Number(p.stock || 0) + Number(it.qty || 0));
        // ha out volt csak a stock miatt, vissza ok-ra (de ha soon, marad)
        if (p.status === "out" && p.stock > 0) p.status = "ok";
      }

      state.sales = state.sales.filter((x) => x.id !== id);
      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    };
  }
}

function addSaleModal() {
  const products = state.doc.products.filter((p) => !isSoon(p));
  if (!products.length) return alert("Nincs eladható termék (soon nem eladható).");

  const opts = products.map((p) => {
    const nm = p.name_hu || p.name_en || "??";
    const fl = p.flavor_hu || p.flavor_en || "";
    const eff = effectivePrice(p);
    return `<option value="${esc(p.id)}">${esc(nm)}${fl ? " • " + esc(fl) : ""} (stock:${p.stock}) (ár:${eff})</option>`;
  }).join("");

  openModal({
    title: "Új eladás",
    okText: "Mentés",
    bodyHTML: `
      <div class="form-grid">
        <div class="field"><label>Eladás neve</label><input id="sn" placeholder="pl. Pisti" /></div>
        <div class="field"><label>Dátum (YYYY-MM-DD)</label><input id="sd" value="${todayISO()}" /></div>
        <div class="field full"><label>Vásárlás módja (bármi)</label><input id="sm" placeholder="KP / átutalás / foxpost..." /></div>
      </div>

      <div class="rowline">
        <div class="left">
          <b>Tételek</b>
          <span class="small-muted">Több termék egy eladásban ✅</span>
        </div>
        <button class="ghost" id="addItem">+ tétel</button>
      </div>

      <div id="items" style="margin-top:10px;"></div>
    `,
    onOk: async () => {
      const name = ($("#sn").value || "").trim();
      const date = ($("#sd").value || "").trim();
      const method = ($("#sm").value || "").trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return alert("Dátum formátum: YYYY-MM-DD");

      const items = [];
      for (const row of $("#items").querySelectorAll("[data-row]")) {
        const pid = row.querySelector("select").value;
        const qty = Math.max(1, Number(row.querySelector("[data-qty]").value || 1));
        const up = Math.max(0, Number(row.querySelector("[data-price]").value || 0));
        if (pid) items.push({ productId: pid, qty, unitPrice: up });
      }
      if (!items.length) return alert("Adj hozzá legalább 1 tételt");

      // stock check + levonás
      for (const it of items) {
        const p = state.doc.products.find((x) => x.id === it.productId);
        if (!p) return alert("Ismeretlen termék");
        if (isSoon(p)) return alert("soon terméket nem adhatsz el");
        if (p.stock < it.qty) return alert(`Nincs elég készlet: ${p.name_hu || p.name_en} (van: ${p.stock})`);
      }
      for (const it of items) {
        const p = state.doc.products.find((x) => x.id === it.productId);
        p.stock = Math.max(0, p.stock - it.qty);
        if (p.stock <= 0 && p.status === "ok") p.status = "out";
      }

      state.sales.push({ id: uid("s"), date, name, method, items });

      await saveAll({ reloadAfter: true }).catch((e) => alert(e.message));
    },
  });

  // build item rows
  const addRow = () => {
    const div = document.createElement("div");
    div.className = "rowline";
    div.dataset.row = "1";
    div.innerHTML = `
      <div style="flex:1; display:grid; gap:10px; grid-template-columns: 1.6fr .5fr .7fr .2fr; align-items:center;">
        <select>${opts}</select>
        <input data-qty type="number" min="1" value="1"/>
        <input data-price type="number" min="0" value="0"/>
        <button class="danger" data-x>×</button>
      </div>
    `;

    const sel = div.querySelector("select");
    const qty = div.querySelector("[data-qty]");
    const price = div.querySelector("[data-price]");
    const del = div.querySelector("[data-x]");

    sel.onchange = () => {
      const p = state.doc.products.find((x) => x.id === sel.value);
      price.value = String(effectivePrice(p));
    };
    // init
    sel.dispatchEvent(new Event("change"));

    del.onclick = () => div.remove();

    $("#items").appendChild(div);
  };

  $("#addItem").onclick = () => addRow();
  addRow();
}

/* ---------- Chart Tab ---------- */
function aggregateByDate(catId = "all") {
  const prod = new Map(state.doc.products.map((p) => [p.id, p]));
  const map = new Map();

  for (const s of state.sales) {
    let matchedSale = false;
    let revenue = 0;
    let qty = 0;

    for (const it of s.items) {
      const p = prod.get(it.productId);
      if (!p) continue;
      if (catId !== "all" && String(p.categoryId) !== String(catId)) continue;

      matchedSale = true;
      revenue += Number(it.unitPrice || 0) * Number(it.qty || 0);
      qty += Number(it.qty || 0);
    }

    if (!matchedSale) continue;

    const key = s.date;
    const cur = map.get(key) || { date: key, sales: 0, qty: 0, revenue: 0 };
    cur.sales += 1;
    cur.qty += qty;
    cur.revenue += revenue;
    map.set(key, cur);
  }

  return [...map.values()].sort((a,b) => String(a.date).localeCompare(String(b.date)));
}

function drawChart(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // bg
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0,0,w,h);

  if (!rows.length) {
    ctx.fillStyle = "rgba(146,160,191,0.8)";
    ctx.font = "14px system-ui";
    ctx.fillText("Nincs adat.", 16, 24);
    return;
  }

  const pad = 36;
  const innerW = w - pad*2;
  const innerH = h - pad*2;

  const maxRev = Math.max(...rows.map(r => r.revenue), 1);
  const maxSales = Math.max(...rows.map(r => r.sales), 1);

  // axes
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-pad, h-pad);
  ctx.stroke();

  const barW = innerW / rows.length;

  // bars = revenue
  for (let i=0;i<rows.length;i++){
    const r = rows[i];
    const x = pad + i*barW + barW*0.2;
    const bw = barW*0.6;
    const bh = (r.revenue / maxRev) * innerH;
    const y = (h - pad) - bh;

    // gradient vibe
    const grad = ctx.createLinearGradient(x,y,x,y+bh);
    grad.addColorStop(0, "rgba(124,92,255,0.9)");
    grad.addColorStop(1, "rgba(40,215,255,0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(x,y,bw,bh);

    // sales line point
    const sy = (h - pad) - ((r.sales / maxSales) * innerH);
    ctx.fillStyle = "rgba(52,211,153,0.9)";
    ctx.beginPath();
    ctx.arc(x + bw/2, sy, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // legend
  ctx.fillStyle = "rgba(146,160,191,0.9)";
  ctx.font = "12px system-ui";
  ctx.fillText("Bevétel (oszlop) + Eladások száma (zöld pont)", pad, pad-10);
}

function renderChartTab() {
  const cats = [{ id: "all", label_hu: "Összes" }, ...state.doc.categories];
  const catOpts = cats.map((c) => `<option value="${esc(c.id)}"${state.filters.chartCat===c.id?" selected":""}>${esc(c.label_hu || c.id)}</option>`).join("");

  const rows = aggregateByDate(state.filters.chartCat);

  const totalRev = rows.reduce((a,r)=>a+r.revenue,0);
  const totalSales = rows.reduce((a,r)=>a+r.sales,0);
  const totalQty = rows.reduce((a,r)=>a+r.qty,0);

  $("#tab-chart").innerHTML = `
    <div class="form-grid">
      <div class="field third">
        <label>Kategória</label>
        <select id="cCat">${catOpts}</select>
      </div>
      <div class="field full">
        <label>&nbsp;</label>
        <div class="kpi">
          <div class="box"><div class="t">Bevétel</div><div class="v">${totalRev.toLocaleString("hu-HU")} Ft</div></div>
          <div class="box"><div class="t">Eladások</div><div class="v">${totalSales.toLocaleString("hu-HU")}</div></div>
          <div class="box"><div class="t">Darab</div><div class="v">${totalQty.toLocaleString("hu-HU")}</div></div>
        </div>
      </div>
    </div>

    <div style="margin-top:12px;">
      <canvas id="chart" width="1100" height="360" style="width:100%; border-radius:18px; border:1px solid rgba(255,255,255,.06); background: rgba(11,15,23,.25);"></canvas>
    </div>

    <table class="table">
      <thead><tr><th>Dátum</th><th>Bevétel</th><th>Eladások</th><th>Darab</th></tr></thead>
      <tbody>
        ${rows.slice().reverse().map(r => `
          <tr>
            <td><b>${esc(r.date)}</b></td>
            <td>${r.revenue.toLocaleString("hu-HU")} Ft</td>
            <td>${r.sales}</td>
            <td>${r.qty}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $("#cCat").onchange = () => {
    state.filters.chartCat = $("#cCat").value;
    renderChartTab();
  };

  const canvas = $("#chart");
  drawChart(canvas, rows);
}

/* ---------- Init ---------- */
function initTabs() {
  for (const b of $("#tabs").querySelectorAll("button")) {
    b.onclick = () => setTab(b.dataset.tab);
  }
}

$("#reloadBtn").onclick = () => location.reload();

initTabs();
setTab("products");

// indulás: betöltés remote ha van token, különben local
loadAll({ forceRemote: true }).catch((e) => alert(e.message));
