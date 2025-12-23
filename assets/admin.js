// Globális változók betöltése
let products = JSON.parse(localStorage.getItem('products')) || [];
let sales = JSON.parse(localStorage.getItem('sales')) || [];

document.addEventListener('DOMContentLoaded', () => {
    // Kezdő inicializálás
    renderProductsTable();
    renderSalesTable();
    updateDashboard();
    initEventListeners();
});

function initEventListeners() {
    // Termék mentés esemény
    const productForm = document.getElementById('productForm');
    if (productForm) productForm.addEventListener('submit', handleProductSave);

    // Eladás mentés esemény
    const saleForm = document.getElementById('saleForm');
    if (saleForm) {
        saleForm.addEventListener('submit', handleSaleSave);
        // Dinamikus sor hozzáadás gomb
        document.getElementById('add-product-row').addEventListener('click', addSaleRow);
    }
}

// --- TERMÉK KEZELÉS ---

function handleProductSave(e) {
    e.preventDefault();
    
    const id = document.getElementById('productId').value || Date.now().toString();
    const name = document.getElementById('productName').value;
    const flavor = document.getElementById('productFlavor').value;
    const price = parseInt(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const image = document.getElementById('productImage').value;
    // FIX: A kiválasztott státusz mindig felülírja az automatikát
    const status = document.getElementById('productStatus').value; 

    const newProduct = { id, name, flavor, price, stock, image, status };

    // Meglévő frissítése vagy új hozzáadása
    const index = products.findIndex(p => p.id === id);
    if (index > -1) {
        products[index] = newProduct;
    } else {
        products.push(newProduct);
    }

    saveData();
    
    // UI Frissítés (nem kell reload)
    renderProductsTable();
    updateDashboard();
    
    // Modal bezárás (Bootstrap módszer)
    const modalEl = document.getElementById('productModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
    
    // Form törlése
    e.target.reset();
    document.getElementById('productId').value = '';
    
    // Kérés volt: "Minden mentés után töltse be a dolgokat" - ez a renderProductsTable() hívással meg is történt azonnal.
}

function editProduct(id) {
    const p = products.find(p => p.id === id);
    if (p) {
        document.getElementById('productId').value = p.id;
        document.getElementById('productName').value = p.name;
        document.getElementById('productFlavor').value = p.flavor;
        document.getElementById('productPrice').value = p.price;
        document.getElementById('productStock').value = p.stock;
        document.getElementById('productImage').value = p.image;
        document.getElementById('productStatus').value = p.status;
        
        const modal = new bootstrap.Modal(document.getElementById('productModal'));
        modal.show();
    }
}

function deleteProduct(id) {
    if (confirm('Biztosan törlöd ezt a terméket?')) {
        products = products.filter(p => p.id !== id);
        saveData();
        renderProductsTable();
        updateDashboard();
    }
}

function resetProductForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
}

// --- ELADÁS KEZELÉS (ÚJ FUNKCIÓK) ---

function prepareSaleModal() {
    // Modal megnyitásakor ürítjük a konténert és adunk egy üres sort
    document.getElementById('sale-items-container').innerHTML = '';
    document.getElementById('saleForm').reset();
    // Mai dátum alapértelmezettnek
    document.getElementById('saleDate').valueAsDate = new Date();
    addSaleRow();
    updateLiveTotal();
}

// Egy új termékválasztó sor hozzáadása a modalhoz
function addSaleRow() {
    const container = document.getElementById('sale-items-container');
    const rowDiv = document.createElement('div');
    rowDiv.className = 'sale-item-row';
    
    // Terméklista generálása (Név szerint rendezve a könnyebb keresésért)
    const sortedProducts = [...products].sort((a,b) => a.name.localeCompare(b.name));
    
    let options = `<option value="" data-price="0">Válassz terméket...</option>`;
    sortedProducts.forEach(p => {
        // Csak azt mutatjuk, ami nincs törölve (státusz nem számít, admin eladhatja)
        options += `<option value="${p.id}" data-price="${p.price}">
            ${p.name} - ${p.flavor} (${p.stock} db) - ${p.price} Ft
        </option>`;
    });

    rowDiv.innerHTML = `
        <div class="flex-grow-1">
            <select class="form-control product-select" required onchange="updateLiveTotal()">
                ${options}
            </select>
        </div>
        <div style="width: 80px;">
            <input type="number" class="form-control quantity-input" value="1" min="1" required oninput="updateLiveTotal()">
        </div>
        <button type="button" class="remove-row-btn" onclick="removeSaleRow(this)">
            <i class="fas fa-times"></i> &times;
        </button>
    `;
    
    container.appendChild(rowDiv);
}

function removeSaleRow(btn) {
    btn.parentElement.remove();
    updateLiveTotal();
}

// Dinamikus végösszeg számolás a modalban
function updateLiveTotal() {
    let total = 0;
    const rows = document.querySelectorAll('.sale-item-row');
    rows.forEach(row => {
        const select = row.querySelector('.product-select');
        const qtyInput = row.querySelector('.quantity-input');
        const price = parseInt(select.options[select.selectedIndex]?.dataset.price || 0);
        const qty = parseInt(qtyInput.value || 0);
        total += price * qty;
    });
    document.getElementById('liveTotal').innerText = total.toLocaleString();
}

function handleSaleSave(e) {
    e.preventDefault();
    
    const date = document.getElementById('saleDate').value;
    const rows = document.querySelectorAll('.sale-item-row');
    let saleItems = [];
    let saleTotal = 0;
    
    // Adatok validálása és összegyűjtése
    for (const row of rows) {
        const select = row.querySelector('.product-select');
        const qty = parseInt(row.querySelector('.quantity-input').value);
        const productId = select.value;
        
        if (!productId) continue;
        
        const product = products.find(p => p.id === productId);
        if (product) {
            // FIX: Nem tiltjuk le az eladást, ha nincs készlet, de figyelmeztethetünk (opcionális)
            // Készlet csökkentése AZONNAL
            product.stock -= qty;
            
            saleItems.push({
                productId: product.id,
                name: product.name,
                flavor: product.flavor,
                quantity: qty,
                price: product.price
            });
            saleTotal += product.price * qty;
        }
    }
    
    if (saleItems.length === 0) {
        alert('Nem választottál ki terméket!');
        return;
    }

    const newSale = {
        id: Date.now().toString(),
        date: date,
        items: saleItems,
        total: saleTotal
    };
    
    sales.push(newSale);
    saveData();
    
    // UI Frissítés AZONNAL (készlet is frissül a táblázatban)
    renderSalesTable();
    renderProductsTable();
    updateDashboard();
    
    const modalEl = document.getElementById('saleModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
    
    alert('Eladás sikeresen rögzítve!');
}

function deleteSale(saleId) {
    if (!confirm('Törlöd az eladást? A készletek vissza lesznek töltve!')) return;
    
    const saleIndex = sales.findIndex(s => s.id === saleId);
    if (saleIndex === -1) return;
    
    const sale = sales[saleIndex];
    
    // FIX: Készlet VISSZATÖLTÉSE a termékekbe
    sale.items.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        if (product) {
            product.stock += parseInt(item.quantity);
        }
    });
    
    sales.splice(saleIndex, 1);
    saveData();
    
    // Minden táblázat frissítése
    renderSalesTable();
    renderProductsTable();
    updateDashboard();
}

// --- RENDERELŐ FÜGGVÉNYEK ---

function renderProductsTable() {
    const tbody = document.querySelector('#productsTable tbody');
    tbody.innerHTML = '';
    
    // Rendezés név szerint
    const sorted = [...products].sort((a,b) => a.name.localeCompare(b.name));
    
    sorted.forEach(p => {
        tbody.innerHTML += `
            <tr>
                <td><img src="${p.image}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;"></td>
                <td class="fw-bold">${p.name}</td>
                <td>${p.flavor}</td>
                <td>${p.price.toLocaleString()} Ft</td>
                <td class="${p.stock <= 5 ? 'text-danger fw-bold' : ''}">${p.stock} db</td>
                <td><span class="badge bg-${getStatusColor(p.status, p.stock)}">${p.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editProduct('${p.id}')">Szerk.</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct('${p.id}')">Törlés</button>
                </td>
            </tr>
        `;
    });
}

function getStatusColor(status, stock) {
    if (status === 'hamarosan') return 'warning';
    if (status === 'elfogyott' || stock <= 0) return 'danger';
    return 'success';
}

function renderSalesTable() {
    const tbody = document.querySelector('#salesTable tbody');
    tbody.innerHTML = '';
    
    // Rendezés: Legújabb elöl
    const sorted = [...sales].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    sorted.forEach(s => {
        // FIX: Csak dátum, óra nélkül
        const dateStr = new Date(s.date).toLocaleDateString('hu-HU');
        
        let itemsHtml = s.items.map(i => 
            `<div class="small">• ${i.quantity}x ${i.name} ${i.flavor}</div>`
        ).join('');
        
        tbody.innerHTML += `
            <tr>
                <td>${dateStr}</td>
                <td>${itemsHtml}</td>
                <td class="fw-bold">${s.total.toLocaleString()} Ft</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteSale('${s.id}')">Törlés</button>
                </td>
            </tr>
        `;
    });
}

function updateDashboard() {
    // Bevétel
    const totalRev = sales.reduce((sum, s) => sum + s.total, 0);
    document.getElementById('totalRevenue').innerText = totalRev.toLocaleString() + ' Ft';
    
    // Terméktípusok száma
    document.getElementById('productsCount').innerText = products.length;
    
    // Eladások száma
    document.getElementById('salesCount').innerText = sales.length;
}

function saveData() {
    localStorage.setItem('products', JSON.stringify(products));
    localStorage.setItem('sales', JSON.stringify(sales));
}
