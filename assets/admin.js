let DB = null;
let SALES = null;

/* ===== LOAD / SAVE ===== */

async function loadAll(){
  const p = await GH.readFile("data/products.json");
  DB = JSON.parse(p.contentText);

  const s = await GH.readFile("data/sales.json");
  SALES = JSON.parse(s.contentText);

  renderProducts();
  renderSales();
}

async function saveAll(){
  await GH.writeFile("data/products.json", JSON.stringify(DB,null,2), "Update products");
  await GH.writeFile("data/sales.json", JSON.stringify(SALES,null,2), "Update sales");
  await loadAll();
}

/* ===== PRODUCTS ===== */

function renderProducts(){
  const root = document.getElementById("tabProducts");
  root.innerHTML = "";

  DB.products
    .sort((a,b)=>{
      if(a.nameHu !== b.nameHu) return a.nameHu.localeCompare(b.nameHu);
      return (a.status==="out") - (b.status==="out");
    })
    .forEach(p=>{
      const row = document.createElement("div");
      row.className="panel row";
      row.innerHTML=`
        <div>
          <b>${p.nameHu}</b><br>
          <small>${p.category} | ${p.stock} db | ${p.status}</small>
        </div>
        <div>
          <button class="btn" onclick="editProduct('${p.id}')">✏️</button>
          <button class="btn danger" onclick="deleteProduct('${p.id}')">🗑</button>
        </div>`;
      root.appendChild(row);
    });
}

function editProduct(id){
  const p = DB.products.find(x=>x.id===id);
  p.status = prompt("status (ok / out / soon)", p.status) || p.status;
  saveAll();
}

function deleteProduct(id){
  DB.products = DB.products.filter(p=>p.id!==id);
  saveAll();
}

/* ===== SALES ===== */

function renderSales(){
  const root = document.getElementById("tabSales");
  root.innerHTML="";

  SALES.sales.forEach(s=>{
    const row = document.createElement("div");
    row.className="panel row";
    row.innerHTML=`
      <div>
        <b>${s.customer}</b><br>
        <small>${s.date}</small>
      </div>
      <button class="btn danger" onclick="deleteSale('${s.id}')">Törlés</button>`;
    root.appendChild(row);
  });
}

function deleteSale(id){
  const sale = SALES.sales.find(s=>s.id===id);
  sale.items.forEach(i=>{
    const p = DB.products.find(x=>x.id===i.productId);
    if(p){
      p.stock += i.qty;
      if(p.stock>0 && p.status==="out") p.status="ok";
    }
  });
  SALES.sales = SALES.sales.filter(s=>s.id!==id);
  saveAll();
}

/* ===== INIT ===== */
loadAll();
