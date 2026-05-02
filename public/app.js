// ── Utilities ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const today = () => new Date().toISOString().split('T')[0];

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.classList.remove('hidden'), 10);
  setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}

// ── Tab Navigation ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => { c.classList.add('hidden'); c.classList.remove('active'); });
    btn.classList.add('active');
    const section = $(`tab-${tab}`);
    section.classList.remove('hidden');
    section.classList.add('active');

    if (tab === 'sales') loadSales();
    if (tab === 'products') loadProducts();
  });
});

// ── Upload & Analisis Screenshot ──────────────────────────────────────────────
const uploadArea = $('uploadArea');
const fileInput = $('fileInput');
const previewImg = $('previewImg');
const uploadPlaceholder = $('uploadPlaceholder');
const analyzeBtn = $('analyzeBtn');
let selectedFile = null;

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) setFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  selectedFile = file;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.classList.remove('hidden');
  uploadPlaceholder.classList.add('hidden');
  analyzeBtn.disabled = false;
}

const loadingSteps = [
  'Memproses gambar...',
  'Membaca teks & angka...',
  'Mengekstrak data transaksi...',
  'Menyusun hasil...',
];

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  const btnText = $('analyzeBtnText');
  analyzeBtn.disabled = true;

  let stepIdx = 0;
  const stepTimer = setInterval(() => {
    stepIdx = (stepIdx + 1) % loadingSteps.length;
    btnText.innerHTML = `<span class="loading"></span> ${loadingSteps[stepIdx]}`;
  }, 1800);
  btnText.innerHTML = `<span class="loading"></span> ${loadingSteps[0]}`;

  try {
    const form = new FormData();
    form.append('screenshot', selectedFile);
    const result = await api('POST', '/api/analyze', form);
    fillForm(result.data);
    showConfidence(result.data.confidence);
    $('resultCard').classList.remove('hidden');
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Screenshot berhasil dianalisis!', 'success');
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    clearInterval(stepTimer);
    btnText.textContent = '🔍 Analisis Screenshot';
    analyzeBtn.disabled = false;
  }
});

function showConfidence(score) {
  const el = $('confidenceBadge');
  if (!el) return;
  const pct = Math.round((score || 0) * 100);
  let cls, label;
  if (pct >= 80) { cls = 'conf-high'; label = `✓ Akurat ${pct}%`; }
  else if (pct >= 55) { cls = 'conf-mid'; label = `⚠ Periksa kembali ${pct}%`; }
  else { cls = 'conf-low'; label = `⚠ Kurang jelas ${pct}% — edit manual`; }
  el.className = `confidence-badge ${cls}`;
  el.textContent = label;
}

// ── Form Hasil Ekstraksi ──────────────────────────────────────────────────────
function fillForm(data) {
  $('rDate').value = data.date || today();
  $('rOrderId').value = data.orderId || '';
  $('rBuyer').value = data.buyerName || '';
  $('rStatus').value = data.status || '';
  $('rShipping').value = data.shippingMethod || '';
  $('rShippingFee').value = data.shippingFee || 0;
  $('rShopeeDiscount').value = data.shopeeDiscount || 0;
  $('rSellerDiscount').value = data.sellerDiscount || 0;
  $('rTotalIncome').value = data.totalIncome || 0;
  $('rNotes').value = data.notes || '';
  renderItems(data.items || []);
}

let currentItems = [];

function renderItems(items) {
  currentItems = items.map(i => ({ ...i }));
  const list = $('itemsList');
  list.innerHTML = '';

  currentItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" placeholder="Nama produk" value="${escHtml(item.productName || '')}" data-idx="${idx}" data-field="productName" />
      <input type="text" placeholder="Varian" value="${escHtml(item.variant || '')}" data-idx="${idx}" data-field="variant" style="max-width:120px" />
      <input type="number" placeholder="Qty" value="${item.quantity || 1}" data-idx="${idx}" data-field="quantity" style="max-width:70px" min="1" />
      <input type="number" placeholder="Harga satuan" value="${item.unitPrice || 0}" data-idx="${idx}" data-field="unitPrice" style="max-width:130px" min="0" />
      <input type="number" placeholder="Subtotal" value="${item.subtotal || 0}" data-idx="${idx}" data-field="subtotal" style="max-width:130px" min="0" />
      <button class="item-delete" data-idx="${idx}" title="Hapus item">&times;</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', e => {
      const i = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      currentItems[i][field] = ['quantity','unitPrice','subtotal'].includes(field)
        ? Number(e.target.value)
        : e.target.value;
    });
  });

  list.querySelectorAll('.item-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      currentItems.splice(Number(e.target.dataset.idx), 1);
      renderItems(currentItems);
    });
  });
}

$('addItemBtn').addEventListener('click', () => {
  currentItems.push({ productName: '', variant: '', quantity: 1, unitPrice: 0, subtotal: 0 });
  renderItems(currentItems);
});

$('resetBtn').addEventListener('click', () => {
  $('resultCard').classList.add('hidden');
  previewImg.classList.add('hidden');
  uploadPlaceholder.classList.remove('hidden');
  analyzeBtn.disabled = true;
  selectedFile = null;
  fileInput.value = '';
  currentItems = [];
});

$('saveBtn').addEventListener('click', async () => {
  const payload = {
    date: $('rDate').value || today(),
    orderId: $('rOrderId').value,
    buyerName: $('rBuyer').value,
    status: $('rStatus').value,
    shippingMethod: $('rShipping').value,
    shippingFee: Number($('rShippingFee').value) || 0,
    shopeeDiscount: Number($('rShopeeDiscount').value) || 0,
    sellerDiscount: Number($('rSellerDiscount').value) || 0,
    totalIncome: Number($('rTotalIncome').value) || 0,
    notes: $('rNotes').value,
    items: currentItems,
  };

  try {
    await api('POST', '/api/sales', payload);
    showToast('Penjualan berhasil disimpan!', 'success');
    $('resetBtn').click();
    // Pindah ke tab Data Penjualan dan tampilkan semua data
    $('filterDate').value = '';
    document.querySelector('.tab-btn[data-tab="sales"]').click();
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
});

// ── Data Penjualan ────────────────────────────────────────────────────────────
$('filterDate').value = today();

$('filterBtn').addEventListener('click', loadSales);
$('clearFilterBtn').addEventListener('click', () => {
  $('filterDate').value = '';
  loadSales();
});

async function loadSales() {
  const date = $('filterDate').value;
  const url = date ? `/api/sales?date=${date}` : '/api/sales';
  try {
    const sales = await api('GET', url);
    renderSalesTable(sales, date);
  } catch (err) {
    showToast('Gagal memuat data: ' + err.message, 'error');
  }
}

function renderSalesTable(sales, date) {
  const wrap = $('salesTable');
  if (!sales.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>
      <p>${date ? `Tidak ada penjualan pada ${fmtDate(date)}` : 'Belum ada data penjualan'}</p></div>`;
    return;
  }

  let total = 0;
  const rows = sales.map(s => {
    total += Number(s.totalIncome) || 0;
    const itemsHtml = (s.items || []).length
      ? (s.items).map(i => {
          const variant = i.variant ? `<span class="item-variant">${escHtml(i.variant)}</span>` : '';
          const qty = `<span class="item-qty">x${i.quantity || 1}</span>`;
          const price = i.unitPrice ? `<span class="item-price">${fmt(i.unitPrice)}</span>` : '';
          const subtotal = i.subtotal ? `<span class="item-subtotal">= ${fmt(i.subtotal)}</span>` : '';
          return `<div class="item-detail-row">${escHtml(i.productName || '-')} ${variant} ${qty} ${price} ${subtotal}</div>`;
        }).join('')
      : '<span style="color:#a0aec0">-</span>';
    return `<tr>
      <td>${fmtDate(s.date)}</td>
      <td><small>${s.orderId || '-'}</small></td>
      <td>${s.buyerName || '-'}</td>
      <td class="items-cell">${itemsHtml}</td>
      <td><span class="tag tag-blue">${s.status || '-'}</span></td>
      <td style="font-weight:600">${fmt(s.totalIncome)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline" onclick="openEditSale('${s.id}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSale('${s.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Tanggal</th><th>No. Pesanan</th><th>Pembeli</th>
      <th>Barang Terjual</th><th>Status</th><th>Total</th><th>Aksi</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="5" style="font-weight:600;padding:10px 12px">Total${date ? ` (${fmtDate(date)})` : ''}</td>
      <td style="font-weight:700;padding:10px 12px">${fmt(total)}</td>
      <td></td>
    </tr></tfoot>
  </table>`;
}

async function deleteSale(id) {
  if (!confirm('Hapus data penjualan ini?')) return;
  try {
    await api('DELETE', `/api/sales/${id}`);
    showToast('Data dihapus', 'success');
    loadSales();
  } catch (err) {
    showToast('Gagal hapus: ' + err.message, 'error');
  }
}

let editSaleId = null;

async function openEditSale(id) {
  try {
    const sales = await api('GET', '/api/sales');
    const s = sales.find(x => x.id === id);
    if (!s) return;
    openManualSaleModal(s);
  } catch (err) {
    showToast('Gagal memuat data: ' + err.message, 'error');
  }
}

$('closeSaleModal').addEventListener('click', () => $('saleModal').classList.add('hidden'));
$('cancelSaleModal').addEventListener('click', () => $('saleModal').classList.add('hidden'));

$('saveSaleModal').addEventListener('click', async () => {
  const payload = {
    date: $('smDate').value,
    orderId: $('smOrderId').value,
    buyerName: $('smBuyer').value,
    status: $('smStatus').value,
    shippingFee: Number($('smShippingFee').value) || 0,
    shopeeDiscount: Number($('smShopeeDiscount').value) || 0,
    sellerDiscount: Number($('smSellerDiscount').value) || 0,
    totalIncome: Number($('smTotalIncome').value) || 0,
    notes: $('smNotes').value,
  };
  try {
    await api('PUT', `/api/sales/${editSaleId}`, payload);
    showToast('Data diperbarui!', 'success');
    $('saleModal').classList.add('hidden');
    loadSales();
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  }
});

// ── Products / Modal ──────────────────────────────────────────────────────────
$('addProductBtn').addEventListener('click', () => openProductModal(null));

let allProducts = [];

async function loadProducts() {
  try {
    allProducts = await api('GET', '/api/products');
    applyProductFilter();
  } catch (err) {
    showToast('Gagal memuat produk: ' + err.message, 'error');
  }
}

function applyProductFilter() {
  const q = ($('productSearch').value || '').toLowerCase().trim();
  const filtered = allProducts
    .filter(p => !q ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));
  renderProductsTable(filtered, q);
}

$('productSearch').addEventListener('input', applyProductFilter);

function renderProductsTable(products, query = '') {
  const wrap = $('productsTable');
  if (!allProducts.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div>
      <p>Belum ada data modal. Klik "+ Tambah Produk" untuk menambahkan.</p></div>`;
    return;
  }
  if (!products.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>
      <p>Tidak ada produk yang cocok dengan "<strong>${escHtml(query)}</strong>"</p></div>`;
    return;
  }

  function highlight(text, q) {
    if (!q || !text) return escHtml(text || '');
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return escHtml(text);
    return escHtml(text.slice(0, idx)) +
      `<mark>${escHtml(text.slice(idx, idx + q.length))}</mark>` +
      escHtml(text.slice(idx + q.length));
  }

  const rows = products.map(p => `<tr>
    <td><strong>${highlight(p.name, query)}</strong>${p.sku ? `<br><small style="color:#718096">SKU: ${highlight(p.sku, query)}</small>` : ''}</td>
    <td>${highlight(p.category || '-', query)}</td>
    <td style="font-weight:600;color:#1d4ed8">${fmt(p.modalPrice)}</td>
    <td>${p.sellingPrice ? fmt(p.sellingPrice) : '-'}</td>
    <td>${p.modalPrice && p.sellingPrice ? Math.round(((p.sellingPrice - p.modalPrice) / p.sellingPrice) * 100) + '%' : '-'}</td>
    <td>
      <div class="action-btns">
        <button class="btn btn-sm btn-outline" onclick="openProductModal('${p.id}')">✏️ Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProduct('${p.id}')">🗑️</button>
      </div>
    </td>
  </tr>`).join('');

  wrap.innerHTML = `
    <div class="table-meta">${products.length} dari ${allProducts.length} produk</div>
    <table>
      <thead><tr>
        <th>Nama Produk</th><th>Kategori</th><th>Modal (HPP)</th>
        <th>Harga Jual</th><th>Margin</th><th>Aksi</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

let editProductId = null;

async function openProductModal(id) {
  editProductId = id;
  $('productModalTitle').textContent = id ? 'Edit Produk' : 'Tambah Produk';
  if (id) {
    try {
      const products = await api('GET', '/api/products');
      const p = products.find(x => x.id === id);
      if (!p) return;
      $('pmId').value = p.id;
      $('pmName').value = p.name || '';
      $('pmSku').value = p.sku || '';
      $('pmModal').value = p.modalPrice || '';
      $('pmSell').value = p.sellingPrice || '';
      $('pmCategory').value = p.category || '';
    } catch (err) {
      showToast('Gagal memuat produk: ' + err.message, 'error');
      return;
    }
  } else {
    $('pmId').value = '';
    $('pmName').value = '';
    $('pmSku').value = '';
    $('pmModal').value = '';
    $('pmSell').value = '';
    $('pmCategory').value = '';
  }
  $('productModal').classList.remove('hidden');
}

$('closeProductModal').addEventListener('click', () => $('productModal').classList.add('hidden'));
$('cancelProductModal').addEventListener('click', () => $('productModal').classList.add('hidden'));

$('saveProductModal').addEventListener('click', async () => {
  const name = $('pmName').value.trim();
  const modal = Number($('pmModal').value);
  if (!name) return showToast('Nama produk wajib diisi', 'error');
  if (!modal || modal <= 0) return showToast('Harga modal wajib diisi', 'error');

  const payload = {
    name,
    sku: $('pmSku').value.trim(),
    modalPrice: modal,
    sellingPrice: Number($('pmSell').value) || 0,
    category: $('pmCategory').value.trim(),
  };

  try {
    if (editProductId) {
      await api('PUT', `/api/products/${editProductId}`, payload);
      showToast('Produk diperbarui!', 'success');
    } else {
      await api('POST', '/api/products', payload);
      showToast('Produk ditambahkan!', 'success');
    }
    $('productModal').classList.add('hidden');
    loadProducts();
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  }
});

async function deleteProduct(id) {
  if (!confirm('Hapus produk ini?')) return;
  try {
    await api('DELETE', `/api/products/${id}`);
    showToast('Produk dihapus', 'success');
    loadProducts();
  } catch (err) {
    showToast('Gagal hapus: ' + err.message, 'error');
  }
}

// ── Laporan ───────────────────────────────────────────────────────────────────
$('reportFrom').value = today().slice(0, 7) + '-01'; // awal bulan
$('reportTo').value = today();

$('generateReport').addEventListener('click', async () => {
  const from = $('reportFrom').value;
  const to = $('reportTo').value;
  if (!from || !to) return showToast('Pilih rentang tanggal', 'error');
  if (from > to) return showToast('Tanggal awal tidak boleh lebih besar dari tanggal akhir', 'error');

  try {
    const report = await api('GET', `/api/report/range?from=${from}&to=${to}`);
    renderReport(report);
    $('reportContent').classList.remove('hidden');
    $('reportContent').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  }
});

function renderReport(r) {
  $('sOmzet').textContent = fmt(r.totalOmzet);
  $('sHPP').textContent = fmt(r.totalHPP);
  $('sGross').textContent = fmt(r.grossProfit);
  $('sMargin').textContent = r.marginPersen + '%';
  $('sTrx').textContent = r.totalTransaksi + ' order';
  $('sDiscount').textContent = fmt(r.totalDiscount);

  $('sGross').style.color = r.grossProfit >= 0 ? '#16a34a' : '#dc2626';

  // Coverage bar
  const total = r.totalUniqueItems || 0;
  const matched = r.matchedCount || 0;
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  const coverageEl = $('modalCoverage');
  if (coverageEl) {
    const barColor = pct === 100 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626';
    coverageEl.innerHTML = `
      <div class="coverage-header">
        <span>Integrasi Data Modal</span>
        <strong style="color:${barColor}">${matched} / ${total} produk (${pct}%)</strong>
      </div>
      <div class="coverage-bar"><div class="coverage-fill" style="width:${pct}%;background:${barColor}"></div></div>
      ${pct < 100 ? `<p class="coverage-hint">Produk belum ada data modal tidak ikut kalkulasi laba. Tambahkan di tab <strong>Data Modal</strong>.</p>` : `<p class="coverage-hint" style="color:#16a34a">Semua produk sudah terhubung dengan data modal.</p>`}
    `;
  }

  // Tabel per produk
  const itemWrap = $('itemReportTable');
  if (!r.itemSummary.length) {
    itemWrap.innerHTML = '<p style="color:#718096;padding:16px 0">Tidak ada data produk</p>';
  } else {
    const rows = r.itemSummary.map(i => {
      const profit = i.matched ? i.revenue - i.hpp : null;
      const margin = i.matched && i.revenue > 0 ? ((profit / i.revenue) * 100).toFixed(1) : null;
      const statusBadge = i.matched
        ? `<span class="badge badge-green">✓ Ada modal</span>`
        : `<span class="badge badge-red">⚠ Belum ada</span>`;
      const profitCell = profit !== null
        ? `<span style="color:${profit >= 0 ? '#16a34a' : '#dc2626'};font-weight:600">${fmt(profit)}</span>`
        : `<span style="color:#a0aec0">-</span>`;
      const marginCell = margin !== null
        ? `<span style="color:${Number(margin) >= 0 ? '#16a34a' : '#dc2626'}">${margin}%</span>`
        : `<span style="color:#a0aec0">-</span>`;
      return `<tr>
        <td>
          <div style="font-weight:500">${escHtml(i.productName)}</div>
          ${i.modalPrice ? `<div style="font-size:11px;color:#718096">Modal/pcs: ${fmt(i.modalPrice)}</div>` : ''}
        </td>
        <td style="text-align:center">${statusBadge}</td>
        <td style="text-align:center;font-weight:600">${i.quantity}</td>
        <td>${fmt(i.revenue)}</td>
        <td>${i.matched ? fmt(i.hpp) : '<span style="color:#a0aec0">-</span>'}</td>
        <td>${profitCell}</td>
        <td>${marginCell}</td>
      </tr>`;
    }).join('');

    itemWrap.innerHTML = `<table>
      <thead><tr>
        <th>Produk</th><th style="text-align:center">Status Modal</th><th style="text-align:center">Qty</th>
        <th>Omzet</th><th>Total Modal</th><th>Profit</th><th>Margin</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // P&L Statement
  const plEl = $('plStatement');
  const profitClass = r.grossProfit >= 0 ? 'profit' : 'loss';
  const unmatchedOmzet = r.itemSummary.filter(i => !i.matched).reduce((s, i) => s + i.revenue, 0);
  plEl.innerHTML = `
    <div class="pl-row section-header">PENDAPATAN</div>
    <div class="pl-row pl-indent"><span>Total Penjualan (Omzet)</span><span>${fmt(r.totalOmzet)}</span></div>
    <div class="pl-row pl-indent"><span>Diskon Shopee &amp; Toko</span><span style="color:#dc2626">- ${fmt(r.totalDiscount)}</span></div>
    <div class="pl-row"><strong>Total Pendapatan Bersih</strong><strong>${fmt(r.totalOmzet)}</strong></div>

    <div class="pl-row section-header">BEBAN POKOK PENJUALAN (HPP)</div>
    <div class="pl-row pl-indent"><span>Modal / Harga Pokok Barang</span><span style="color:#dc2626">- ${fmt(r.totalHPP)}</span></div>
    ${unmatchedOmzet > 0 ? `<div class="pl-row pl-indent" style="color:#c2410c"><span>⚠ Omzet tanpa data modal (belum dihitung)</span><span>${fmt(unmatchedOmzet)}</span></div>` : ''}

    <div class="pl-row total ${profitClass}">
      <span>${r.grossProfit >= 0 ? '✅ LABA KOTOR' : '❌ RUGI KOTOR'}</span>
      <span>${fmt(r.grossProfit)}</span>
    </div>

    <div style="margin-top:16px;padding:12px;background:#f8f9fa;border-radius:8px;font-size:13px;color:#718096">
      <strong style="color:#1a202c">Catatan:</strong> Laporan ini belum memperhitungkan biaya operasional (iklan, ongkir yang ditanggung penjual, dll).
      ${r.matchedCount < r.totalUniqueItems ? `<br><strong style="color:#c2410c">⚠️ ${r.totalUniqueItems - r.matchedCount} produk belum ada data modal — laba yang ditampilkan belum akurat sepenuhnya.</strong>` : ''}
    </div>
  `;
}

// ── Helper Functions ──────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(str) {
  if (!str) return '-';
  const [y, m, d] = str.split('-');
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

// ── Manual Input Penjualan ────────────────────────────────────────────────────
let msItems = [];

function renderMsItems() {
  const list = $('msItemsList');
  list.innerHTML = '';
  msItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" placeholder="Nama produk" value="${escHtml(item.productName || '')}" data-idx="${idx}" data-field="productName" />
      <input type="text" placeholder="Varian" value="${escHtml(item.variant || '')}" data-idx="${idx}" data-field="variant" style="max-width:120px" />
      <input type="number" placeholder="Qty" value="${item.quantity || 1}" data-idx="${idx}" data-field="quantity" style="max-width:70px" min="1" />
      <input type="number" placeholder="Harga satuan" value="${item.unitPrice || 0}" data-idx="${idx}" data-field="unitPrice" style="max-width:130px" min="0" />
      <input type="number" placeholder="Subtotal" value="${item.subtotal || 0}" data-idx="${idx}" data-field="subtotal" style="max-width:130px" min="0" />
      <button class="item-delete" data-idx="${idx}" title="Hapus">&times;</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', e => {
      const i = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      msItems[i][field] = ['quantity','unitPrice','subtotal'].includes(field) ? Number(e.target.value) : e.target.value;
    });
  });
  list.querySelectorAll('.item-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      msItems.splice(Number(e.target.dataset.idx), 1);
      renderMsItems();
    });
  });
}

function openManualSaleModal(sale = null) {
  msItems = sale ? (sale.items || []).map(i => ({ ...i })) : [{ productName: '', variant: '', quantity: 1, unitPrice: 0, subtotal: 0 }];
  $('msEditId').value = sale ? sale.id : '';
  $('manualSaleTitle').textContent = sale ? 'Edit Penjualan' : 'Input Penjualan Manual';
  $('msDate').value = sale ? (sale.date || today()) : today();
  $('msOrderId').value = sale ? (sale.orderId || '') : '';
  $('msBuyer').value = sale ? (sale.buyerName || '') : '';
  $('msStatus').value = sale ? (sale.status || '') : '';
  $('msShipping').value = sale ? (sale.shippingMethod || '') : '';
  $('msShippingFee').value = sale ? (sale.shippingFee || 0) : 0;
  $('msShopeeDiscount').value = sale ? (sale.shopeeDiscount || 0) : 0;
  $('msSellerDiscount').value = sale ? (sale.sellerDiscount || 0) : 0;
  $('msTotalIncome').value = sale ? (sale.totalIncome || 0) : 0;
  $('msNotes').value = sale ? (sale.notes || '') : '';
  renderMsItems();
  $('manualSaleModal').classList.remove('hidden');
}

$('addManualSaleBtn').addEventListener('click', () => openManualSaleModal(null));
$('msAddItemBtn').addEventListener('click', () => {
  msItems.push({ productName: '', variant: '', quantity: 1, unitPrice: 0, subtotal: 0 });
  renderMsItems();
});
$('closeManualSaleModal').addEventListener('click', () => $('manualSaleModal').classList.add('hidden'));
$('cancelManualSaleModal').addEventListener('click', () => $('manualSaleModal').classList.add('hidden'));

$('saveManualSaleModal').addEventListener('click', async () => {
  if (!$('msDate').value) return showToast('Tanggal wajib diisi', 'error');
  const editId = $('msEditId').value;
  const payload = {
    date: $('msDate').value,
    orderId: $('msOrderId').value,
    buyerName: $('msBuyer').value,
    status: $('msStatus').value,
    shippingMethod: $('msShipping').value,
    shippingFee: Number($('msShippingFee').value) || 0,
    shopeeDiscount: Number($('msShopeeDiscount').value) || 0,
    sellerDiscount: Number($('msSellerDiscount').value) || 0,
    totalIncome: Number($('msTotalIncome').value) || 0,
    notes: $('msNotes').value,
    items: msItems,
  };
  try {
    if (editId) {
      await api('PUT', `/api/sales/${editId}`, payload);
      showToast('Data diperbarui!', 'success');
    } else {
      await api('POST', '/api/sales', payload);
      showToast('Penjualan berhasil disimpan!', 'success');
    }
    $('manualSaleModal').classList.add('hidden');
    loadSales();
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
});

// ── Export CSV ────────────────────────────────────────────────────────────────
$('exportCsvBtn').addEventListener('click', async () => {
  const date = $('filterDate').value;
  const url = date ? `/api/sales?date=${date}` : '/api/sales';
  try {
    const sales = await api('GET', url);
    if (!sales.length) return showToast('Tidak ada data untuk diekspor', 'error');

    const headers = ['Tanggal','No. Pesanan','Pembeli','Produk','Status','Ongkir','Diskon Shopee','Diskon Toko','Total Pendapatan','Catatan'];
    const rows = sales.map(s => [
      s.date || '',
      s.orderId || '',
      s.buyerName || '',
      (s.items || []).map(i => `${i.productName}${i.variant ? ` (${i.variant})` : ''} x${i.quantity}`).join('; '),
      s.status || '',
      s.shippingFee || 0,
      s.shopeeDiscount || 0,
      s.sellerDiscount || 0,
      s.totalIncome || 0,
      s.notes || '',
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `penjualan${date ? '_' + date : ''}_${today()}.csv`;
    link.click();
    showToast('Data berhasil diekspor!', 'success');
  } catch (err) {
    showToast('Gagal export: ' + err.message, 'error');
  }
});

// Expose global functions needed by inline onclick handlers
window.openEditSale = openEditSale;
window.deleteSale = deleteSale;
window.openProductModal = openProductModal;
window.deleteProduct = deleteProduct;
