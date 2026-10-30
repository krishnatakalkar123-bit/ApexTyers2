const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.RESEND_API_KEY = 'test-only-resend-key';
process.env.EMAIL_FROM = 'ApexTyre <test@example.test>';
process.env.ADMIN_USERNAME = 'test-owner';
process.env.ADMIN_PASSWORD = 'test-owner-password';
process.env.SESSION_SECRET = 'test-only-session-secret-with-more-than-32-characters';
process.env.NODE_ENV = 'test';

let now = Date.now();
const state = {
  accounts: new Map(),
  sessions: new Map(),
  orders: [],
  orderItems: [],
  nextAccountId: 1,
  nextSessionId: 1,
  nextOrderId: 1,
  nextOrderItemId: 1
};
const sentEmails = [];

function cloneState() {
  return {
    accounts: new Map([...state.accounts].map(([key, value]) => [key, { ...value }])),
    sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
    orders: state.orders.map((value) => ({ ...value })),
    orderItems: state.orderItems.map((value) => ({ ...value })),
    nextAccountId: state.nextAccountId,
    nextSessionId: state.nextSessionId,
    nextOrderId: state.nextOrderId,
    nextOrderItemId: state.nextOrderItemId
  };
}

function restoreState(snapshot) {
  for (const key of Object.keys(state)) {
    if (state[key] instanceof Map) state[key] = snapshot[key];
    else if (Array.isArray(state[key])) state[key] = snapshot[key];
    else state[key] = snapshot[key];
  }
}

function accountById(id) {
  return [...state.accounts.values()].find((account) => account.id === Number(id));
}

async function get(sql, params = []) {
  if (sql.includes('INSERT INTO public.customer_accounts')) {
    const [fullName, email, mobileNumber, passwordHash] = params;
    if (state.accounts.has(email)) {
      const error = new Error('unique violation');
      error.code = '23505';
      error.constraint = 'customer_accounts_email_key';
      throw error;
    }
    const account = {
      id: state.nextAccountId++,
      full_name: fullName,
      email,
      mobile_number: mobileNumber,
      password_hash: passwordHash,
      email_verified: false,
      email_verified_at: null
    };
    state.accounts.set(email, account);
    return { id: account.id };
  }

  if (sql.includes('SELECT id, password_hash')) {
    const account = state.accounts.get(params[0]);
    return account
      ? {
        id: account.id,
        password_hash: account.password_hash
      }
      : undefined;
  }
  if (sql.includes('FROM public.customer_sessions AS session')) {
    const session = state.sessions.get(Buffer.from(params[0]).toString('hex'));
    const account = session && accountById(session.customer_id);
    if (!session || session.revoked_at || session.expires_at <= now || !account) {
      return undefined;
    }
    return {
      id: account.id,
      full_name: account.full_name,
      email: account.email,
      mobile_number: account.mobile_number,
      session_id: session.id
    };
  }
  if (sql.includes('SELECT 1 FROM orders')) {
    return state.orders.some((order) => order.order_code === params[0]) ? { '?column?': 1 } : undefined;
  }
  throw new Error(`Unexpected get query in test adapter: ${sql}`);
}

async function run(sql, params = []) {
  if (sql.includes('INSERT INTO public.customer_sessions')) {
    const [customerId, tokenHash, duration] = params;
    const key = Buffer.from(tokenHash).toString('hex');
    state.sessions.set(key, {
      id: state.nextSessionId++,
      customer_id: Number(customerId),
      expires_at: now + Number(duration),
      revoked_at: null
    });
    return { changes: 1 };
  }
  if (sql.includes('UPDATE public.customer_sessions')) {
    const session = state.sessions.get(Buffer.from(params[0]).toString('hex'));
    if (!session || session.revoked_at) return { changes: 0 };
    session.revoked_at = now;
    return { changes: 1 };
  }
  if (sql.includes('INSERT INTO orders')) {
    const customerIdPresent = sql.includes('(customer_id,');
    const offset = customerIdPresent ? 1 : 0;
    const order = {
      id: state.nextOrderId++,
      customer_id: customerIdPresent ? Number(params[0]) : null,
      customer_name: params[offset],
      phone: params[offset + 1],
      email: params[offset + 2],
      order_code: params[offset + 21],
      approval_status: params[offset + 22],
      status: 'Pending',
      created_at: new Date(now),
      subtotal_amount: params[offset + 15],
      gst_amount: params[offset + 16],
      delivery_amount: params[offset + 17],
      total_amount: params[offset + 18]
    };
    state.orders.push(order);
    return { id: order.id, changes: 1 };
  }
  if (sql.includes('INSERT INTO order_items')) {
    const [orderId, productId, brand, model, tyreSize, quantity, unitPrice, subtotal, gstAmount] = params;
    state.orderItems.push({
      id: state.nextOrderItemId++,
      order_id: orderId,
      product_id: productId,
      brand,
      model,
      tyre_size: tyreSize,
      quantity,
      unit_price: unitPrice,
      subtotal_amount: subtotal,
      gst_amount: gstAmount
    });
    return { changes: 1 };
  }
  if (sql.includes('UPDATE products SET stock_quantity')) return { changes: 1 };
  throw new Error(`Unexpected run query in test adapter: ${sql}`);
}

async function all(sql, params = []) {
  if (sql.includes('SELECT * FROM products')) return [];
  if (sql.includes('FROM public.orders AS order_row')) {
    const customerId = Number(params[0]);
    const filter = params[1];
    return state.orders
      .filter((order) => order.customer_id === customerId)
      .filter((order) => filter === 'all' ||
        filter === 'pending' && order.approval_status === 'Pending Approval' ||
        filter === 'approved' && order.approval_status === 'Approved & Dispatched' ||
        filter === 'cancelled' && order.status === 'Cancelled')
      .sort((left, right) => right.created_at - left.created_at || right.id - left.id)
      .map((order) => ({
        ...order,
        items: state.orderItems
          .filter((item) => item.order_id === order.id)
          .map(({ brand, model, tyre_size, quantity, unit_price, subtotal_amount, gst_amount }) => ({
            brand,
            model,
            tyreSize: tyre_size,
            quantity,
            unitPrice: unit_price,
            subtotal: subtotal_amount,
            gstAmount: gst_amount
          }))
      }));
  }
  throw new Error(`Unexpected all query in test adapter: ${sql}`);
}

async function withTransaction(operation) {
  const snapshot = cloneState();
  try {
    return await operation({});
  } catch (error) {
    restoreState(snapshot);
    throw error;
  }
}

const nativeFetch = global.fetch.bind(globalThis);
global.fetch = async (url, options) => {
  if (String(url) !== 'https://api.resend.com/emails') return nativeFetch(url, options);
  sentEmails.push(JSON.parse(options.body));
  return { ok: true, status: 200 };
};

const databasePath = require.resolve('../database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: { all, get, initializeDatabase: async () => {}, pool: {}, run, withTransaction }
};

const { app } = require('../server');
const { products: catalogProducts } = require('../public/catalog-data');
const origin = 'https://brilliant-semifreddo-ca3b22.netlify.app';
const server = app.listen(0);

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function request(path, { method = 'GET', body, cookie, originHeader = origin } = {}) {
  const headers = { Origin: originHeader };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  return { response, result };
}

function sessionCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie?.startsWith('apextyre_customer='));
  assert.match(setCookie, /;\s*Path=\/api(?:;|$)/i);
  return setCookie.split(';', 1)[0];
}

test('storefront browsing and cart remain public, while checkout resumes after customer authentication', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');
  const markup = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const backend = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const addToCartStart = frontend.indexOf('window.addToCart = function addToCart');
  const addToCartEnd = frontend.indexOf('\nfunction changeCartQuantity', addToCartStart);
  assert.notEqual(addToCartStart, -1);
  assert.notEqual(addToCartEnd, -1);
  const addToCart = frontend.slice(addToCartStart, addToCartEnd);

  assert.match(frontend, /data-product-action="add-to-cart"/);
  assert.match(addToCart, /persistCart\(\);\s*renderCart\(\);/);
  assert.doesNotMatch(addToCart, /customerApi|customer-login/);
  assert.match(frontend, /function requestCustomerSignIn\(items, source, formValues = null\)/);
  assert.match(frontend, /items: items\.map\(\(item\) => \(\{ \.\.\.item \}\)\)[\s\S]*formValues: formValues \? \{ \.\.\.formValues \} : null/);
  assert.match(frontend, /function resumePendingCheckout\(\)[\s\S]*openCheckout\(checkout\.items, checkout\.source, checkout\.formValues\)/);
  assert.match(frontend, /function beginCustomerCheckout\(items, source, formValues = null\)[\s\S]*customerApi\('\/api\/customer\/me'\)[\s\S]*requestCustomerSignIn\(items, source, formValues\)/);
  assert.equal((frontend.match(/if \(resumePendingCheckout\(\)\)/g) || []).length, 2);
  assert.match(frontend, /checkoutForm\.addEventListener\('submit'[\s\S]*customerApi\('\/api\/customer\/me'\)[\s\S]*apiFetch\('\/api\/place-order'/);
  assert.match(backend, /app\.post\('\/api\/place-order', requireCustomerRequestOrigin, requireCustomerSession, placeCustomerOrder\)/);
  const orderHandler = backend.slice(
    backend.indexOf('async function placeCustomerOrder'),
    backend.indexOf("app.get('/api/orders/:orderCode/status'")
  );
  assert.doesNotMatch(orderHandler, /body\.customer_id|body\[['"]customer_id['"]\]/);
  assert.match(markup, /data-view-panel="customer-login"/);
  assert.match(markup, /data-view-panel="customer-register"/);
  assert.doesNotMatch(markup, /Guest Checkout/i);
});

test('owner login remains separate from customer authentication', async () => {
  const ownerLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { username: 'test-owner', password: 'test-owner-password' }
  });
  assert.equal(ownerLogin.response.status, 200);
  const ownerCookie = ownerLogin.response.headers.get('set-cookie');
  assert.ok(ownerCookie?.startsWith('apextyre_owner='));
  const ownerSession = ownerCookie.split(';', 1)[0];
  const ownerProfile = await request('/api/admin/me', { cookie: ownerSession });
  assert.equal(ownerProfile.response.status, 200);
  const ownerCannotPlaceCustomerOrder = await request('/api/place-order', {
    method: 'POST',
    body: {},
    cookie: ownerSession
  });
  assert.equal(ownerCannotPlaceCustomerOrder.response.status, 401);

  const customerLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { username: 'test-owner', password: 'customer-password' }
  });
  assert.equal(customerLogin.response.status, 401);
});

test('OTP-free customer registration, secure sessions, authenticated customer orders and checkout', async () => {
  const publicCatalog = await request('/api/products');
  assert.equal(publicCatalog.response.status, 200);
  assert.deepEqual(publicCatalog.result, []);

  const registration = {
    fullName: 'Avery Morgan',
    email: ' CUSTOMER@example.test ',
    mobileNumber: '9876543210',
    password: 'A1bcde'
  };
  assert.deepEqual(Object.keys(registration), ['fullName', 'email', 'mobileNumber', 'password']);

  const badOrigin = await request('/api/customer/register', {
    method: 'POST',
    originHeader: 'https://attacker.example',
    body: registration
  });
  assert.equal(badOrigin.response.status, 403);

  const invalidRegistration = await request('/api/customer/register', {
    method: 'POST',
    body: { ...registration, password: 'short' }
  });
  assert.equal(invalidRegistration.response.status, 400);
  assert.equal(invalidRegistration.result.error, 'Password must be at least 6 characters long.');

  const overlongPassword = await request('/api/customer/register', {
    method: 'POST',
    body: { ...registration, password: 'A'.repeat(73) }
  });
  assert.equal(overlongPassword.response.status, 400);
  assert.equal(
    overlongPassword.result.error,
    'Check your name, email, mobile number, and password requirements.'
  );

  const registered = await request('/api/customer/register', {
    method: 'POST',
    body: registration
  });
  assert.equal(registered.response.status, 202);
  const firstAccount = state.accounts.get('customer@example.test');
  assert.ok(firstAccount.password_hash.startsWith('$2'));
  assert.notEqual(firstAccount.password_hash, registration.password);
  assert.equal(firstAccount.email_verified, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sentEmails.length, 0, 'registration must not send email');

  const duplicate = await request('/api/customer/register', {
    method: 'POST',
    body: registration
  });
  assert.equal(duplicate.response.status, 202);
  assert.equal(duplicate.result.message, registered.result.message);
  assert.equal(state.accounts.size, 1);

  const wrongPassword = await request('/api/customer/login', {
    method: 'POST',
    body: { email: registration.email, password: 'wrong-password-123' }
  });
  assert.equal(wrongPassword.response.status, 401);

  const login = await request('/api/customer/login', {
    method: 'POST',
    body: { email: registration.email, password: registration.password }
  });
  assert.equal(login.response.status, 200);
  assert.doesNotMatch(JSON.stringify(login.result), /password_hash|token/i);
  assert.equal(firstAccount.email_verified, false);
  const customerCookie = sessionCookie(login.response);
  const sessionToken = decodeURIComponent(customerCookie.split('=')[1]);
  assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);
  const storedSession = [...state.sessions.values()][0];
  assert.equal(storedSession.customer_id, firstAccount.id);
  assert.match([...state.sessions.keys()][0], /^[a-f0-9]{64}$/);

  const profile = await request('/api/customer/me', { cookie: customerCookie });
  assert.equal(profile.response.status, 200);
  assert.deepEqual(profile.result.customer, {
    id: firstAccount.id,
    fullName: 'Avery Morgan',
    email: 'customer@example.test',
    mobileNumber: '9876543210'
  });
  assert.doesNotMatch(JSON.stringify(profile.result), /password|hash|token|secret/i);

  const invalidFilter = await request('/api/customer/orders?filter=other', { cookie: customerCookie });
  assert.equal(invalidFilter.response.status, 400);

  const orderPayload = {
    fullName: 'Avery Morgan',
    phone: '9876543210',
    email: 'customer@example.test',
    address: '1 Test Road',
    pincode: '411001',
    city: 'Pune',
    state: 'Maharashtra',
    paymentMethod: 'cod',
    customer_id: 99999,
    items: [{ catalogKey: catalogProducts[0].catalog_key, quantity: 1 }]
  };
  const unauthenticatedOrder = await request('/api/place-order', {
    method: 'POST',
    body: orderPayload
  });
  assert.equal(unauthenticatedOrder.response.status, 401);
  assert.equal(state.orders.length, 0);

  const disallowedOriginOrder = await request('/api/place-order', {
    method: 'POST',
    originHeader: 'https://attacker.example',
    body: orderPayload,
    cookie: customerCookie
  });
  assert.equal(disallowedOriginOrder.response.status, 403);
  assert.equal(state.orders.length, 0);

  const customerOrder = await request('/api/place-order', {
    method: 'POST',
    body: orderPayload,
    cookie: customerCookie
  });
  assert.equal(customerOrder.response.status, 201);
  assert.equal(state.orders[0].customer_id, firstAccount.id);

  const ownOrders = await request('/api/customer/orders', { cookie: customerCookie });
  assert.equal(ownOrders.response.status, 200);
  assert.equal(ownOrders.result.orders.length, 1);
  assert.equal(ownOrders.result.orders[0].order_code, customerOrder.result.orderCode);
  assert.equal(ownOrders.result.orders[0].items[0].quantity, 1);

  const secondRegistration = {
    fullName: 'Another Customer',
    email: 'another@example.test',
    mobileNumber: '9876543211',
    password: 'another-strong-password-123'
  };
  const secondRegistered = await request('/api/customer/register', {
    method: 'POST',
    body: secondRegistration
  });
  assert.equal(secondRegistered.response.status, 202);
  assert.equal(state.accounts.get('another@example.test').email_verified, false);
  const secondLogin = await request('/api/customer/login', {
    method: 'POST',
    body: { email: secondRegistration.email, password: secondRegistration.password }
  });
  assert.equal(secondLogin.response.status, 200);
  const secondCookie = sessionCookie(secondLogin.response);
  const otherCustomersOrders = await request(
    `/api/customer/orders?customer_id=${firstAccount.id}`,
    { cookie: secondCookie }
  );
  assert.equal(otherCustomersOrders.response.status, 200);
  assert.equal(otherCustomersOrders.result.orders.length, 0);

  const logout = await request('/api/customer/logout', {
    method: 'POST',
    body: {},
    cookie: customerCookie
  });
  assert.equal(logout.response.status, 200);
  const revokedProfile = await request('/api/customer/me', { cookie: customerCookie });
  assert.equal(revokedProfile.response.status, 401);
  const revokedCustomerOrder = await request('/api/place-order', {
    method: 'POST',
    body: orderPayload,
    cookie: customerCookie
  });
  assert.equal(revokedCustomerOrder.response.status, 401);
  assert.equal(state.orders.length, 1);

  now += 8 * 60 * 60 * 1000;
  const expiredLogin = await request('/api/customer/login', {
    method: 'POST',
    body: { email: registration.email, password: registration.password }
  });
  assert.equal(expiredLogin.response.status, 200);
  const expiredCookie = sessionCookie(expiredLogin.response);
  now += 8 * 60 * 60 * 1000 + 1;
  const expiredProfile = await request('/api/customer/me', { cookie: expiredCookie });
  assert.equal(expiredProfile.response.status, 401);
});
