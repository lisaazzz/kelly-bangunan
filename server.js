require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak request analisis. Coba lagi dalam 1 menit.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ── File Upload ───────────────────────────────────────────────────────────────
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Format tidak didukung. Gunakan JPG, PNG, atau WEBP.'));
    }
    cb(null, true);
  },
});

// ── Anthropic Client ──────────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── AI Pipeline ───────────────────────────────────────────────────────────────
const FULL_PROMPT = (today) => `You are an expert OCR system for Indonesian Shopee e-commerce screenshots.

Extract ALL transaction data and return ONLY a single JSON object — no markdown, no explanation.

SHOPEE LAYOUTS you may see:
- Seller app "Rincian Pesanan": has buyer name, product list, payment breakdown
- Buyer app order detail: payment summary at bottom
- Shopee web desktop: order management table
- Partial/notification screenshots: extract whatever is visible

FIELD EXTRACTION GUIDE:
- date: ORDER date (not shipping date). Formats: "24 Apr 2026 17:13", "24/04/2026", "2026-04-24". Convert to YYYY-MM-DD. Default: ${today}
- orderId: Order number (long numeric string, may have dots). Example: 250424XXXXXXXXX
- buyerName: Customer name
- status: Exact status text. Examples: "Pesanan Selesai", "Dikirim", "Diproses", "Selesai"
- items: Every product in this order
  - productName: Full product name as shown
  - variant: Color/size/type variant if shown, else empty string
  - quantity: Number of units (integer)
  - unitPrice: Price per unit in IDR (integer, no dots/commas)
  - subtotal: quantity × unitPrice (integer)
- shippingFee: "Subtotal Ongkos Kirim" — seller's shipping cost (integer)
- shopeeDiscount: "Voucher Shopee" / "Diskon Shopee" / "Biaya Lainnya" as positive integer
- sellerDiscount: "Diskon Toko" / "Voucher Toko" as positive integer
- totalIncome: "Penghasilan Akhir" or "Total yang kamu terima" — what seller actually receives (integer)
- shippingMethod: Courier name (JNE, J&T, Sicepat, SPX, etc.)
- confidence: Your accuracy score 0.0–1.0 (based on image clarity + data completeness)

Rules:
- All amounts: IDR integers only, no dots, no commas, no "Rp"
- Missing fields: use null for strings, 0 for numbers, [] for arrays
- If image is blurry/partial: extract what you can and set lower confidence

JSON schema (return exactly this structure):
{
  "date": "YYYY-MM-DD",
  "orderId": null,
  "buyerName": null,
  "status": null,
  "items": [{"productName": "", "variant": "", "quantity": 1, "unitPrice": 0, "subtotal": 0}],
  "shippingFee": 0,
  "shopeeDiscount": 0,
  "sellerDiscount": 0,
  "totalIncome": 0,
  "shippingMethod": null,
  "notes": null,
  "confidence": 0.9
}`;

const FALLBACK_PROMPT = (today) => `Read this Shopee screenshot and extract ONLY these critical fields. Return ONLY JSON.

Focus on:
1. Total income seller received ("Penghasilan Akhir" / "Total Pendapatan")
2. Product names and quantities
3. Order date (convert to YYYY-MM-DD, default: ${today})
4. Order ID if visible

{"date":"YYYY-MM-DD","orderId":null,"buyerName":null,"status":null,"items":[{"productName":"","variant":"","quantity":1,"unitPrice":0,"subtotal":0}],"shippingFee":0,"shopeeDiscount":0,"sellerDiscount":0,"totalIncome":0,"shippingMethod":null,"notes":null,"confidence":0.5}`;

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim().slice(0, 500);
}

function normalizeExtracted(raw) {
  return {
    date: raw.date || new Date().toISOString().split('T')[0],
    orderId: sanitizeString(raw.orderId) || null,
    buyerName: sanitizeString(raw.buyerName) || null,
    status: sanitizeString(raw.status) || null,
    items: Array.isArray(raw.items) ? raw.items.map(i => ({
      productName: sanitizeString(i.productName) || '',
      variant: sanitizeString(i.variant) || '',
      quantity: Math.max(1, parseInt(i.quantity) || 1),
      unitPrice: Math.max(0, parseInt(i.unitPrice) || 0),
      subtotal: Math.max(0, parseInt(i.subtotal) || 0),
    })) : [],
    shippingFee: Math.max(0, parseInt(raw.shippingFee) || 0),
    shopeeDiscount: Math.max(0, parseInt(raw.shopeeDiscount) || 0),
    sellerDiscount: Math.max(0, parseInt(raw.sellerDiscount) || 0),
    totalIncome: Math.max(0, parseInt(raw.totalIncome) || 0),
    shippingMethod: sanitizeString(raw.shippingMethod) || null,
    notes: sanitizeString(raw.notes) || null,
    confidence: Math.min(1, Math.max(0, parseFloat(raw.confidence) || 0.5)),
  };
}

async function callClaude(base64Image, mediaType, prompt) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const text = response.content[0].text.trim();
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

async function extractSalesData(base64Image, mediaType) {
  const today = new Date().toISOString().split('T')[0];

  // Primary attempt — full extraction
  let raw;
  try {
    raw = await callClaude(base64Image, mediaType, FULL_PROMPT(today));
  } catch (err) {
    console.error('Primary extraction failed:', err.message);
    raw = null;
  }

  // Fallback if primary failed or confidence too low
  if (!raw || (raw.confidence || 0) < 0.45 || (!raw.totalIncome && !raw.items?.length)) {
    try {
      console.log('Running fallback extraction...');
      const fallback = await callClaude(base64Image, mediaType, FALLBACK_PROMPT(today));
      // Merge: prefer primary fields when available, fill gaps from fallback
      raw = raw ? {
        ...fallback,
        ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== 0 && v !== '')),
        confidence: Math.max(raw.confidence || 0, fallback.confidence || 0),
      } : fallback;
    } catch (err) {
      console.error('Fallback extraction failed:', err.message);
      if (!raw) throw new Error('Tidak dapat membaca screenshot. Pastikan gambar jelas dan merupakan screenshot Shopee.');
    }
  }

  return normalizeExtracted(raw);
}

// ── AI Endpoint ───────────────────────────────────────────────────────────────
app.post('/api/analyze', analyzeLimiter, upload.single('screenshot'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diupload.' });

  try {
    const data = await extractSalesData(
      req.file.buffer.toString('base64'),
      req.file.mimetype
    );
    res.json({ success: true, data });
  } catch (err) {
    console.error('Analyze error:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Gagal menganalisis screenshot.' });
  }
});

// ── Database ──────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readDb(file) {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return []; }
}

function writeDb(file, data) {
  const filePath = path.join(DATA_DIR, file);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Sales CRUD ────────────────────────────────────────────────────────────────
app.get('/api/sales', (req, res) => {
  const { from, to, date } = req.query;
  let sales = readDb('sales.json');
  if (date) sales = sales.filter(s => s.date === date);
  else if (from && to) sales = sales.filter(s => s.date >= from && s.date <= to);
  sales.sort((a, b) => b.createdAt - a.createdAt);
  res.json(sales);
});

app.post('/api/sales', (req, res) => {
  const sales = readDb('sales.json');
  const sale = { id: genId(), createdAt: Date.now(), ...req.body };
  sales.push(sale);
  writeDb('sales.json', sales);
  res.json(sale);
});

app.put('/api/sales/:id', (req, res) => {
  const sales = readDb('sales.json');
  const idx = sales.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  sales[idx] = { ...sales[idx], ...req.body };
  writeDb('sales.json', sales);
  res.json(sales[idx]);
});

app.delete('/api/sales/:id', (req, res) => {
  let sales = readDb('sales.json');
  sales = sales.filter(s => s.id !== req.params.id);
  writeDb('sales.json', sales);
  res.json({ success: true });
});

// ── Products ──────────────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => res.json(readDb('products.json')));

app.post('/api/products', (req, res) => {
  const products = readDb('products.json');
  const product = { id: genId(), createdAt: Date.now(), ...req.body };
  products.push(product);
  writeDb('products.json', products);
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const products = readDb('products.json');
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  products[idx] = { ...products[idx], ...req.body };
  writeDb('products.json', products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', (req, res) => {
  let products = readDb('products.json');
  products = products.filter(p => p.id !== req.params.id);
  writeDb('products.json', products);
  res.json({ success: true });
});

// ── Reports ───────────────────────────────────────────────────────────────────
app.get('/api/report/daily', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Parameter date diperlukan (YYYY-MM-DD).' });
  const sales = readDb('sales.json').filter(s => s.date === date);
  res.json(buildReport(sales, readDb('products.json'), date, date));
});

app.get('/api/report/range', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Parameter from dan to diperlukan.' });
  const sales = readDb('sales.json').filter(s => s.date >= from && s.date <= to);
  res.json(buildReport(sales, readDb('products.json'), from, to));
});

// Fuzzy product matching: exact → partial → token overlap
function findProduct(productMap, itemName) {
  const normalize = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const key = normalize(itemName);

  if (productMap[key]) return productMap[key];

  // Partial containment
  for (const [pKey, product] of Object.entries(productMap)) {
    if (pKey.length >= 4 && (key.includes(pKey) || pKey.includes(key))) return product;
  }

  // Token overlap: match if ≥ 60% of product name tokens found in item name
  const itemTokens = new Set(key.split(' ').filter(t => t.length >= 3));
  let bestMatch = null;
  let bestScore = 0;
  for (const [pKey, product] of Object.entries(productMap)) {
    const pTokens = pKey.split(' ').filter(t => t.length >= 3);
    if (!pTokens.length) continue;
    const hits = pTokens.filter(t => itemTokens.has(t)).length;
    const score = hits / pTokens.length;
    if (score >= 0.6 && score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }
  return bestMatch;
}

function buildReport(sales, products, from, to) {
  const productMap = {};
  products.forEach(p => {
    const key = (p.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
    productMap[key] = p;
    if (p.sku) productMap[p.sku.toLowerCase().trim()] = p;
  });

  let totalOmzet = 0, totalHPP = 0, totalShipping = 0, totalDiscount = 0;
  const itemSummary = {};

  sales.forEach(sale => {
    totalOmzet += Number(sale.totalIncome) || 0;
    totalShipping += Number(sale.shippingFee) || 0;
    totalDiscount += (Number(sale.shopeeDiscount) || 0) + (Number(sale.sellerDiscount) || 0);

    (sale.items || []).forEach(item => {
      const key = item.productName;
      if (!itemSummary[key]) {
        itemSummary[key] = { productName: key, quantity: 0, revenue: 0, hpp: 0, matched: false, modalPrice: null };
      }
      itemSummary[key].quantity += Number(item.quantity) || 0;
      itemSummary[key].revenue += Number(item.subtotal) || 0;

      const product = findProduct(productMap, item.productName);
      if (product) {
        const hpp = (Number(product.modalPrice) || 0) * (Number(item.quantity) || 0);
        itemSummary[key].hpp += hpp;
        itemSummary[key].matched = true;
        itemSummary[key].modalPrice = Number(product.modalPrice) || 0;
        totalHPP += hpp;
      }
    });
  });

  const summaryList = Object.values(itemSummary).sort((a, b) => b.revenue - a.revenue);
  const grossProfit = totalOmzet - totalHPP;

  return {
    period: { from, to },
    totalTransaksi: sales.length,
    totalOmzet, totalHPP, totalShipping, totalDiscount,
    grossProfit, netProfit: grossProfit,
    marginPersen: totalOmzet > 0 ? ((grossProfit / totalOmzet) * 100).toFixed(1) : '0',
    itemSummary: summaryList,
    matchedCount: summaryList.filter(i => i.matched).length,
    totalUniqueItems: summaryList.length,
    sales,
  };
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Shopee Sales Tracker running at http://localhost:${PORT}\n`);
});
