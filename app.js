const $ = (q) => document.querySelector(q);

const loader = $("#loader");
const grid = $("#productGrid");
const emptyState = $("#emptyState");
const pageTitle = $("#pageTitle");
const catButtonsWrap = $("#catButtons");

let categories = [];
let products = [];
let activeCat = "all";

function showLoader() { loader.classList.remove("is-hidden"); }
function hideLoader() { loader.classList.add("is-hidden"); }

async function loadData() {
  showLoader();
  const [catsRes, prodRes] = await Promise.all([
    fetch("./data/categories.json", { cache: "no-store" }),
    fetch("./data/products.json", { cache: "no-store" }),
  ]);

  categories = await catsRes.json();
  products = await prodRes.json();

  renderCategoryButtons();
  render();
  setTimeout(hideLoader, 350); // kis “smooth” anim
}

function renderCategoryButtons() {
  catButtonsWrap.innerHTML = "";
  for (const c of categories) {
    const btn = document.createElement("button");
    btn.className = "nav__btn";
    btn.dataset.cat = c.id;
    btn.textContent = c.name;
    btn.addEventListener("click", () => setCategory(c.id));
    catButtonsWrap.appendChild(btn);
  }

  // active class frissítés
  document.querySelectorAll(".nav__btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.cat === activeCat);
  });
}

function setCategory(catId) {
  activeCat = catId;

  document.querySelectorAll(".nav__btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.cat === activeCat);
  });

  const title =
    catId === "all"
      ? "Összes termék"
      : (categories.find(c => c.id === catId)?.name ?? "Termékek");
  pageTitle.textContent = title;

  render();
}

function render() {
  grid.innerHTML = "";

  const list = activeCat === "all"
    ? products
    : products.filter(p => p.categoryId === activeCat);

  emptyState.hidden = list.length !== 0;

  list.forEach((p, i) => {
    const card = document.createElement("article");
    card.className = "card" + (p.soldOut ? " is-soldout" : "");
    card.style.animationDelay = `${Math.min(i * 35, 220)}ms`;

    card.innerHTML = `
      <img class="card__img" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />
      <div class="card__body">
        <h3 class="card__name">${escapeHtml(p.name)}</h3>
        <p class="card__desc">${escapeHtml(p.description || "")}</p>
        <div class="card__meta">
          <span class="badge">${p.soldOut ? "Elfogyott" : "Elérhető"}</span>
          <span class="stock">${p.soldOut ? "" : `Készlet: ${Number(p.stock ?? 0)} db`}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadData().catch((e) => {
  console.error(e);
  loader.querySelector(".loader__text").textContent = "Hiba a betöltésnél.";
});
