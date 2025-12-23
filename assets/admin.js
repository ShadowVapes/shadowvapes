/* assets/admin.js */
(() => {
  const $ = (id) => document.getElementById(id);

  const LS = {
    settings: "sv_settings",
    products: "sv_products_json",
    sales: "sv_sales_json",
  };

  const defaults = {
    owner: "",
    repo: "",
    branch: "main",
    token: "",
    productsPath: "data/products.json",
    salesPath: "data/sales.json",
  };

  const state = {
    settings: loadSettings(),
    data: { categories: [], products: [], sales: [] },
    selectedProductId: null,
  };

  function loadSettings() {
    const raw = localStorage.getItem(LS.settings);
    const s = raw ? safeJson(raw) : {};
    return { ...defaults, ...(s || {}) };
  }
  function saveSettings(partial) {
    state.settings = { ...state.settings, ...(partial || {}) };
    localStorage.setItem(LS.settings, JSON.stringify(state.settings));
    renderMode();
  }

  function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
  }
  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function setSaveState(type, text) {
    const dot = $("saveDot");
    const t = $("saveText");
    if (!dot || !t) return;

    dot.classList.remove("ok", "busy", "bad");
    if (type === "ok") dot.classList.add("ok");
    else if (type === "busy") dot.classList.add("busy");
    else if (type === "bad") dot.classList.add("bad");
    t.textContent = text || "";
  }

  function githubEnabled() {
    const s = state.settings;
    return !!(s.owner && s.repo && s.branch && s.token);
  }

  function orderCategories(list) {
    const all = "Összes termék";
    const soon = "Hamarosan";
    const uniq = Array.from(new Set(list.map((x) => String(x).trim()).filter(Boolean)));

    const middle = uniq.filter((c) => c !== all && c !== soon).sort((a, b) => a.localeCompare(b, "hu"));
    return [all, ...middle, soon];
  }

  function ensureBaseCats(cats) {
    const base = orderCategories(["Összes termék", ...(cats || []), "Hamarosan"]);
    return base;
  }

  function parseProductsJson(raw) {
    if (Array.isArray(raw)) {
      const products = raw;
      const categories = ensureBaseCats(products.map((p) => p.category || p.kategoria).filter(Boolean));
      return { categories, products };
    }
    const products = Array.isArray(raw?.products) ? raw.products : [];
    const categories = ensureBaseCats(raw?.categories || []);
    return { categories, products };
  }

  function parseSalesJson(raw) {
    if (Array.isArray(raw)) return { sales: raw };
    return { sales: Array.isArray(raw?.sales) ? raw.sales : [] };
  }

  function toProductsJson() {
    return { categories: state.data.categories, products: state.data.products };
  }
  function toSalesJson() {
    return { sales: state.data.sales };
  }

  async function loadAll() {
    setSaveState("busy", "Betöltés...");
    const s = state.settings;

    // 1) ha van GitHub config, API-ból olvasunk (azonnali, nincs CDN cache)
    if (githubEnabled() && window.SV_GH) {
      try {
        const pRaw = await window.SV_GH.readJson({
          owner: s.owner, repo: s.repo, branch: s.branch, token: s.token, path: s.productsPath
        });
        const sRaw = await window.SV_GH.readJson({
          owner: s.owner, repo: s.repo, branch: s.branch, token: s.token, path: s.salesPath
        });

        const p = parseProductsJson(pRaw);
        const sa = parseSalesJson(sRaw);

        state.data.categories = ensureBaseCats(p.categories);
        state.data.products = (p.products || []).map(fixProduct);
        state.data.sales = (sa.sales || []).map(fixSale);

        setSaveState("ok", "Készen");
        renderAll();
        return;
      } catch (e) {
        console.error(e);
        setSaveState("bad", "GitHub betöltés hiba – local mód");
      }
    }

    // 2) fallback: localStorage
    const lp = localStorage.getItem(LS.products);
    const ls = localStorage.getItem(LS.sales);

    if (lp) {
      const p = parseProductsJson(safeJson(lp) || []);
      state.data.categories = ensureBaseCats(p.categories);
      state.data.products = (p.products || []).map(fixProduct);
    } else {
      // 3) fallback: oldalról fetch
      try {
        const pRes = await fetch(`${s.productsPath}?ts=${Date.now()}`, { cache: "no-store" });
        const pRaw = await pRes.json();
        const p = parseProductsJson(pRaw);
        state.data.categories = ensureBaseCats(p.categories);
        state.data.products = (p.products || []).map(fixProduct);
      } catch {}
    }

    if (ls) {
      const sa = parseSalesJson(safeJson(ls) || []);
      state.data.sales = (sa.sales || []).map(fixSale);
    } else {
      try {
        const sRes = await fetch(`${s.salesPath}?ts=${Date.now()}`, { cache: "no-store" });
        const sRaw = await sRes.json();
        const sa = parseSalesJson(sRaw);
        state.data.sales = (sa.sales || []).map(fixSale);
      } catch {
        state.data.sales = [];
      }
    }

    setSaveState("ok", "Készen");
    renderAll();
  }

  function fixProduct(p) {
    const out = { ...p };
    if (!out.id) out.id = uid();
    if (!out.status) out.status = "ok";
    if (!("statusLocked" in out)) {
      // ha valaki "soon"-t állított régen is, legyen lock
      out.statusLocked = String(out.status).toLowerCase() === "soon";
    }
    out.stock = Number.isFinite(+out.stock) ? +out.stock : (+out.keszlet || 0);
    out.price = Number.isFinite(+out.price) ? +out.price : (+out.ar || 0);
    out.category = out.category || out.kategoria || "Összes termék";
    out.image = out.image || out.img || out.kep || "";
    // name/flavor modern mezők
    out.name = out.name || out.nev || out.name || "";
    out.flavor = out.flavor || out.iz || out.flavor || "";
    // object form támogatás
    if (!out.nameHU && out.name && typeof out.name === "object") {
      // ok
    }
    return out;
  }

  function fixSale(s) {
    const out = { ...s };
    if (!out.id) out.id = uid();
    if (!out.date) out.date = today();
    out.items = Array.isArray(out.items) ? out.items : [];
    out.total = Number.isFinite(+out.total) ? +out.total : calcSaleTotal(out);
    return out;
  }

  function today() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function saveAll(reason) {
    setSaveState("busy", "Mentés...");
    const s = state.settings;

    // mentés előtt rendezzük a kategóriákat fixre
    state.data.categories = ensureBaseCats(state.data.categories);

    // 1) GitHub mentés
    if (githubEnabled() && window.SV_GH) {
      try {
        await window.SV_GH.writeJson({
          owner: s.owner, repo: s.repo, branch: s.branch, token: s.token, path: s.productsPath,
          message: reason || "Update products"
        }, toProductsJson());

        await window.SV_GH.writeJson({
          owner: s.owner, repo: s.repo, branch: s.branch, token: s.token, path: s.salesPath,
          message: reason || "Update sales"
        }, toSalesJson());

        // mentés után AZONNAL újratölt API-ból (kérésed!)
        await loadAll();
        setSaveState("ok", "Mentve + reload ✅");
        return;
      } catch (e) {
        console.error(e);
        setSaveState("bad", "GitHub mentés hiba – local mentem");
      }
    }

    // 2) localStorage mentés
    localStorage.setItem(LS.products, JSON.stringify(toProductsJson(), null, 2));
    localStorage.setItem(LS.sales, JSON.stringify(toSalesJson(), null, 2));
    setSaveState("ok", "Local mentve ✅");
    renderAll();
  }

  // ===== UI =====
  function switchTab(tab) {
    document.querySelectorAll("#tabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    ["products", "categories", "sales", "settings"].forEach((t) => {
      const panel = $(`panel-${t}`);
      if (panel) panel.style.display = t === tab ? "" : "none";
    });
  }

  function renderMode() {
    const el = $("modeText");
    if (!el) return;
    el.textContent = githubEnabled()
      ? `GitHub mód: ${state.settings.owner}/${state.settings.repo}@${state.settings.branch}`
      : `Local mód: nincs GitHub token/config (de működik szerkesztés)`;
  }

  function renderAll() {
    renderMode();
    renderCategorySelect();
    renderProductsList();
    renderCategoriesList();
    renderSalesUI();
  }

  function renderCategorySelect() {
    const sel = $("p-category");
    if (!sel) return;
    sel.innerHTML = "";
    state.data.categories.forEach((c) => {
      if (c === "Összes termék") return; // terméknek nem kell "All" kategória
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
  }

  function getNameHu(p) {
    if (p?.name && typeof p.name === "object") return p.name.hu || p.name.en || "";
    return p.nameHu || p.nameHU || p.name || p.nev || "";
  }
  function getNameEn(p) {
    if (p?.name && typeof p.name === "object") return p.name.en || p.name.hu || "";
    return p.nameEn || p.nameEN || "";
  }
  function getFlavorHu(p) {
    if (p?.flavor && typeof p.flavor === "object") return p.flavor.hu || p.flavor.en || "";
    return p.flavorHu || p.flavorHU || p.flavor || p.iz || "";
  }
  function getFlavorEn(p) {
    if (p?.flavor && typeof p.flavor === "object") return p.flavor.en || p.flavor.hu || "";
    return p.flavorEn || p.flavorEN || "";
  }
  function setTextObj(p, key, huVal, enVal) {
    p[key] = { hu: String(huVal || "").trim(), en: String(enVal || "").trim() };
  }

  function renderProductsList() {
    const wrap = $("productsList");
    if (!wrap) return;

    const q = norm($("p-search")?.value || "");
    const products = state.data.products
      .slice()
      .filter((p) => {
        if (!q) return true;
        const s = `${getNameHu(p)} ${getFlavorHu(p)} ${p.category}`.toLowerCase();
        return s.includes(q);
      })
      // azonos nevűek egymás mellett admin listában is
      .sort((a, b) => norm(getNameHu(a)).localeCompare(norm(getNameHu(b)), "hu"));

    wrap.innerHTML = "";
    products.forEach((p) => {
      const row = document.createElement("div");
      row.className = "rowline";
      const status = (p.status || "ok").toLowerCase();
      const stock = +p.stock || 0;

      row.innerHTML = `
        <div class="left">
          <b>${escapeHtml(getNameHu(p) || "Névtelen")} — <span class="small-muted">${escapeHtml(getFlavorHu(p))}</span></b>
          <span class="small-muted">${escapeHtml(p.category)} • státusz: ${status} • készlet: ${Math.max(0, stock)} • ár: ${fmtFt(p.price)} Ft</span>
        </div>
        <button class="ghost">Szerkeszt</button>
      `;

      row.onclick = () => loadProductToForm(p.id);
      wrap.appendChild(row);
    });
  }

  function loadProductToForm(id) {
    const p = state.data.products.find((x) => x.id === id);
    if (!p) return;
    state.selectedProductId = id;

    $("p-id").value = p.id;
    $("p-name-hu").value = getNameHu(p);
    $("p-name-en").value = getNameEn(p);
    $("p-flavor-hu").value = getFlavorHu(p);
    $("p-flavor-en").value = getFlavorEn(p);
    $("p-category").value = p.category || state.data.categories.find((c) => c !== "Összes termék") || "";
    $("p-status").value = (p.status || "ok").toLowerCase();
    $("p-price").value = Number.isFinite(+p.price) ? +p.price : 0;
    $("p-stock").value = Number.isFinite(+p.stock) ? +p.stock : 0;
    $("p-image").value = p.image || "";

    $("p-delete").disabled = false;
  }

  function clearProductForm() {
    state.selectedProductId = null;
    $("p-id").value = "";
    $("p-name-hu").value = "";
    $("p-name-en").value = "";
    $("p-flavor-hu").value = "";
    $("p-flavor-en").value = "";
    $("p-status").value = "ok";
    $("p-price").value = 0;
    $("p-stock").value = 0;
    $("p-image").value = "";
    $("p-delete").disabled = true;

    // default category
    const sel = $("p-category");
    if (sel && sel.options.length) sel.value = sel.options[0].value;
  }

  async function upsertProductFromForm() {
    const id = $("p-id").value.trim() || uid();
    const nameHu = $("p-name-hu").value.trim();
    const nameEn = $("p-name-en").value.trim();
    const flHu = $("p-flavor-hu").value.trim();
    const flEn = $("p-flavor-en").value.trim();
    const category = $("p-category").value;
    const status = $("p-status").value;
    const price = +$("p-price").value || 0;
    const stock = +$("p-stock").value || 0;
    const image = $("p-image").value.trim();

    if (!nameHu) {
      setSaveState("bad", "Név (HU) kötelező");
      return;
    }
    if (!category) {
      setSaveState("bad", "Kategória kötelező");
      return;
    }

    let p = state.data.products.find((x) => x.id === id);
    const isNew = !p;
    if (!p) p = { id };

    setTextObj(p, "name", nameHu, nameEn);
    setTextObj(p, "flavor", flHu, flEn);

    p.category = category;
    p.price = Math.max(0, price);
    p.stock = Math.max(0, stock);
    p.image = image;

    // státusz fix: ha admin állítja, akkor tényleg mentse + működjön
    p.status = status;
    if (status === "ok") p.statusLocked = false;
    else p.statusLocked = true;

    // ha ok + készlet 0, akkor auto out (de csak ha nincs lock)
    if (p.status === "ok" && p.stock <= 0) {
      p.status = "out";
      p.statusLocked = false;
    }

    if (isNew) state.data.products.push(p);

    // azonnali UI friss (kérésed: ne legyen “lassú”)
    renderAll();
    await saveAll(isNew ? "Add product" : "Update product");
    clearProductForm();
  }

  async function deleteSelectedProduct() {
    const id = state.selectedProductId;
    if (!id) return;
    state.data.products = state.data.products.filter((p) => p.id !== id);
    renderAll();
    await saveAll("Delete product");
    clearProductForm();
  }

  function renderCategoriesList() {
    const wrap = $("categoriesList");
    if (!wrap) return;

    wrap.innerHTML = "";
    state.data.categories.forEach((c) => {
      const row = document.createElement("div");
      row.className = "rowline";
      const locked = c === "Összes termék" || c === "Hamarosan";

      row.innerHTML = `
        <div class="left">
          <b>${escapeHtml(c)}</b>
          <span class="small-muted">${locked ? "Fix kategória" : ""}</span>
        </div>
        <button class="${locked ? "ghost" : "danger"}" ${locked ? "disabled" : ""}>Törlés</button>
      `;

      const btn = row.querySelector("button");
      if (!locked) {
        btn.onclick = async (e) => {
          e.stopPropagation();
          // termékeknél a törölt kategóriát dobjuk default-ra
          state.data.products.forEach((p) => {
            if (p.category === c) p.category = state.data.categories.find((x) => x !== "Összes termék" && x !== "Hamarosan") || "Hamarosan";
          });
          state.data.categories = ensureBaseCats(state.data.categories.filter((x) => x !== c));
          renderAll();
          await saveAll("Delete category");
        };
      }
      wrap.appendChild(row);
    });
  }

  async function addCategory() {
    const v = $("c-new").value.trim();
    if (!v) return;
    const exists = state.data.categories.some((c) => norm(c) === norm(v));
    if (exists) {
      setSaveState("bad", "Már van ilyen kategória");
      return;
    }
    state.data.categories = ensureBaseCats([...state.data.categories, v]);
    $("c-new").value = "";
    renderAll();
    await saveAll("Add category");
  }

  // ===== SALES =====
  function calcSaleTotal(sale) {
    return (sale.items || []).reduce((sum, it) => sum + (+(it.qty || 0)) * (+(it.unitPrice || 0)), 0);
  }

  function productOptionsHtml(selectedId) {
    const products = state.data.products
      .slice()
      .filter((p) => String(p.status || "ok").toLowerCase() !== "soon")
      .sort((a, b) => norm(getNameHu(a)).localeCompare(norm(getNameHu(b)), "hu"));

    return products
      .map((p) => {
        const label = `${getNameHu(p)} — ${getFlavorHu(p)} (készlet: ${Math.max(0, +p.stock || 0)})`;
        return `<option value="${escapeAttr(p.id)}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function renderSalesUI() {
    renderKpi();
    renderSaleForm();
    renderSalesTable();
  }

  function renderKpi() {
    const k = $("kpi");
    if (!k) return;

    const totalRevenue = state.data.sales.reduce((sum, s) => sum + (+(s.total || 0)), 0);
    const totalSales = state.data.sales.length;
    const totalItems = state.data.sales.reduce((sum, s) => sum + (s.items || []).reduce((a, it) => a + (+(it.qty || 0)), 0), 0);

    k.innerHTML = `
      <div class="box"><div class="t">Bevétel</div><div class="v">${fmtFt(totalRevenue)} Ft</div></div>
      <div class="box"><div class="t">Eladások száma</div><div class="v">${totalSales} db</div></div>
      <div class="box"><div class="t">Termékek száma (összes tétel)</div><div class="v">${totalItems} db</div></div>
    `;
  }

  function renderSaleForm() {
    const wrap = $("saleItems");
    if (!wrap) return;

    if (!$("sale-date").value) $("sale-date").value = today();

    // ha üres, legyen 1 sor
    if (!wrap.dataset.init) {
      wrap.dataset.init = "1";
      wrap._items = [{ productId: firstSellableProductId(), qty: 1 }];
    }

    const items = wrap._items || [];
    wrap.innerHTML = "";

    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "rowline";

      row.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; width:100%;">
          <select data-k="pid" style="min-width:320px; flex:1; border-radius:14px; border:1px solid rgba(255,255,255,.08); background: rgba(11,15,23,.45); color: var(--text); padding: 10px 12px;">
            ${productOptionsHtml(it.productId)}
          </select>

          <input data-k="qty" type="number" min="1" step="1" value="${Math.max(1, +it.qty || 1)}"
            style="width:110px; border-radius:14px; border:1px solid rgba(255,255,255,.08); background: rgba(11,15,23,.45); color: var(--text); padding: 10px 12px;" />

          <button class="danger" data-k="rm" style="white-space:nowrap;">Törlés</button>
        </div>
      `;

      const sel = row.querySelector('select[data-k="pid"]');
      const qty = row.querySelector('input[data-k="qty"]');
      const rm = row.querySelector('button[data-k="rm"]');

      sel.onchange = () => { it.productId = sel.value; };
      qty.oninput = () => { it.qty = Math.max(1, +qty.value || 1); };
      rm.onclick = () => {
        wrap._items = (wrap._items || []).filter((_, i) => i !== idx);
        if (wrap._items.length === 0) wrap._items = [{ productId: firstSellableProductId(), qty: 1 }];
        renderSaleForm();
      };

      wrap.appendChild(row);
    });
  }

  function firstSellableProductId() {
    const p = state.data.products.find((x) => String(x.status || "ok").toLowerCase() !== "soon");
    return p ? p.id : "";
  }

  async function addSale() {
    const date = $("sale-date").value || today();
    const wrap = $("saleItems");
    const draft = (wrap._items || []).filter((x) => x.productId);

    if (!draft.length) {
      setSaveState("bad", "Adj hozzá legalább 1 tételt");
      return;
    }

    // gyors UI: előbb in-memory levonás + render, aztán mentés
    const sale = { id: uid(), date, items: [], total: 0 };

    for (const d of draft) {
      const p = state.data.products.find((x) => x.id === d.productId);
      if (!p) continue;

      if (String(p.status || "ok").toLowerCase() === "soon") continue;

      const qty = Math.max(1, +d.qty || 1);
      if ((+p.stock || 0) < qty) {
        setSaveState("bad", `Nincs elég készlet: ${getNameHu(p)} (${p.stock} db)`);
        return;
      }

      const unitPrice = +p.price || 0;

      // készlet levonás
      p.stock = (+p.stock || 0) - qty;

      // ha nem manuál locked, és elfogy -> out
      if (!p.statusLocked && (+p.stock || 0) <= 0) {
        p.status = "out";
      }

      sale.items.push({
        productId: p.id,
        name: getNameHu(p),
        flavor: getFlavorHu(p),
        qty,
        unitPrice,
      });
    }

    sale.total = calcSaleTotal(sale);
    state.data.sales.unshift(sale);

    // instant refresh (ne legyen “lassú”)
    renderAll();

    // reset sale form
    $("saleItems")._items = [{ productId: firstSellableProductId(), qty: 1 }];
    renderSaleForm();

    await saveAll("Add sale");
  }

  async function deleteSale(id) {
    const sale = state.data.sales.find((s) => s.id === id);
    if (!sale) return;

    // rollback készlet
    for (const it of sale.items || []) {
      const p = state.data.products.find((x) => x.id === it.productId);
      if (!p) continue;

      p.stock = (+p.stock || 0) + (+it.qty || 0);

      // ha auto-out volt és visszajött készlet, menjen ok-ra (de csak ha nincs manuális lock)
      if (!p.statusLocked && (+p.stock || 0) > 0 && String(p.status).toLowerCase() === "out") {
        p.status = "ok";
      }
    }

    // sales törlés
    state.data.sales = state.data.sales.filter((s) => s.id !== id);

    // instant refresh
    renderAll();
    await saveAll("Delete sale");
  }

  function renderSalesTable() {
    const body = $("salesTable");
    if (!body) return;

    const sales = state.data.sales
      .slice()
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    $("salesCount").textContent = `${sales.length} db`;

    body.innerHTML = "";
    sales.forEach((s) => {
      const tr = document.createElement("tr");
      const itemsTxt = (s.items || [])
        .map((it) => `${it.qty}× ${it.name}${it.flavor ? " — " + it.flavor : ""}`)
        .join("<br>");

      tr.innerHTML = `
        <td>${escapeHtml(s.date || "")}</td>
        <td>${itemsTxt}</td>
        <td><b>${fmtFt(+s.total || 0)} Ft</b></td>
        <td style="text-align:right;"><button class="danger">Törlés</button></td>
      `;
      tr.querySelector("button").onclick = () => deleteSale(s.id);
      body.appendChild(tr);
    });
  }

  // ===== HELPERS =====
  function fmtFt(n) {
    return new Intl.NumberFormat("hu-HU").format(Math.round(n || 0));
  }
  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function escapeAttr(s) {
    return String(s || "").replaceAll('"', "&quot;");
  }

  // ===== EVENTS =====
  function bind() {
    // tabs
    document.querySelectorAll("#tabs button").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.tab));
    });

    // product actions
    $("p-save").onclick = () => upsertProductFromForm();
    $("p-clear").onclick = () => clearProductForm();
    $("p-delete").onclick = () => deleteSelectedProduct();

    $("p-search").oninput = () => renderProductsList();

    // categories
    $("c-add").onclick = () => addCategory();

    // sales
    $("sale-add-item").onclick = () => {
      const wrap = $("saleItems");
      wrap._items = wrap._items || [];
      wrap._items.push({ productId: firstSellableProductId(), qty: 1 });
      renderSaleForm();
    };
    $("sale-save").onclick = () => addSale();

    // settings
    $("s-save").onclick = async () => {
      saveSettings({
        owner: $("s-owner").value.trim(),
        repo: $("s-repo").value.trim(),
        branch: $("s-branch").value.trim() || "main",
        token: $("s-token").value.trim(),
        productsPath: $("s-products-path").value.trim() || "data/products.json",
        salesPath: $("s-sales-path").value.trim() || "data/sales.json",
      });
      setSaveState("ok", "Beállítások mentve");
      await loadAll();
    };

    $("s-test").onclick = () => loadAll();

    // fill settings inputs
    $("s-owner").value = state.settings.owner;
    $("s-repo").value = state.settings.repo;
    $("s-branch").value = state.settings.branch;
    $("s-token").value = state.settings.token;
    $("s-products-path").value = state.settings.productsPath;
    $("s-sales-path").value = state.settings.salesPath;
  }

  async function init() {
    // ha valami DOM id hiányzik, ne haljon meg csöndben
    const must = ["tabs","panel-products","panel-categories","panel-sales","panel-settings","p-save","c-add","sale-save","s-save"];
    for (const id of must) {
      if (!$(id)) console.warn("Hiányzó elem:", id);
    }

    bind();
    switchTab("products");
    clearProductForm();
    await loadAll();
    setSaveState("ok", "Készen");
  }

  init().catch((e) => {
    console.error(e);
    setSaveState("bad", "Admin JS hiba – nézd a konzolt");
  });
})();
