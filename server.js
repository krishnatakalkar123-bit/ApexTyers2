require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { products: catalogProducts } = require('./public/catalog-data');
const { all, get, initializeDatabase, pool, run, withTransaction } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'apextyre_owner';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const ORDER_STATUSES = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
const GST_RATE = 0.18;
const DELIVERY_CHARGE = 99;
const OWNER_EMAIL_FALLBACK = 'swapnilnarwade73@gmail.com';
const BUSINESS_GSTIN = process.env.BUSINESS_GSTIN || '';
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || '';
const catalogProductsByKey = new Map(catalogProducts.map((product) => [product.catalog_key, product]));

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters.');
}

function sendJsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateProduct(product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return 'Product details must be sent as an object.';
  }
  const required = ['brand', 'model', 'tyre_size', 'rim_size', 'vehicle_type'];
  if (required.some((field) => typeof product[field] !== 'string' || !product[field].trim())) {
    return 'Brand, model, tyre size, rim size, and vehicle type are required.';
  }
  const price = Number(product.price);
  const discount = Number(product.discount ?? 0);
  const stock = Number(product.stock_quantity);
  if (!Number.isFinite(price) || price < 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 ||
      !Number.isInteger(stock) || stock < 0) {
    return 'Enter a valid price, discount (0–100), and whole-number stock quantity.';
  }
  const imageUrl = String(product.image_url || '').trim();
  if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
    return 'Image URL must start with http:// or https://.';
  }
  return null;
}

function productValues(product) {
  return [
    product.brand.trim(),
    product.model.trim(),
    product.tyre_size.trim(),
    product.rim_size.trim(),
    product.vehicle_type.trim(),
    Number(product.price),
    Number(product.discount || 0),
    Number(product.stock_quantity),
    String(product.image_url || '').trim()
  ];
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function formatTimestamp(value) {
  return value instanceof Date
    ? value.toISOString()
    : String(value || '');
}

function makeInvoicePdf(order) {
  const text = (value) => String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const commands = [];
  const writeText = (value, x, y, size = 10, font = 'F1', color = '0.12 0.2 0.17') => {
    commands.push(`${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${text(value)}) Tj ET`);
  };
  const line = (x1, y1, x2, y2, color = '0.82 0.87 0.84') => {
    commands.push(`${color} RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const rect = (x, y, width, height, color) => {
    commands.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
  };
  const wrap = (value, maxLength) => {
    const words = String(value || '').split(/\s+/);
    const rows = [];
    let row = '';
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (next.length > maxLength && row) {
        rows.push(row);
        row = word;
      } else {
        row = next;
      }
    }
    if (row) rows.push(row);
    return rows;
  };
  const address = [
    order.address, order.landmark, order.city, order.state, order.pincode
  ].filter(Boolean).join(', ');
  const approvedAt = formatTimestamp(order.approved_at || order.created_at)
    .replace('T', ' ').replace('Z', ' UTC');
  const items = Array.isArray(order.items) && order.items.length
    ? order.items
    : [{
        brand: order.brand,
        model: order.model,
        tyre_size: order.tyre_size,
        quantity: order.quantity,
        unit_price: order.unit_price,
        subtotal_amount: order.subtotal_amount,
        gst_amount: order.gst_amount
      }];
  const delivery = Number(order.delivery_amount || 0);
  const taxable = Number(order.subtotal_amount) + delivery;
  const gst = Number(order.gst_amount);
  const x = { item: 48, brand: 235, qty: 355, unit: 397, gst: 468, total: 520 };

  rect(0, 682, 595, 160, '0.08 0.35 0.30');
  writeText('apexTyre.com Multi-Brand Tyre Store', 48, 798, 17, 'F2', '1 1 1');
  writeText('GST TAX INVOICE', 48, 770, 11, 'F2', '0.80 0.95 0.86');
  writeText('Contact: +91 89992 10727', 48, 746, 10, 'F1', '1 1 1');
  writeText(`GSTIN: ${BUSINESS_GSTIN || 'Not configured'}`, 48, 730, 8, 'F1', '1 1 1');
  if (BUSINESS_ADDRESS) writeText(`Seller: ${BUSINESS_ADDRESS}`.slice(0, 75), 48, 714, 8, 'F1', '1 1 1');
  writeText('Order ID', 405, 798, 9, 'F1', '0.80 0.95 0.86');
  writeText(order.order_code, 405, 779, 12, 'F2', '1 1 1');
  writeText('Invoice date', 405, 753, 9, 'F1', '0.80 0.95 0.86');
  writeText(approvedAt.slice(0, 19), 405, 736, 9, 'F1', '1 1 1');

  writeText('BILL TO', 48, 650, 9, 'F2', '0.08 0.45 0.37');
  writeText(order.customer_name, 48, 630, 12, 'F2');
  writeText(`Phone: ${order.phone}`, 48, 612, 9);
  writeText(`Email: ${order.email}`, 48, 597, 9);
  wrap(address, 80).slice(0, 2).forEach((row, index) => writeText(`Address: ${row}`, 48, 578 - index * 14, 9));

  rect(42, 516, 511, 25, '0.91 0.95 0.92');
  writeText('TYRE MODEL', x.item, 525, 8, 'F2');
  writeText('BRAND', x.brand, 525, 8, 'F2');
  writeText('QTY', x.qty, 525, 8, 'F2');
  writeText('UNIT PRICE', x.unit, 525, 8, 'F2');
  writeText('GST 18%', x.gst, 525, 8, 'F2');
  writeText('TOTAL', x.total, 525, 8, 'F2');
  line(42, 516, 553, 516);
  const invoiceRows = items.map((item) => ({
    label: `${item.model} (${item.tyre_size})`.slice(0, 32),
    brand: String(item.brand).slice(0, 16),
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    gst: Number(item.gst_amount ?? (Number(item.subtotal_amount) * GST_RATE).toFixed(2)),
    total: Number(item.subtotal_amount) + Number(item.gst_amount ?? (Number(item.subtotal_amount) * GST_RATE).toFixed(2))
  }));
  if (delivery > 0) {
    const itemTaxes = invoiceRows.reduce((sum, item) => sum + item.gst, 0);
    invoiceRows.push({
      label: 'Delivery charge',
      brand: 'Shipping',
      quantity: 1,
      unitPrice: delivery,
      gst: Number((gst - itemTaxes).toFixed(2)),
      total: Number((delivery + gst - itemTaxes).toFixed(2))
    });
  }
  invoiceRows.forEach((item, index) => {
    const y = 493 - index * 16;
    writeText(item.label, x.item, y, 7);
    writeText(item.brand, x.brand, y, 7);
    writeText(String(item.quantity), x.qty, y, 7);
    writeText(formatCurrency(item.unitPrice), x.unit, y, 7);
    writeText(formatCurrency(item.gst), x.gst, y, 7);
    writeText(formatCurrency(item.total), x.total, y, 7);
  });
  const summaryY = Math.max(285, 493 - invoiceRows.length * 16 - 25);
  line(42, summaryY + 13, 553, summaryY + 13);
  writeText('Taxable value (incl. delivery)', 354, summaryY - 5, 9);
  writeText(formatCurrency(taxable), 486, summaryY - 5, 9);
  writeText('GST @ 18%', 354, summaryY - 23, 9);
  writeText(formatCurrency(gst), 486, summaryY - 23, 9);
  rect(345, summaryY - 70, 208, 25, '0.08 0.35 0.30');
  writeText('INVOICE TOTAL', 355, summaryY - 61, 9, 'F2', '1 1 1');
  writeText(formatCurrency(order.total_amount), 478, summaryY - 61, 9, 'F2', '1 1 1');

  line(42, summaryY - 88, 553, summaryY - 88);
  writeText('Order status: Approved & Dispatched', 48, summaryY - 110, 9);
  writeText(`Order placed: ${formatTimestamp(order.created_at).replace('T', ' ').slice(0, 19)}`, 48, summaryY - 127, 9);
  rect(400, 125, 142, 52, '0.93 0.97 0.94');
  writeText('AUTHORIZED SIGNATORY', 412, 160, 8, 'F2', '0.08 0.45 0.37');
  writeText('ApexTyre Store', 412, 141, 10, 'F2');
  writeText('Digitally issued invoice', 412, 129, 7, 'F1', '0.4 0.48 0.43');
  writeText('Thank you for choosing ApexTyre.', 48, 135, 10, 'F2');
  writeText(
    BUSINESS_GSTIN && BUSINESS_ADDRESS
      ? 'This electronic invoice is issued by ApexTyre.'
      : 'PRO FORMA: configure registered GSTIN and seller address before statutory use.',
    48, 68, 7, 'F1', '0.42 0.48 0.44'
  );
  writeText('This invoice is generated electronically and does not require a handwritten signature.', 48, 54, 7, 'F1', '0.42 0.48 0.44');

  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function isOwner(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || !process.env.SESSION_SECRET) return false;
  const [encoded, suppliedSignature] = token.split('.');
  if (!encoded || !suppliedSignature) return false;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(encoded).digest();
  let actual;
  try {
    actual = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.owner === true && Number(payload.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function requireOwner(req, res, next) {
  if (!isOwner(req)) return sendJsonError(res, 401, 'Please sign in as the shop owner.');
  next();
}

function parseCookies(req, res, next) {
  req.cookies = Object.create(null);
  for (const part of (req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) {
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        req.cookies[key] = decodeURIComponent(value);
      } catch {
        req.cookies[key] = '';
      }
    }
  }
  next();
}

const loginAttempts = new Map();

const allowedOrigins = [
  'https://brilliant-semifreddo-ca3b22.netlify.app',
  'https://famous-figolla-ae93f8.netlify.app',
  'http://localhost:3000',
  ...(FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : [])
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};
const cleanupAttempts = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [ip, attempt] of loginAttempts) {
    if (attempt.startedAt < cutoff) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000);
cleanupAttempts.unref();

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(parseCookies);

const mailer = process.env.EMAIL_USER && process.env.EMAIL_PASS
  ? nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  })
  : null;

app.get('/api/products', async (req, res, next) => {
  try {
    res.json(await all('SELECT * FROM products ORDER BY brand, model'));
  } catch (error) {
    next(error);
  }
});

app.get('/api/storefront-settings', async (req, res, next) => {
  try {
    const offer = await get("SELECT setting_value FROM app_settings WHERE setting_key = 'diwali_offer'");
    res.set('Cache-Control', 'no-store');
    res.json({ diwaliOffer: offer?.setting_value || '' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/place-order', async (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJsonError(res, 400, 'Order details must be sent as an object.');
  }
  const textFields = ['fullName', 'phone', 'email', 'address', 'pincode', 'city', 'state'];
  if (textFields.some((field) => typeof body[field] !== 'string' || !body[field].trim())) {
    return sendJsonError(res, 400, 'Fill in your name, phone, email, and complete delivery address.');
  }
  if (!isValidEmail(body.email.trim())) return sendJsonError(res, 400, 'Enter a valid email address.');
  if (!/^[0-9+()\-\s]{8,20}$/.test(body.phone.trim())) return sendJsonError(res, 400, 'Enter a valid phone number.');
  if (!/^[a-zA-Z0-9 -]{3,12}$/.test(body.pincode.trim())) return sendJsonError(res, 400, 'Enter a valid pincode.');
  const requestedItems = Array.isArray(body.items)
    ? body.items
    : [{ productId: body.productId, quantity: body.quantity }];
  if (!requestedItems.length || requestedItems.length > 10) {
    return sendJsonError(res, 400, 'An order must contain between 1 and 10 tyre models.');
  }
  const itemPayload = requestedItems.map((item) => ({
    productId: item?.productId === null || item?.productId === undefined || item?.productId === ''
      ? null
      : Number(item.productId),
    catalogKey: typeof item?.catalogKey === 'string' ? item.catalogKey.trim() : '',
    quantity: Number(item?.quantity)
  }));
  if (itemPayload.some((item) =>
    (item.productId !== null && (!Number.isInteger(item.productId) || item.productId < 1)) ||
    (item.productId === null && !catalogProductsByKey.has(item.catalogKey)) ||
    !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10
  )) {
    return sendJsonError(res, 400, 'Choose valid tyres and enter a quantity between 1 and 10 for each.');
  }
  const itemKeys = itemPayload.map((item) =>
    item.productId === null ? `catalog:${item.catalogKey}` : `product:${item.productId}`
  );
  if (new Set(itemKeys).size !== itemPayload.length) {
    return sendJsonError(res, 400, 'Each tyre model can appear only once in the cart.');
  }
  if (itemPayload.reduce((sum, item) => sum + item.quantity, 0) > 100) {
    return sendJsonError(res, 400, 'An order cannot contain more than 100 tyres.');
  }
  const paymentMethod = body.paymentMethod;
  if (!['cod', 'upi', 'online'].includes(paymentMethod)) {
    return sendJsonError(res, 400, 'Choose a valid payment option.');
  }

  const invoiceToken = crypto.randomBytes(32).toString('base64url');
  const invoiceTokenHash = crypto.createHash('sha256').update(invoiceToken).digest('hex');
  let order;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        order = await withTransaction(async (client) => {
          let orderCode;
          do {
            orderCode = `APX-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
          } while (await get('SELECT 1 FROM orders WHERE order_code = $1', [orderCode], client));
        const productIds = [...new Set(itemPayload
          .map((item) => item.productId)
          .filter((id) => id !== null))].sort((left, right) => left - right);
        const lockedProducts = await all(
          'SELECT * FROM products WHERE id = ANY($1::integer[]) ORDER BY id FOR UPDATE',
          [productIds],
          client
        );
        const productsById = new Map(lockedProducts.map((product) => [product.id, product]));
        const orderItems = [];
        for (const requested of itemPayload) {
          let product = requested.productId
            ? productsById.get(requested.productId)
            : null;
          const canReserveInventory = product && product.stock_quantity >= requested.quantity;
          if (!canReserveInventory) {
            const catalogProduct = catalogProductsByKey.get(requested.catalogKey);
            if (!catalogProduct) {
              const error = new Error(product
                ? `Not enough stock is available for ${product.brand} ${product.model}.`
                : 'A tyre in your cart is no longer available.');
              error.status = product ? 409 : 404;
              throw error;
            }
            const sameCatalogModel = product &&
              product.brand.toLowerCase() === catalogProduct.brand.toLowerCase() &&
              product.model.toLowerCase() === catalogProduct.model.toLowerCase();
            product = {
              ...catalogProduct,
              id: null,
              tyre_size: sameCatalogModel ? product.tyre_size : catalogProduct.tyre_size,
              rim_size: sameCatalogModel ? product.rim_size : catalogProduct.rim_size,
              price: sameCatalogModel ? product.price : catalogProduct.price,
              discount: sameCatalogModel ? product.discount : 0,
              specialOrder: true
            };
          }
          const unitPriceCents = Math.round(product.price * (1 - product.discount / 100) * 100);
          const lineSubtotalCents = unitPriceCents * requested.quantity;
          orderItems.push({
            product,
            specialOrder: Boolean(product.specialOrder),
            quantity: requested.quantity,
            unitPrice: unitPriceCents / 100,
            subtotal: lineSubtotalCents / 100,
            subtotalCents: lineSubtotalCents
          });
        }
        const deliveryCents = Math.round(DELIVERY_CHARGE * 100);
        const subtotalCents = orderItems.reduce((sum, item) => sum + item.subtotalCents, 0);
        const gstCents = Math.round((subtotalCents + deliveryCents) * GST_RATE);
        const taxBases = [
          ...orderItems.map((item) => ({ item, cents: item.subtotalCents })),
          { item: null, cents: deliveryCents }
        ];
        let allocatedTaxCents = 0;
        const taxAllocations = taxBases.map((basis, index) => {
          const exactCents = basis.cents * GST_RATE;
          const wholeCents = Math.floor(exactCents);
          allocatedTaxCents += wholeCents;
          return { index, cents: wholeCents, remainder: exactCents - wholeCents };
        });
        taxAllocations
          .sort((left, right) => right.remainder - left.remainder)
          .slice(0, gstCents - allocatedTaxCents)
          .forEach((allocation) => { allocation.cents += 1; });
        const gstByItem = new Map(taxAllocations
          .filter((allocation) => taxBases[allocation.index].item)
          .map((allocation) => [taxBases[allocation.index].item, allocation.cents / 100]));
        const deliveryGst = taxAllocations.find((allocation) => taxBases[allocation.index].item === null).cents / 100;
        orderItems.forEach((item) => { item.gstAmount = gstByItem.get(item); });
        const subtotal = subtotalCents / 100;
        const deliveryAmount = deliveryCents / 100;
        const gstAmount = gstCents / 100;
        const total = (subtotalCents + deliveryCents + gstCents) / 100;
        const quantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
        const firstItem = orderItems[0];
        const customer = {
          fullName: body.fullName.trim(),
          phone: body.phone.trim(),
          email: body.email.trim().toLowerCase(),
          address: body.address.trim(),
          landmark: String(body.landmark || '').trim(),
          pincode: body.pincode.trim(),
          city: body.city.trim(),
          state: body.state.trim(),
          vehicleDetails: String(body.vehicleDetails || '').trim()
        };
        const orderResult = await run(
          `INSERT INTO orders
           (customer_name, phone, email, address, landmark, pincode, city, state, vehicle_details,
            product_id, brand, model, tyre_size, quantity, unit_price, subtotal_amount, gst_amount,
            delivery_amount, total_amount, payment_method, payment_status, order_code, approval_status, invoice_token_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                   $18, $19, $20, $21, $22, $23, $24)
           RETURNING id`,
          [
            customer.fullName, customer.phone, customer.email, customer.address, customer.landmark,
            customer.pincode, customer.city, customer.state, customer.vehicleDetails,
            orderItems.length === 1 ? firstItem.product.id || null : null,
            orderItems.length === 1 ? firstItem.product.brand : 'Multi-brand',
            orderItems.length === 1 ? firstItem.product.model : `${orderItems.length} tyre models`,
            orderItems.length === 1 ? firstItem.product.tyre_size : 'Multiple sizes',
            quantity, firstItem.unitPrice, subtotal, gstAmount, deliveryAmount, total, paymentMethod,
            'Pending', orderCode, 'Pending Approval', invoiceTokenHash
          ],
          client
        );
        for (const item of orderItems) {
          await run(
            `INSERT INTO order_items
             (order_id, product_id, brand, model, tyre_size, quantity, unit_price, subtotal_amount, gst_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              orderResult.id, item.product.id || null, item.product.brand, item.product.model, item.product.tyre_size,
              item.quantity, item.unitPrice, item.subtotal, item.gstAmount
            ],
            client
          );
          if (item.product.id) {
            const stockUpdate = await run(
              'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND stock_quantity >= $1',
              [item.quantity, item.product.id],
              client
            );
            if (stockUpdate.changes !== 1) {
              const error = new Error(`Not enough stock is available for ${item.product.brand} ${item.product.model}.`);
              error.status = 409;
              throw error;
            }
          }
        }
        return {
          id: orderResult.id,
          orderCode,
          invoiceToken,
          createdAt: new Date().toISOString(),
          customer,
          items: orderItems.map((item) => ({
            brand: item.product.brand,
            model: item.product.model,
            tyreSize: item.product.tyre_size,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            gstAmount: item.gstAmount,
            specialOrder: item.specialOrder
          })),
          deliveryAmount,
          deliveryGst,
          quantity,
          subtotal,
          gstAmount,
          total,
          paymentMethod,
          paymentStatus: 'Pending'
        };
        });
        break;
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'orders_order_code_idx' && attempt < 4) {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error.status) return sendJsonError(res, error.status, error.message);
    return next(error);
  }

  const emailDelivery = { configured: Boolean(mailer), customerSent: false, ownerSent: false };
  if (mailer) {
    const ownerEmail = process.env.OWNER_EMAIL || process.env.EMAIL_USER || OWNER_EMAIL_FALLBACK;
    const currency = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const formatEmailMoney = (amount) => currency.format(Number(amount) || 0);
    const addressText = [
      order.customer.address, order.customer.landmark, order.customer.city,
      order.customer.state, order.customer.pincode
    ].filter(Boolean).join(', ');
    const addressHtml = escapeHtml(addressText);
    const itemRows = order.items.map((item) => {
      const lineTotal = item.subtotal + item.gstAmount;
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e5ece8">${escapeHtml(item.brand)} ${escapeHtml(item.model)}<br><small>${escapeHtml(item.tyreSize)}</small></td>
        <td style="padding:10px;border-bottom:1px solid #e5ece8;text-align:center">${item.quantity}</td>
        <td style="padding:10px;border-bottom:1px solid #e5ece8;text-align:right">${formatEmailMoney(item.unitPrice)}</td>
        <td style="padding:10px;border-bottom:1px solid #e5ece8;text-align:right">${formatEmailMoney(item.gstAmount)}</td>
        <td style="padding:10px;border-bottom:1px solid #e5ece8;text-align:right">${formatEmailMoney(lineTotal)}</td>
      </tr>`;
    }).join('');
    const ownerItemList = order.items.map((item) =>
      `<li>${escapeHtml(item.brand)} ${escapeHtml(item.model)} (${escapeHtml(item.tyreSize)}) · Qty ${item.quantity} · ${formatEmailMoney(item.subtotal)}${item.specialOrder ? ' · special order: verify price and availability before approval' : ''}</li>`
    ).join('');
    const customerHtml = `<!doctype html><html><body style="margin:0;padding:24px;background:#f2f6f4;font-family:Arial,sans-serif;color:#20332d">
      <div style="max-width:680px;margin:auto;padding:28px;background:#fff;border:1px solid #dfe9e4;border-radius:12px">
        <p style="margin:0 0 8px;color:#087c70;font-size:12px;font-weight:bold;letter-spacing:1px">APEXTYRE.COM · ORDER RECEIPT</p>
        <h1 style="margin:0 0 12px;font-size:23px">Thanks for your order, ${escapeHtml(order.customer.fullName)}.</h1>
        <p style="color:#60746b;line-height:1.6">Your order has been received and is awaiting owner approval. This receipt includes an estimated GST breakdown; the final GST invoice will be issued after approval.</p>
        <table style="width:100%;margin:20px 0;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:6px 0;color:#71827a">Order ID</td><td style="padding:6px 0;text-align:right;font-weight:bold">${escapeHtml(order.orderCode)}</td></tr>
          <tr><td style="padding:6px 0;color:#71827a">Order date</td><td style="padding:6px 0;text-align:right">${escapeHtml(order.createdAt)}</td></tr>
          <tr><td style="padding:6px 0;color:#71827a">Delivery address</td><td style="padding:6px 0;text-align:right">${addressHtml}</td></tr>
          <tr><td style="padding:6px 0;color:#71827a">Phone</td><td style="padding:6px 0;text-align:right">${escapeHtml(order.customer.phone)}</td></tr>
        </table>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#eff7f3;text-align:left">
            <th style="padding:10px">Item</th><th style="padding:10px;text-align:center">Qty</th>
            <th style="padding:10px;text-align:right">Unit price</th><th style="padding:10px;text-align:right">GST</th>
            <th style="padding:10px;text-align:right">Line total</th>
          </tr></thead><tbody>${itemRows}</tbody>
        </table></div>
        <table style="width:100%;max-width:350px;margin:18px 0 0 auto;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:5px;color:#60746b">Tyre subtotal</td><td style="padding:5px;text-align:right">${formatEmailMoney(order.subtotal)}</td></tr>
          <tr><td style="padding:5px;color:#60746b">Delivery</td><td style="padding:5px;text-align:right">${formatEmailMoney(order.deliveryAmount)}</td></tr>
          <tr><td style="padding:5px;color:#60746b">GST on delivery (18%)</td><td style="padding:5px;text-align:right">${formatEmailMoney(order.deliveryGst)}</td></tr>
          <tr><td style="padding:5px;color:#60746b">GST on items (18%)</td><td style="padding:5px;text-align:right">${formatEmailMoney(order.gstAmount - order.deliveryGst)}</td></tr>
          <tr><td style="padding:9px 5px;border-top:1px solid #dfe9e4;font-weight:bold">Total including GST</td><td style="padding:9px 5px;border-top:1px solid #dfe9e4;text-align:right;font-weight:bold;color:#087c70">${formatEmailMoney(order.total)}</td></tr>
        </table>
        ${order.items.some((item) => item.specialOrder) ? '<p style="padding:12px;background:#fff7e6;color:#805c16;font-size:12px;line-height:1.5">Special-order prices are estimates. The owner will confirm final pricing and availability before approval.</p>' : ''}
        <p style="margin:22px 0 0;color:#71827a;font-size:11px;line-height:1.6">This email is an order receipt and GST estimate, not the final GST tax invoice. Your final invoice will be available after the order is approved. Questions? Call +91 89992 10727.</p>
      </div>
    </body></html>`;
    const ownerHtml = `<h2>New ApexTyre order ${escapeHtml(order.orderCode)}</h2>
      <p><strong>Date:</strong> ${escapeHtml(order.createdAt)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(order.customer.fullName)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(order.customer.phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(order.customer.email)}</p>
      <p><strong>Delivery address:</strong> ${addressHtml}</p>
      <p><strong>Vehicle:</strong> ${escapeHtml(order.customer.vehicleDetails || 'Not provided')}</p>
      <p><strong>Items:</strong></p><ul>${ownerItemList}</ul>
      <p><strong>Subtotal:</strong> ${formatEmailMoney(order.subtotal)}</p>
      <p><strong>Delivery:</strong> ${formatEmailMoney(order.deliveryAmount)}</p>
      <p><strong>GST (18%):</strong> ${formatEmailMoney(order.gstAmount)}</p>
      <p><strong>Total including GST:</strong> ${formatEmailMoney(order.total)}</p>
      ${order.items.some((item) => item.specialOrder) ? '<p><strong>Estimate notice:</strong> Special-order pricing is indicative; verify final price and availability before approval.</p>' : ''}
      <p><strong>Approval:</strong> Pending Approval (not yet included in sales revenue)</p>
      <p><strong>Payment:</strong> ${escapeHtml(order.paymentMethod.toUpperCase())} (${escapeHtml(order.paymentStatus)})</p>`;
    const messages = [
      {
        recipient: order.customer.email,
        subject: `ApexTyre order receipt and GST estimate ${order.orderCode}`,
        html: customerHtml,
        text: `Order ${order.orderCode} received. Tyre subtotal: ${formatEmailMoney(order.subtotal)}. Delivery: ${formatEmailMoney(order.deliveryAmount)}. GST at 18%: ${formatEmailMoney(order.gstAmount)}. Total: ${formatEmailMoney(order.total)}. Delivery address: ${addressText}. This is an order receipt and GST estimate; the final GST invoice will be issued after approval.`
      },
      {
        recipient: ownerEmail,
        subject: `New ApexTyre order ${order.orderCode}`,
        html: ownerHtml
      }
    ];
    const deliveries = await Promise.allSettled(messages.map((message) =>
      mailer.sendMail({
        from: process.env.EMAIL_USER,
        to: message.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text
      })
    ));
    deliveries.forEach((delivery, index) => {
      const message = messages[index];
      const recipientAccepted = delivery.status === 'fulfilled' &&
        Array.isArray(delivery.value.accepted) &&
        delivery.value.accepted.some((accepted) => String(accepted).toLowerCase() === message.recipient.toLowerCase());
      emailDelivery[index === 0 ? 'customerSent' : 'ownerSent'] = recipientAccepted;
      if (recipientAccepted) {
        console.log(`Order ${order.orderCode} email sent to ${index === 0 ? 'customer' : 'shop owner'}.`);
      } else {
        const error = delivery.status === 'rejected'
          ? delivery.reason
          : new Error(`Mail transport did not accept recipient ${message.recipient}.`);
        console.error(`Could not send ${index === 0 ? 'customer' : 'shop owner'} email for order ${order.orderCode}:`, error);
      }
    });
  } else {
    console.warn('Order saved. Email is not configured; set EMAIL_USER and EMAIL_PASS in .env to enable order emails.');
  }

  res.status(201).json({
    orderId: order.orderCode,
    orderCode: order.orderCode,
    totalAmount: order.total,
    subtotalAmount: order.subtotal,
    deliveryAmount: order.deliveryAmount,
    gstAmount: order.gstAmount,
    approvalStatus: 'Pending Approval',
    invoiceToken: order.invoiceToken,
    emailDelivery,
    requiresOwnerConfirmation: order.items.some((item) => item.specialOrder),
    message: 'Your order is awaiting owner approval. Revenue is recorded only after approval.'
  });
});

app.get('/api/orders/:orderCode/status', async (req, res, next) => {
  const token = typeof req.get('X-Order-Access') === 'string'
    ? req.get('X-Order-Access')
    : typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) return sendJsonError(res, 401, 'Order access token is required.');
  try {
    const order = await get(
      `SELECT order_code, approval_status, status, approved_at, invoice_token_hash
       FROM orders WHERE order_code = $1`,
      [req.params.orderCode]
    );
    if (!order) return sendJsonError(res, 404, 'Order not found.');
    const suppliedHash = crypto.createHash('sha256').update(token).digest();
    const storedHash = Buffer.from(order.invoice_token_hash || '', 'hex');
    if (storedHash.length !== suppliedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
      return sendJsonError(res, 403, 'Order access token is invalid.');
    }
    res.json({
      orderCode: order.order_code,
      approvalStatus: order.approval_status,
      status: order.status,
      approvedAt: order.approved_at,
      invoiceAvailable: order.approval_status === 'Approved & Dispatched'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:orderCode/invoice', async (req, res, next) => {
  try {
    const order = await get('SELECT * FROM orders WHERE order_code = $1', [req.params.orderCode]);
    if (!order) return sendJsonError(res, 404, 'Order not found.');
    if (!isOwner(req)) {
      const token = typeof req.get('X-Order-Access') === 'string'
        ? req.get('X-Order-Access')
        : typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) return sendJsonError(res, 401, 'Order access token is required.');
      const suppliedHash = crypto.createHash('sha256').update(token).digest();
      const storedHash = Buffer.from(order.invoice_token_hash || '', 'hex');
      if (storedHash.length !== suppliedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
        return sendJsonError(res, 403, 'Order access token is invalid.');
      }
    }
    if (order.approval_status !== 'Approved & Dispatched' || !order.approved_at) {
      return sendJsonError(res, 409, 'The GST invoice will be available after the order is approved.');
    }
    order.items = await all(
      'SELECT brand, model, tyre_size, quantity, unit_price, subtotal_amount, gst_amount FROM order_items WHERE order_id = $1 ORDER BY id',
      [order.id]
    );
    const pdf = makeInvoicePdf(order);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.order_code}.pdf"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'private, no-store'
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/login', async (req, res, next) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return sendJsonError(res, 503, 'Owner login is not configured. Set ADMIN_PASSWORD and SESSION_SECRET in .env.');
  }
  const configuredUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  if (!configuredUsername) {
    return sendJsonError(res, 503, 'Owner login is not configured. Set a non-empty ADMIN_USERNAME.');
  }
  const ip = req.ip;
  const now = Date.now();
  let attempt = loginAttempts.get(ip);
  if (!attempt || now - attempt.startedAt > 15 * 60 * 1000) {
    attempt = { startedAt: now, count: 0 };
    loginAttempts.set(ip, attempt);
  }
  if (attempt.count >= 10) return sendJsonError(res, 429, 'Too many login attempts. Try again in 15 minutes.');
  const suppliedUsername = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
  const usernameHash = crypto.createHash('sha256').update(suppliedUsername).digest();
  const configuredUsernameHash = crypto.createHash('sha256').update(configuredUsername).digest();
  const passwordHash = crypto.createHash('sha256').update(suppliedPassword).digest();
  const configuredPasswordHash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
  if (
    !suppliedUsername ||
    !suppliedPassword ||
    !crypto.timingSafeEqual(usernameHash, configuredUsernameHash) ||
    !crypto.timingSafeEqual(passwordHash, configuredPasswordHash)
  ) {
    attempt.count += 1;
    return sendJsonError(res, 401, 'Incorrect owner username or password.');
  }
  loginAttempts.delete(ip);
  const token = signSession({ owner: true, expiresAt: now + SESSION_LIFETIME });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: Boolean(FRONTEND_ORIGIN) || process.env.NODE_ENV === 'production',
    sameSite: FRONTEND_ORIGIN ? 'none' : 'strict',
    maxAge: SESSION_LIFETIME,
    path: '/'
  });
  res.json({ message: 'Signed in.' });
});

app.get('/api/admin/me', requireOwner, (req, res) => res.json({ authenticated: true }));

app.post('/api/admin/logout', requireOwner, (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: Boolean(FRONTEND_ORIGIN) || process.env.NODE_ENV === 'production',
    sameSite: FRONTEND_ORIGIN ? 'none' : 'strict',
    path: '/'
  });
  res.status(204).end();
});

app.get('/api/admin/dashboard', requireOwner, async (req, res, next) => {
  try {
    const summary = await get(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN approval_status = 'Approved & Dispatched' THEN total_amount ELSE 0 END), 0) AS total_sales,
              SUM(CASE WHEN approval_status = 'Pending Approval' THEN 1 ELSE 0 END) AS pending_orders,
              SUM(CASE WHEN approval_status = 'Approved & Dispatched' THEN 1 ELSE 0 END) AS revenue_order_count,
              (SELECT COALESCE(SUM(oi.quantity), 0)
               FROM order_items oi JOIN orders approved ON approved.id = oi.order_id
               WHERE approved.approval_status = 'Approved & Dispatched') AS products_sold
       FROM orders`
    );
    const recentOrders = await all(
      `SELECT id, order_code, customer_name, total_amount, status, approval_status, created_at
       FROM orders ORDER BY id DESC LIMIT 8`
    );
    const dailySales = await all(
      `SELECT TO_CHAR(approved_at, 'YYYY-MM-DD') AS period, SUM(total_amount) AS revenue
       FROM orders
       WHERE approval_status = 'Approved & Dispatched' AND approved_at IS NOT NULL
         AND approved_at >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY TO_CHAR(approved_at, 'YYYY-MM-DD') ORDER BY period`
    );
    const monthlySales = await all(
      `SELECT TO_CHAR(approved_at, 'YYYY-MM') AS period, SUM(total_amount) AS revenue
       FROM orders
       WHERE approval_status = 'Approved & Dispatched' AND approved_at IS NOT NULL
         AND approved_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
       GROUP BY TO_CHAR(approved_at, 'YYYY-MM') ORDER BY period`
    );
    const brandSales = await all(
      `SELECT oi.brand, SUM(oi.subtotal_amount + oi.gst_amount) AS revenue
       FROM order_items oi JOIN orders approved ON approved.id = oi.order_id
       WHERE approved.approval_status = 'Approved & Dispatched'
       GROUP BY oi.brand ORDER BY revenue DESC, oi.brand ASC`
    );
    const approvedSales = await all(
      `SELECT order_code, brand, model, total_amount AS revenue, quantity, approved_at
       FROM orders WHERE approval_status = 'Approved & Dispatched' AND approved_at IS NOT NULL
         AND approved_at >= CURRENT_DATE - INTERVAL '29 days'
       ORDER BY approved_at DESC LIMIT 500`
    );
    const stock = await get('SELECT COUNT(*) AS low_stock_count FROM products WHERE stock_quantity <= 5');
    const customers = await get('SELECT COUNT(DISTINCT email) AS customer_count FROM orders');
    res.json({
      totalOrders: summary.total_orders,
      totalSales: summary.total_sales,
      averageOrderValue: summary.revenue_order_count ? summary.total_sales / summary.revenue_order_count : 0,
      revenueOrderCount: summary.revenue_order_count || 0,
      productsSold: summary.products_sold || 0,
      pendingOrders: summary.pending_orders || 0,
      salesTrend: { daily: dailySales, monthly: monthlySales },
      approvedSales,
      brandSales,
      lowStockCount: stock.low_stock_count,
      customerCount: customers.customer_count,
      recentOrders
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', requireOwner, async (req, res, next) => {
  try {
    const orders = await all('SELECT * FROM orders ORDER BY id DESC LIMIT 100');
    const orderIds = orders.map((order) => order.id);
    if (!orderIds.length) return res.json([]);
    const items = await all(
      `SELECT order_id, product_id, brand, model, tyre_size, quantity, unit_price, subtotal_amount, gst_amount
       FROM order_items WHERE order_id = ANY($1::integer[]) ORDER BY id`,
      [orderIds]
    );
    const itemsByOrder = new Map();
    items.forEach((item) => {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    });
    res.json(orders.map((order) => ({ ...order, items: itemsByOrder.get(order.id) || [] })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/storefront-settings', requireOwner, async (req, res, next) => {
  try {
    const offer = await get("SELECT setting_value FROM app_settings WHERE setting_key = 'diwali_offer'");
    res.json({ diwaliOffer: offer?.setting_value || '' });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/storefront-settings', requireOwner, async (req, res, next) => {
  if (typeof req.body?.diwaliOffer !== 'string' || req.body.diwaliOffer.length > 240) {
    return sendJsonError(res, 400, 'Enter a banner message of no more than 240 characters.');
  }
  const diwaliOffer = req.body.diwaliOffer.trim();
  try {
    await run(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES ('diwali_offer', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
      [diwaliOffer]
    );
    res.json({ diwaliOffer });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/orders/:id/approve', requireOwner, async (req, res, next) => {
  try {
    const approved = await withTransaction(async (client) => {
        const order = await get(
          `SELECT id, order_code, approval_status, status, quantity, total_amount
           FROM orders WHERE id = $1 FOR UPDATE`,
          [req.params.id],
          client
        );
        if (!order) {
          const error = new Error('Order not found.');
          error.status = 404;
          throw error;
        }
        if (order.approval_status !== 'Pending Approval' || order.status === 'Cancelled') {
          const error = new Error('Only orders awaiting approval can be approved.');
          error.status = 409;
          throw error;
        }
        const result = await get(
          `UPDATE orders
           SET approval_status = 'Approved & Dispatched', status = 'Shipped',
               approved_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND approval_status = 'Pending Approval' AND status != 'Cancelled'
           RETURNING approved_at`,
          [order.id],
          client
        );
        if (!result) {
          const error = new Error('This order has already been processed.');
          error.status = 409;
          throw error;
        }
        return {
          id: order.id,
          orderCode: order.order_code,
          approvalStatus: 'Approved & Dispatched',
          status: 'Shipped',
          approvedAt: result.approved_at,
          totalAmount: order.total_amount,
          quantity: order.quantity
        };
    });
    res.json(approved);
  } catch (error) {
    if (error.status) return sendJsonError(res, error.status, error.message);
    next(error);
  }
});

app.patch('/api/orders/:id/status', requireOwner, async (req, res, next) => {
  if (!ORDER_STATUSES.includes(req.body?.status)) {
    return sendJsonError(res, 400, 'Choose a valid order status.');
  }
  try {
    const updated = await withTransaction(async (client) => {
        const order = await get(
          'SELECT id, status, approval_status FROM orders WHERE id = $1 FOR UPDATE',
          [req.params.id],
          client
        );
        if (!order) {
          const error = new Error('Order not found.');
          error.status = 404;
          throw error;
        }
        const allowedNext = {
          Pending: ['Processing', 'Cancelled'],
          Processing: ['Shipped', 'Cancelled'],
          Shipped: ['Delivered'],
          Delivered: [],
          Cancelled: []
        };
        if (
          ['Shipped', 'Delivered'].includes(req.body.status) &&
          order.approval_status !== 'Approved & Dispatched'
        ) {
          const error = new Error('Approve the order before marking it shipped or delivered.');
          error.status = 409;
          throw error;
        }
        if (order.status !== req.body.status && !allowedNext[order.status].includes(req.body.status)) {
          const error = new Error(`Cannot change an order from ${order.status} to ${req.body.status}.`);
          error.status = 409;
          throw error;
        }
        if (
          req.body.status === 'Cancelled' &&
          order.status !== 'Cancelled' &&
          order.approval_status === 'Pending Approval'
        ) {
          const items = await all(
            'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id, id',
            [order.id],
            client
          );
          for (const item of items) {
            if (!item.product_id) continue;
            await run(
              'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [item.quantity, item.product_id],
              client
            );
          }
        }
        await run('UPDATE orders SET status = $1 WHERE id = $2', [req.body.status, req.params.id], client);
        if (req.body.status === 'Cancelled' && order.approval_status === 'Pending Approval') {
          await run("UPDATE orders SET approval_status = 'Rejected' WHERE id = $1", [req.params.id], client);
        }
        return { id: order.id, status: req.body.status };
    });
    res.json(updated);
  } catch (error) {
    if (error.status) return sendJsonError(res, error.status, error.message);
    next(error);
  }
});

app.get('/api/admin/customers', requireOwner, async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT (ARRAY_AGG(customer_name ORDER BY created_at DESC))[1] AS full_name,
              (ARRAY_AGG(phone ORDER BY created_at DESC))[1] AS phone, email,
              COUNT(*) AS order_count,
              SUM(CASE WHEN approval_status = 'Approved & Dispatched' THEN total_amount ELSE 0 END) AS total_spent,
              MAX(created_at) AS last_order
       FROM orders GROUP BY email ORDER BY last_order DESC`
    ));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/customers/:email/orders', requireOwner, async (req, res, next) => {
  try {
    res.json(await all(
      'SELECT * FROM orders WHERE email = $1 ORDER BY id DESC',
      [req.params.email]
    ));
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', requireOwner, async (req, res, next) => {
  const invalid = validateProduct(req.body);
  if (invalid) return sendJsonError(res, 400, invalid);
  try {
    const result = await run(
      `INSERT INTO products
       (brand, model, tyre_size, rim_size, vehicle_type, price, discount, stock_quantity, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      productValues(req.body)
    );
    res.status(201).json(await get('SELECT * FROM products WHERE id = $1', [result.id]));
  } catch (error) {
    if (error.code === '23505') return sendJsonError(res, 409, 'This tyre is already in the catalog.');
    next(error);
  }
});

app.put('/api/products/:id', requireOwner, async (req, res, next) => {
  const invalid = validateProduct(req.body);
  if (invalid) return sendJsonError(res, 400, invalid);
  try {
    const result = await run(
      `UPDATE products SET brand = $1, model = $2, tyre_size = $3, rim_size = $4, vehicle_type = $5,
       price = $6, discount = $7, stock_quantity = $8, image_url = $9, updated_at = CURRENT_TIMESTAMP
       WHERE id = $10`,
      [...productValues(req.body), req.params.id]
    );
    if (!result.changes) return sendJsonError(res, 404, 'Tyre not found.');
    res.json(await get('SELECT * FROM products WHERE id = $1', [req.params.id]));
  } catch (error) {
    if (error.code === '23505') return sendJsonError(res, 409, 'This tyre is already in the catalog.');
    next(error);
  }
});

app.delete('/api/products/:id', requireOwner, async (req, res, next) => {
  try {
    const result = await run('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (!result.changes) return sendJsonError(res, 404, 'Tyre not found.');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'A server error occurred. Please try again.' });
});

async function start() {
  try {
    await initializeDatabase();
    const server = app.listen(PORT, () => {
      console.log(`ApexTyre is running at http://localhost:${server.address().port}`);
      console.log('PostgreSQL connection: connected.');
      if (!process.env.ADMIN_PASSWORD) {
        console.warn('Set ADMIN_PASSWORD in .env to enable secure owner dashboard login.');
      }
    });
    server.on('error', (error) => {
      console.error('Could not start ApexTyre server:', error);
      process.exitCode = 1;
    });

    const shutdown = () => {
      server.close(async () => {
        try {
          await pool.end();
        } catch (error) {
          console.error('Error closing PostgreSQL pool:', error);
          process.exitCode = 1;
        }
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Could not initialize ApexTyre:', error);
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Error closing PostgreSQL pool after startup failure:', closeError);
    }
    process.exitCode = 1;
  }
}

start();
