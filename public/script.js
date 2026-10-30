const API_BASE_URL = window.APEXTYRE_API_URL ||
  (['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? window.location.origin
    : 'https://apextyers2.onrender.com');

function apiUrl(path) {
  if (!API_BASE_URL) throw new Error('Set APEXTYRE_API_URL in api-config.js to your Render backend URL.');
  return new URL(path, `${API_BASE_URL.replace(/\/+$/, '')}/`).toString();
}

function apiFetch(path, options = {}) {
  const headers = {
    ...(options.method?.toUpperCase() === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
    'ngrok-skip-browser-warning': 'true'
  };
  return fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers
  }).catch((error) => {
    if (error instanceof TypeError) {
      throw new Error(`Could not reach the ApexTyre API at ${API_BASE_URL}. Check the Render service and CORS configuration.`);
    }
    throw error;
  });
}

const productList = document.querySelector('#product-list');
const searchInput = document.querySelector('#product-search');
const filterChips = [...document.querySelectorAll('.filter-chip')];
const sortSelect = document.querySelector('#sort-products');
const resultsCount = document.querySelector('#results-count');
const checkoutDialog = document.querySelector('#checkout-dialog');
const checkoutForm = document.querySelector('#checkout-form');
const checkoutError = document.querySelector('#checkout-error');
const cartDialog = document.querySelector('#cart-dialog');
const cartItemsContainer = document.querySelector('#cart-items');
const cartCount = document.querySelector('#cart-count');
const cartCheckoutButton = document.querySelector('#cart-checkout');
const orderConfirmationDialog = document.querySelector('#order-confirmation-dialog');
const customerInvoiceDownload = document.querySelector('#customer-invoice-download');
const exactMoney = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const quoteDialog = document.querySelector('#quote-dialog');
const quoteForm = document.querySelector('#quote-form');
const ownerDialog = document.querySelector('#owner-dialog');
const ownerForm = document.querySelector('#owner-form');
const toast = document.querySelector('#toast');
const themeToggle = document.querySelector('#theme-toggle');
const themeIcon = themeToggle.querySelector('[data-theme-icon]');
const customerRegisterForm = document.querySelector('#customer-register-form');
const customerLoginForm = document.querySelector('#customer-login-form');
const customerAccountNav = document.querySelector('#customer-account-nav');
const themeStorageKey = 'theme';

const supplierPhone = '+918999210727';
const supplierWhatsApp = '918999210727';
const deliveryCharge = 99;
const cartStorageKey = 'apextyre_cart_v1';
const fallbackImage = 'https://images.unsplash.com/photo-1578844251758-2f71da64c96f?w=600&auto=format&fit=crop&q=80';
const tyreImageSources = [
  'https://images.unsplash.com/photo-1542377281-73d08e3a10aa',
  'https://images.unsplash.com/photo-1558980394-4c7c9299fe96',
  'https://images.unsplash.com/photo-1571335746824-742511d49bce',
  'https://images.unsplash.com/photo-1592853625601-bb9d23da12fc',
  'https://images.unsplash.com/photo-1601411101851-ea0e07766235',
  'https://images.unsplash.com/photo-1608248086047-12d70e2cd870',
  'https://images.unsplash.com/photo-1621712151262-60bd142ba19f',
  'https://plus.unsplash.com/premium_photo-1664303727151-4c345687204a',
  'https://plus.unsplash.com/premium_photo-1673208484517-deeab27359b4',
  'https://plus.unsplash.com/premium_photo-1679826780160-b6376c899fe5',
  'https://plus.unsplash.com/premium_photo-1683134240084-ba074973f75e',
  'https://plus.unsplash.com/premium_photo-1694670121843-79b433c4ed59'
];
function productImageUrl(source, index) {
  const image = new URL(source);
  image.searchParams.set('auto', 'format');
  image.searchParams.set('fit', 'crop');
  image.searchParams.set('w', String(1200 + index));
  image.searchParams.set('q', '90');
  return image.href;
}

const products = window.ApexTyreCatalog.products.map((catalogProduct) => ({
  ...catalogProduct,
  id: `catalog:${encodeURIComponent(catalogProduct.catalog_key)}`,
  inventory_id: null,
  image_url: productImageUrl(
    tyreImageSources[catalogProduct.listing_index % tyreImageSources.length],
    catalogProduct.listing_index
  ),
  demo_listing: true
}));
if (new Set(products.map((product) => product.image_url)).size !== products.length) {
  throw new Error('Each demo listing must have a unique image URL.');
}
let allProducts = [...products];
let selectedFilter = 'all';
let toastTimer;
let customerOrderPollTimer;
let cartItems = [];
let checkoutItems = [];
let checkoutSource = 'single';
let currentCustomer = null;
let pendingCheckout = null;

function applyTheme(theme) {
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', activeTheme === 'dark');
  document.body.dataset.theme = activeTheme;
  themeToggle.setAttribute('aria-pressed', String(activeTheme === 'dark'));
  themeToggle.setAttribute(
    'aria-label',
    `Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} theme`
  );
  themeIcon.textContent = activeTheme === 'dark' ? '☀️' : '🌙';
}

try {
  applyTheme(
    window.localStorage.getItem(themeStorageKey)
      || window.localStorage.getItem('apextyre_theme_v1')
      || 'dark'
  );
} catch (error) {
  console.warn('Could not read the saved theme preference:', error);
  applyTheme('dark');
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function safe(value) {
  const element = document.createElement('span');
  element.textContent = value ?? '';
  return element.innerHTML;
}

function finalPrice(product) {
  return Number(product.price) * (1 - Number(product.discount || 0) / 100);
}

function cartQuantityLimit(product) {
  const stock = Number(product.stock_quantity);
  return product.demo_listing || stock < 1 ? 10 : Math.max(1, Math.min(10, stock));
}

function aspectRatio(product) {
  return product.tyre_size?.match(/\d{3}\/(\d{2})/)?.[1] || 'Ask supplier';
}

window.apexTyreImageFallback = function fallbackTyreImage(image) {
  image.onerror = null;
  image.src = fallbackImage;
};

function matchesFilter(product, filter) {
  const brand = String(product.brand || '').toLowerCase();
  const model = String(product.model || '').toLowerCase();
  const vehicle = String(product.vehicle_type || '').toLowerCase();

  if (filter === 'all') return true;
  if (filter.startsWith('brand:')) return brand === filter.slice(6).toLowerCase();
  if (filter === 'below:3000') return finalPrice(product) < 3000;
  if (filter === 'tubeless') return product.tubeless !== false;
  if (filter === 'suv') return /suv|jeep|crossover/.test(`${vehicle} ${model}`);
  if (filter === 'sports') {
    return /sport|performance/.test(vehicle) || /eagle f1|primacy|turanza|sport/.test(model);
  }
  return true;
}

function renderProducts() {
  const query = searchInput.value.trim().toLowerCase();
  const products = allProducts.filter((product) => {
    const searchable = [
      product.brand,
      product.model,
      product.tyre_size,
      product.rim_size,
      product.vehicle_type
    ].join(' ').toLowerCase();
    return searchable.includes(query) && matchesFilter(product, selectedFilter);
  });

  if (sortSelect.value === 'price-low') products.sort((a, b) => finalPrice(a) - finalPrice(b));
  if (sortSelect.value === 'price-high') products.sort((a, b) => finalPrice(b) - finalPrice(a));
  if (sortSelect.value === 'brand') products.sort((a, b) => a.brand.localeCompare(b.brand));
  resultsCount.textContent = products.length;

  if (!products.length) {
    productList.innerHTML = '<div class="market-empty"><span>⌕</span><h3>No matching tyres found</h3><p>Try a different search or select another category.</p><button class="reset-filters" type="button">Clear filters</button></div>';
    productList.querySelector('.reset-filters').addEventListener('click', clearFilters);
    return;
  }

  productList.innerHTML = products.map((product) => {
    const price = finalPrice(product);
    const imageUrl = product.image_url || fallbackImage;
    const image = `<img src="${safe(imageUrl)}" alt="Illustrative tyre photo for ${safe(product.brand)} ${safe(product.model)}" loading="lazy" onerror="this.onerror=null; this.src='${fallbackImage}';">`;
    const stockText = product.demo_listing || Number(product.stock_quantity) < 1
      ? 'Special order · confirm stock'
      : 'In stock · ready to order';
    const unavailable = !product.demo_listing && Number(product.stock_quantity) < 1;
    return `
      <article class="market-card">
        <div class="market-card-image">
          ${image}
          <span class="market-stock ${unavailable ? 'stock-check' : ''}"><i></i>${stockText}</span>
          ${Number(product.discount) ? `<span class="market-discount">${safe(product.discount)}% OFF</span>` : ''}
          <button class="image-enquire" type="button" data-quote-key="${safe(product.catalog_key || `${product.brand}|${product.model}|${product.tyre_size}`)}" aria-label="Ask about ${safe(product.brand)} ${safe(product.model)}">Ask supplier ↗</button>
        </div>
        <div class="market-card-body">
          <div class="market-brand-row"><span class="brand-badge">${safe(product.brand)}</span><span class="vehicle-label">${safe(product.vehicle_type)}</span></div>
          <h3>${safe(product.brand)} ${safe(product.model)}</h3>
          ${product.demo_listing ? '<span class="demo-listing-badge">SPECIAL ORDER · OWNER CONFIRMATION</span>' : ''}
          <p class="market-size">${safe(product.tyre_size)} <span>·</span> ${safe(product.vehicle_type)} tyre</p>
          <div class="spec-grid">
            <div><small>RIM DIAMETER</small><strong>${safe(product.rim_size)} inch</strong></div>
            <div><small>ASPECT RATIO</small><strong>${safe(aspectRatio(product))}</strong></div>
            <div><small>CONSTRUCTION</small><strong>${product.tubeless === false ? 'Tube type' : 'Tubeless*'}</strong></div>
          </div>
          <div class="market-price-row"><div><small>PRICE PER PIECE</small><strong>${money(price)}</strong></div>${Number(product.discount) ? `<del>${money(product.price)}</del>` : ''}</div>
          <p class="fitment-note">*Confirm exact tyre variant and vehicle fitment with supplier.</p>
          <div class="market-card-actions">
            <a class="contact-supplier" href="https://wa.me/918999210727?text=Hi,%20I%20am%20interested%20in%20buying%20tyres" target="_blank" rel="noopener noreferrer">Contact Supplier</a>
            <a class="call-supplier" href="tel:${supplierPhone}" aria-label="Call ApexTyre about ${safe(product.brand)} ${safe(product.model)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.8a15 15 0 0 0 5.7 5.7L16 13l5 2v4a2 2 0 0 1-2 2C10 20.5 3.5 14 3 5a2 2 0 0 1 2-2Z"/></svg><span>Call Now</span></a>
            <button class="add-to-cart" type="button" data-product-action="add-to-cart" data-product-id="${safe(product.id)}">Add to Cart</button>
            <button class="buy-now" type="button" data-product-action="buy-now" data-product-id="${safe(product.id)}">Buy Now</button>
          </div>
        </div>
      </article>`;
  }).join('');

  productList.querySelectorAll('[data-quote-key]').forEach((button) => {
    button.addEventListener('click', () => openQuote(button.dataset.quoteKey));
  });
}

function clearFilters() {
  searchInput.value = '';
  selectedFilter = 'all';
  filterChips.forEach((chip) => {
    const active = chip.dataset.filter === 'all';
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
}

async function loadProducts() {
  productList.innerHTML = '<p class="market-notice">Loading tyre catalog…</p>';
  try {
    const response = await apiFetch('/api/products');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the tyre catalog.');
    if (!Array.isArray(result)) throw new Error('The product catalog returned an unexpected response.');
    const storedBySku = new Map(result.map((product) => [
      `${product.brand.toLowerCase()}|${product.model.toLowerCase()}|${product.tyre_size.toLowerCase()}`,
      product
    ]));
    const storedByBrandModel = new Map();
    result.forEach((product) => {
      const key = `${product.brand.toLowerCase()}|${product.model.toLowerCase()}`;
      const matches = storedByBrandModel.get(key) || [];
      matches.push(product);
      storedByBrandModel.set(key, matches);
    });
    const matchedStoredIds = new Set();
    allProducts = products.map((demoProduct) => {
      const brandModelKey = `${demoProduct.brand.toLowerCase()}|${demoProduct.model.toLowerCase()}`;
      const key = `${brandModelKey}|${demoProduct.tyre_size.toLowerCase()}`;
      const modelMatches = storedByBrandModel.get(brandModelKey) || [];
      const stored = storedBySku.get(key) ||
        modelMatches.find((product) => Number(product.stock_quantity) > 0) ||
        modelMatches[0];
      if (!stored) return demoProduct;
      matchedStoredIds.add(String(stored.id));
      return {
        ...demoProduct,
        ...stored,
        id: stored.id,
        inventory_id: stored.id,
        demo_listing: false,
        catalog_key: demoProduct.catalog_key
      };
    });
    allProducts.push(...result
      .filter((product) => !matchedStoredIds.has(String(product.id)))
      .map((product) => ({ ...product, inventory_id: product.id, demo_listing: false })));
    const migratedCart = new Map();
    let cartChanged = false;
    cartItems.forEach((item) => {
      const product = item.productId
        ? allProducts.find((entry) => String(entry.inventory_id) === String(item.productId))
        : allProducts.find((entry) => entry.catalog_key === item.catalogKey);
      const migrated = product?.inventory_id
        ? {
            key: productCartKey(product),
            productId: Number(product.inventory_id),
            catalogKey: product.catalog_key || item.catalogKey || '',
            quantity: item.quantity
          }
        : item;
      if (migrated.key !== item.key || migrated.productId !== item.productId) cartChanged = true;
      const existing = migratedCart.get(migrated.key);
      if (existing) {
        existing.quantity += migrated.quantity;
        if (!existing.catalogKey && migrated.catalogKey) existing.catalogKey = migrated.catalogKey;
        cartChanged = true;
      } else {
        migratedCart.set(migrated.key, migrated);
      }
    });
    cartItems = [...migratedCart.values()];
    if (cartChanged) persistCart();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error('Could not load stored inventory; showing demo listings instead:', error);
    allProducts = products;
    renderProducts();
    renderCart();
    showToast('Showing demo listings. Stored stock and checkout are unavailable until the server reconnects.');
  }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 5000);
}

async function customerApi(path, options = {}) {
  const response = await apiFetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'The customer account request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function customerJsonRequest(method, payload) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function showCustomerProfile(customer) {
  currentCustomer = customer;
  document.querySelector('#customer-profile-name').textContent = customer.fullName || '';
  document.querySelector('#customer-profile-email').textContent = customer.email || '';
  document.querySelector('#customer-profile-mobile').textContent = customer.mobileNumber || '';
  customerAccountNav.dataset.viewLink = 'customer-account';
  customerAccountNav.querySelector('strong').textContent = 'My Account';
  customerAccountNav.querySelector('small').textContent = customer.fullName || 'Customer';
}

async function loadCustomerOrders() {
  const ordersStatus = document.querySelector('#customer-orders-status');
  const ordersList = document.querySelector('#customer-orders-list');
  const filter = document.querySelector('#customer-order-filter').value;
  ordersStatus.textContent = 'Loading your orders…';
  ordersList.replaceChildren();
  try {
    const result = await customerApi(`/api/customer/orders?filter=${encodeURIComponent(filter)}`);
    const orders = Array.isArray(result.orders) ? result.orders : [];
    ordersStatus.textContent = '';
    if (!orders.length) {
      ordersList.innerHTML = '<p class="customer-empty">No orders match this filter.</p>';
      return;
    }

    ordersList.innerHTML = orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemMarkup = items.map((item) =>
        `<div>${safe(item.brand)} ${safe(item.model)} (${safe(item.tyreSize)}) · Qty ${safe(item.quantity)} · ${exactMoney.format(Number(item.subtotal) || 0)}</div>`
      ).join('');
      const orderDate = new Date(order.created_at);
      const dateText = Number.isNaN(orderDate.getTime())
        ? ''
        : orderDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      return `<article class="customer-order-card">
        <div class="customer-order-top">
          <strong>Order ${safe(order.order_code || order.id)}</strong>
          <time>${safe(dateText)}</time>
        </div>
        <div class="customer-order-items">${itemMarkup || '<div>Order details unavailable.</div>'}</div>
        <div class="customer-order-meta">
          <span>Approval: <strong>${safe(order.approval_status)}</strong></span>
          <span>Order status: <strong>${safe(order.status)}</strong></span>
          <span>Subtotal: <strong>${exactMoney.format(Number(order.subtotal_amount) || 0)}</strong></span>
          <span>GST: <strong>${exactMoney.format(Number(order.gst_amount) || 0)}</strong></span>
          <span>Delivery: <strong>${exactMoney.format(Number(order.delivery_amount) || 0)}</strong></span>
          <span>Total: <strong>${exactMoney.format(Number(order.total_amount) || 0)}</strong></span>
        </div>
      </article>`;
    }).join('');
  } catch (error) {
    ordersStatus.textContent = error.message;
  }
}

async function openCustomerAccount() {
  try {
    const result = await customerApi('/api/customer/me');
    showCustomerProfile(result.customer);
    switchTab('customer-account');
    await loadCustomerOrders();
  } catch (error) {
    currentCustomer = null;
    switchTab('customer-login');
    showToast(error.message || 'Sign in to view your account.');
  }
}

async function refreshCustomerSession() {
  try {
    const result = await customerApi('/api/customer/me');
    showCustomerProfile(result.customer);
  } catch {
    currentCustomer = null;
  }
}

function switchTab(viewName) {
  const allowedViews = [
    'home', 'about', 'contact', 'community',
    'customer-register', 'customer-login', 'customer-account'
  ];
  const view = allowedViews.includes(viewName) ? viewName : 'home';
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const active = tab.dataset.viewLink === view;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.querySelector('#header-utilities').classList.remove('menu-open');
  document.querySelector('#mobile-menu-button').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restoreCart() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(cartStorageKey) || '[]');
    if (!Array.isArray(stored)) throw new Error('Saved cart data is not a list.');
    const restored = new Map();
    stored.forEach((item) => {
      const key = item.catalogKey && !item.productId
        ? `demo:${String(item.catalogKey)}`
        : Number.isInteger(Number(item.productId)) && Number(item.productId) > 0
          ? `id:${Number(item.productId)}`
          : '';
      if (!key || restored.size >= 10 && !restored.has(key)) return;
      const quantity = Math.max(1, Math.min(10, Math.floor(Number(item.quantity) || 1)));
      const existing = restored.get(key);
      if (existing) existing.quantity = Math.min(10, existing.quantity + quantity);
      else restored.set(key, {
        key,
        productId: Number.isInteger(Number(item.productId)) && Number(item.productId) > 0
          ? Number(item.productId)
          : null,
        catalogKey: String(item.catalogKey || ''),
        quantity
      });
    });
    return [...restored.values()];
  } catch (error) {
    console.error('Could not restore the saved shopping cart:', error);
    return [];
  }
}

function persistCart() {
  try {
    window.localStorage.setItem(cartStorageKey, JSON.stringify(cartItems.map((item) => ({
      productId: item.productId,
      catalogKey: item.catalogKey,
      quantity: item.quantity
    }))));
  } catch (error) {
    console.error('Could not save the shopping cart in this browser:', error);
    showToast('Cart changes are temporary because browser storage is unavailable.');
  }
}

function productCartKey(product) {
  return product.inventory_id
    ? `id:${Number(product.inventory_id)}`
    : `demo:${product.catalog_key}`;
}

function cartProduct(item) {
  return allProducts.find((product) => productCartKey(product) === item.key);
}

function itemSubtotalCents(product, quantity) {
  return Math.round(finalPrice(product) * 100) * quantity;
}

function renderCart() {
  const quantityCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = quantityCount;
  document.querySelector('#cart-title-count').textContent = `(${quantityCount})`;

  const resolvedItems = cartItems.map((item) => ({ item, product: cartProduct(item) }));
  const readyItems = resolvedItems.filter(({ product }) => product);
  if (!resolvedItems.length) {
    cartItemsContainer.innerHTML = '<div class="cart-empty"><span aria-hidden="true">🛒</span><strong>Your cart is empty</strong><p>Add any catalogue tyre to start an order request.</p></div>';
  } else {
    cartItemsContainer.innerHTML = resolvedItems.map(({ item, product }) => {
      if (!product) {
        return `<article class="cart-item cart-item-unavailable">
          <div><strong>Unavailable catalogue item</strong><small>This tyre listing is no longer available.</small></div>
          <button class="cart-remove" type="button" data-cart-remove="${safe(item.key)}">Remove</button>
        </article>`;
      }
      const inStock = Number(product.stock_quantity) > 0;
      const quantityFits = product.demo_listing || item.quantity <= Number(product.stock_quantity);
      return `<article class="cart-item">
        <div class="cart-item-info">
          <strong>${safe(product.brand)} ${safe(product.model)}</strong>
          <small>${safe(product.tyre_size)} · ${money(finalPrice(product))} each</small>
          ${product.demo_listing || Number(product.stock_quantity) < item.quantity
            ? '<small class="cart-stock-warning">Special order request · the owner will confirm price and availability.</small>'
            : ''}
          ${!product.demo_listing && (!inStock || !quantityFits) ? '<small class="cart-stock-warning">Stock changed. Adjust the quantity or remove this item.</small>' : ''}
        </div>
        <div class="cart-item-controls">
          <div class="cart-quantity-control" aria-label="Quantity for ${safe(product.brand)} ${safe(product.model)}">
            <button type="button" data-cart-step="-1" data-cart-key="${safe(item.key)}" aria-label="Decrease quantity" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
            <span>${item.quantity}</span>
            <button type="button" data-cart-step="1" data-cart-key="${safe(item.key)}" aria-label="Increase quantity" ${item.quantity >= cartQuantityLimit(product) ? 'disabled' : ''}>+</button>
          </div>
          <strong>${money(finalPrice(product) * item.quantity)}</strong>
          <button class="cart-remove" type="button" data-cart-remove="${safe(item.key)}">Remove</button>
        </div>
      </article>`;
    }).join('');
  }

  const subtotalCents = readyItems.reduce((sum, { item, product }) =>
    sum + itemSubtotalCents(product, item.quantity), 0);
  const deliveryCents = readyItems.length ? deliveryCharge * 100 : 0;
  const gstCents = Math.round((subtotalCents + deliveryCents) * 0.18);
  const totalCents = subtotalCents + deliveryCents + gstCents;
  cartItemsContainer.querySelectorAll('[data-cart-step]').forEach((button) => {
    button.addEventListener('click', () => changeCartQuantity(
      button.dataset.cartKey,
      Number(button.dataset.cartStep)
    ));
  });
  cartItemsContainer.querySelectorAll('[data-cart-remove]').forEach((button) => {
    button.addEventListener('click', () => removeFromCart(button.dataset.cartRemove));
  });
  document.querySelector('#cart-summary').innerHTML = `
    <span>Subtotal <strong>${exactMoney.format(subtotalCents / 100)}</strong></span>
    <span>GST (18%) <strong>${exactMoney.format(gstCents / 100)}</strong></span>
    <span>Delivery <strong>${exactMoney.format(deliveryCents / 100)}</strong></span>
    <strong class="checkout-grand-total">Total <span>${exactMoney.format(totalCents / 100)}</span></strong>`;
  cartCheckoutButton.disabled = !resolvedItems.length;
}

function findProductById(productId) {
  return allProducts.find((item) =>
    String(item.id) === String(productId) || productCartKey(item) === String(productId)
  );
}

window.addToCart = function addToCart(productId) {
  const product = findProductById(productId);
  if (!product) {
    showToast('This tyre listing is no longer available.');
    return;
  }
  const key = productCartKey(product);
  const existing = cartItems.find((item) => item.key === key);
  if (existing) {
    const quantityLimit = cartQuantityLimit(product);
    if (existing.quantity >= quantityLimit) {
      showToast(`Only ${product.stock_quantity} of this tyre are currently available.`);
      return;
    }
    existing.quantity += 1;
  } else {
    if (cartItems.length >= 10) {
      showToast('A cart can contain up to 10 different tyre models.');
      return;
    }
    cartItems.push({
      key,
      productId: product.inventory_id ? Number(product.inventory_id) : null,
      catalogKey: product.catalog_key || '',
      quantity: 1
    });
  }
  persistCart();
  renderCart();
  showToast(`${product.brand} ${product.model} added to your cart.`);
  openDialog(cartDialog);
};

function changeCartQuantity(key, delta) {
  const item = cartItems.find((entry) => entry.key === key);
  const product = item && cartProduct(item);
  if (!item || !product) return;
  const nextQuantity = item.quantity + delta;
  if (nextQuantity < 1) return;
  const quantityLimit = cartQuantityLimit(product);
  if (nextQuantity > quantityLimit) {
    showToast(`Only ${product.stock_quantity} of this tyre are currently available.`);
    return;
  }
  item.quantity = nextQuantity;
  persistCart();
  renderCart();
}

function removeFromCart(key) {
  cartItems = cartItems.filter((item) => item.key !== key);
  persistCart();
  renderCart();
}

window.quickBuy = function quickBuy(productId) {
  const product = findProductById(productId);
  if (!product) {
    showToast('This tyre listing is no longer available.');
    return;
  }
  void beginCustomerCheckout([{
    productId: product.inventory_id ? Number(product.inventory_id) : null,
    catalogKey: product.catalog_key || '',
    quantity: 1
  }], 'single');
};

function checkoutLineItems() {
  return checkoutSource === 'single'
    ? [{ ...checkoutItems[0], quantity: Number(checkoutForm.elements.quantity.value) || 1 }]
    : checkoutItems.map((item) => ({ ...item }));
}

function renderCheckoutSummary() {
  const lines = checkoutLineItems().map((item) => ({
    ...item,
    product: allProducts.find((product) =>
      item.productId ? String(product.inventory_id) === String(item.productId) : product.catalog_key === item.catalogKey
    )
  }));
  const subtotalCents = lines.reduce((sum, item) =>
    item.product ? sum + itemSubtotalCents(item.product, item.quantity) : sum, 0);
  const deliveryCents = lines.length ? deliveryCharge * 100 : 0;
  const gstCents = Math.round((subtotalCents + deliveryCents) * 0.18);
  const totalCents = subtotalCents + deliveryCents + gstCents;
  document.querySelector('#selected-product').innerHTML = lines.map(({ product, quantity }) => product
    ? `<div class="checkout-summary-line"><span><strong>${safe(product.brand)} ${safe(product.model)}</strong><small>${safe(product.tyre_size)} · Qty ${quantity}</small>${product.demo_listing || Number(product.stock_quantity) < quantity ? '<small class="cart-stock-warning">Indicative estimate · price and availability confirmed by the owner</small>' : ''}</span><strong>${money(finalPrice(product) * quantity)}</strong></div>`
    : '<div class="checkout-summary-line"><strong>A selected tyre is no longer available.</strong></div>'
  ).join('');
  document.querySelector('#checkout-tax-summary').innerHTML = `
    <span>Tyres subtotal <strong>${exactMoney.format(subtotalCents / 100)}</strong></span>
    <span>Delivery <strong>${exactMoney.format(deliveryCents / 100)}</strong></span>
    <span>GST (18%) <strong>${exactMoney.format(gstCents / 100)}</strong></span>
    <strong class="checkout-grand-total">Total due <span>${exactMoney.format(totalCents / 100)}</span></strong>`;
}

function saveLocalOrderSummary(order, items) {
  const storageKey = 'apextyre_orders_v1';
  const lineItems = items.map((item) => {
    const product = allProducts.find((entry) =>
      item.productId
        ? String(entry.inventory_id) === String(item.productId)
        : entry.catalog_key === item.catalogKey
    );
    return product
      ? { brand: product.brand, model: product.model, tyreSize: product.tyre_size, quantity: item.quantity }
      : null;
  }).filter(Boolean);
  const summary = {
    orderCode: order.orderCode,
    status: 'Pending',
    createdAt: new Date().toISOString(),
    totalAmount: order.totalAmount,
    requiresOwnerConfirmation: Boolean(order.requiresOwnerConfirmation),
    items: lineItems
  };
  try {
    const savedOrders = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    const orders = Array.isArray(savedOrders) ? savedOrders : [];
    window.localStorage.setItem(storageKey, JSON.stringify([
      summary,
      ...orders.filter((savedOrder) => savedOrder && savedOrder.orderCode !== order.orderCode)
    ].slice(0, 50)));
  } catch (error) {
    console.error('Order is saved on the server, but the local order history could not be updated:', error);
    showToast('Your order was received, but local order history could not be saved.');
  }
}

function openCheckout(items, source = 'single', formValues = null) {
  checkoutForm.reset();
  checkoutError.textContent = '';
  checkoutItems = items.map((item) => ({
    productId: item.productId ? Number(item.productId) : null,
    catalogKey: item.catalogKey || '',
    quantity: Number(item.quantity)
  }));
  checkoutSource = source;
  const quantityInput = checkoutForm.elements.quantity;
  const quantityRow = document.querySelector('#checkout-quantity-row');
  const isSingle = source === 'single';
  quantityRow.hidden = !isSingle;
  quantityInput.disabled = !isSingle;
  quantityInput.required = isSingle;
  if (isSingle) {
    const product = allProducts.find((item) =>
      checkoutItems[0]?.productId
        ? String(item.inventory_id) === String(checkoutItems[0].productId)
        : item.catalog_key === checkoutItems[0]?.catalogKey
    );
    if (!product) {
      showToast('This tyre is no longer available in online inventory.');
      return;
    }
    quantityInput.max = cartQuantityLimit(product);
    quantityInput.value = checkoutItems[0].quantity;
  }
  if (formValues) {
    Object.entries(formValues).forEach(([name, value]) => {
      const control = checkoutForm.elements.namedItem(name);
      if (control && 'value' in control) control.value = value;
    });
  }
  renderCheckoutSummary();
  openDialog(checkoutDialog);
}

function requestCustomerSignIn(items, source, formValues = null) {
  pendingCheckout = {
    items: items.map((item) => ({ ...item })),
    source,
    formValues: formValues ? { ...formValues } : null
  };
  closeDialog(checkoutDialog);
  closeDialog(cartDialog);
  switchTab('customer-login');
  showToast('Sign in or create an account to continue checkout.');
}

function resumePendingCheckout() {
  if (!pendingCheckout) return false;
  const checkout = pendingCheckout;
  pendingCheckout = null;
  openCheckout(checkout.items, checkout.source, checkout.formValues);
  return true;
}

async function beginCustomerCheckout(items, source, formValues = null) {
  try {
    const result = await customerApi('/api/customer/me');
    showCustomerProfile(result.customer);
    closeDialog(cartDialog);
    openCheckout(items, source, formValues);
  } catch (error) {
    if (error.status !== 401) {
      showToast(error.message);
      return;
    }
    currentCustomer = null;
    customerAccountNav.dataset.viewLink = 'customer-login';
    customerAccountNav.querySelector('strong').textContent = 'Customer';
    customerAccountNav.querySelector('small').textContent = 'Sign In / Register';
    requestCustomerSignIn(items, source, formValues);
  }
}

async function loadStorefrontSettings() {
  try {
    const response = await apiFetch('/api/storefront-settings', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the current store offer.');
    const offer = String(result.diwaliOffer || '').trim();
    const ticker = document.querySelector('#diwali-ticker');
    ticker.hidden = !offer;
    document.querySelector('#diwali-offer-primary').textContent =
      `🪔 ${offer}   •   FESTIVE TYRE OFFERS   •   `;
    document.querySelector('#diwali-offer-copy').textContent =
      `🪔 ${offer}   •   FESTIVE TYRE OFFERS   •   `;
    document.querySelector('#diwali-offer-accessible').textContent = offer;
  } catch (error) {
    console.error('Could not refresh the storefront offer banner:', error);
  }
}

function showOrderConfirmation(order, customerEmail) {
  const emailDelivery = order.emailDelivery || {};
  const emailStatus = emailDelivery.customerSent
    ? `Your order summary with the GST breakdown has been sent to ${customerEmail}.`
    : emailDelivery.pending
      ? `Your order is saved. The server is attempting to send a confirmation to ${customerEmail}.`
      : emailDelivery.configured
        ? `Your order is saved, but we could not send the email to ${customerEmail}. Please contact ApexTyre to confirm your order.`
        : 'Your order is saved, but email delivery is not configured. Please contact ApexTyre to confirm your order.';
  document.querySelector('#order-confirmation-summary').textContent = order.requiresOwnerConfirmation
    ? `${emailStatus} The owner will confirm special-order price and availability before approval.`
    : `${emailStatus} Owner approval is pending.`;
  document.querySelector('#confirmation-order-code').textContent = order.orderCode;
  document.querySelector('#confirmation-order-total').textContent =
    `Total including 18% GST: ${exactMoney.format(order.totalAmount)}`;
  document.querySelector('#confirmation-order-status').textContent = order.approvalStatus;
  document.querySelector('#confirmation-status-hint').textContent = emailDelivery.customerSent
    ? 'Order Placed Successfully! Your order receipt and GST estimate were sent by email. This is not the final GST invoice; the downloadable GST invoice will be available after owner approval.'
    : 'Your order has been saved. Revenue is recorded only after approval; the final GST invoice will be available here once approved.';
  customerInvoiceDownload.hidden = true;
  customerInvoiceDownload.removeAttribute('href');
  customerInvoiceDownload.dataset.orderCode = order.orderCode;
  customerInvoiceDownload.dataset.invoiceToken = order.invoiceToken;
  orderConfirmationDialog.showModal();
  startCustomerOrderPolling(order.orderCode, order.invoiceToken);
}

function startCustomerOrderPolling(orderCode, invoiceToken) {
  window.clearInterval(customerOrderPollTimer);
  const refreshStatus = async () => {
    try {
      const response = await apiFetch(
        `/api/orders/${encodeURIComponent(orderCode)}/status`,
        { headers: { 'X-Order-Access': invoiceToken } }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not refresh order status.');
      document.querySelector('#confirmation-order-status').textContent = result.approvalStatus;
      if (result.invoiceAvailable) {
        document.querySelector('#confirmation-status-hint').textContent =
          `Approved and dispatched${result.approvedAt ? ` at ${new Date(`${result.approvedAt.replace(' ', 'T')}Z`).toLocaleString()}` : ''}. Your GST invoice is ready.`;
        customerInvoiceDownload.href = apiUrl(`/api/orders/${encodeURIComponent(orderCode)}/invoice`);
        customerInvoiceDownload.hidden = false;
        window.clearInterval(customerOrderPollTimer);
      } else if (result.approvalStatus === 'Rejected') {
        document.querySelector('#confirmation-status-hint').textContent =
          'This order was not approved. Please contact ApexTyre for help.';
        window.clearInterval(customerOrderPollTimer);
      }
    } catch (error) {
      console.error('Could not refresh customer order status:', error);
    }
  };
  refreshStatus();
  customerOrderPollTimer = window.setInterval(refreshStatus, 10000);
}

function openQuote(productKey = '') {
  const product = allProducts.find((item) =>
    item.catalog_key === productKey || String(item.id) === String(productKey)
  );
  const requirement = quoteForm.elements.requirement;
  document.querySelector('#quote-title').textContent = product
    ? `Enquire about ${product.brand} ${product.model}`
    : 'Get your best price';
  requirement.value = product
    ? `${product.brand} ${product.model} — ${product.tyre_size}`
    : '';
  openDialog(quoteDialog);
}

filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    selectedFilter = chip.dataset.filter;
    filterChips.forEach((item) => {
      const active = item === chip;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderProducts();
  });
});

searchInput.addEventListener('input', renderProducts);
sortSelect.addEventListener('change', renderProducts);
productList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-product-action]');
  if (!button) return;

  const productId = button.dataset.productId;
  if (button.dataset.productAction === 'add-to-cart') {
    window.addToCart(productId);
  } else if (button.dataset.productAction === 'buy-now') {
    window.quickBuy(productId);
  }
});
checkoutForm.elements.quantity.addEventListener('input', renderCheckoutSummary);
orderConfirmationDialog.addEventListener('close', () => window.clearInterval(customerOrderPollTimer));
document.querySelector('#open-cart').addEventListener('click', () => {
  renderCart();
  openDialog(cartDialog);
});
cartCheckoutButton.addEventListener('click', () => {
  if (cartCheckoutButton.disabled) return;
  const items = cartItems.map((item) => ({
    productId: item.productId,
    catalogKey: item.catalogKey,
    quantity: item.quantity
  }));
  void beginCustomerCheckout(items, 'cart');
});
customerInvoiceDownload.addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    const response = await apiFetch(customerInvoiceDownload.href, {
      headers: { 'X-Order-Access': customerInvoiceDownload.dataset.invoiceToken }
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Could not download the invoice.');
    }
    const pdf = await response.blob();
    const downloadUrl = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${customerInvoiceDownload.dataset.orderCode}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } catch (error) {
    showToast(error.message);
  }
});
document.querySelector('#header-search').addEventListener('submit', (event) => {
  event.preventDefault();
  switchTab('home');
  document.querySelector('#tyres').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

customerRegisterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector('#customer-register-error');
  const submitButton = customerRegisterForm.querySelector('[type="submit"]');
  const originalLabel = submitButton.textContent;
  errorElement.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Creating account…';
  const form = new FormData(customerRegisterForm);
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  if (Array.from(password).length < 6) {
    errorElement.textContent = 'Password must be at least 6 characters long.';
    customerRegisterForm.elements.password.focus();
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
    return;
  }
  try {
    const result = await customerApi(
      '/api/customer/register',
      customerJsonRequest('POST', Object.fromEntries(form.entries()))
    );
    customerLoginForm.elements.email.value = email;
    customerRegisterForm.reset();
    switchTab('customer-login');
    showToast(result.message || 'If registration can proceed, sign in using that email and password.');
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

customerLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector('#customer-login-error');
  const submitButton = customerLoginForm.querySelector('[type="submit"]');
  const originalLabel = submitButton.textContent;
  errorElement.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Signing in…';
  const form = new FormData(customerLoginForm);
  try {
    await customerApi(
      '/api/customer/login',
      customerJsonRequest('POST', Object.fromEntries(form.entries()))
    );
    const result = await customerApi('/api/customer/me');
    showCustomerProfile(result.customer);
    customerLoginForm.elements.password.value = '';
    if (resumePendingCheckout()) {
      showToast('You are signed in. Complete checkout to place your order.');
    } else {
      switchTab('customer-account');
      await loadCustomerOrders();
    }
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

document.querySelector('#customer-logout').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Signing out…';
  try {
    const result = await customerApi('/api/customer/logout', customerJsonRequest('POST', {}));
    currentCustomer = null;
    customerAccountNav.dataset.viewLink = 'customer-login';
    customerAccountNav.querySelector('strong').textContent = 'Customer';
    customerAccountNav.querySelector('small').textContent = 'Sign In / Register';
    switchTab('customer-login');
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

document.querySelector('#customer-order-filter').addEventListener('change', () => {
  if (currentCustomer) void loadCustomerOrders();
});

document.querySelectorAll('[data-view-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (link.dataset.viewLink === 'customer-account') {
      void openCustomerAccount();
    } else {
      switchTab(link.dataset.viewLink);
    }
  });
});
themeToggle.addEventListener('click', () => {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  try {
    window.localStorage.setItem(themeStorageKey, nextTheme);
  } catch (error) {
    console.warn('Could not save the theme preference:', error);
  }
});
document.querySelectorAll('[data-open-quote]').forEach((button) => {
  button.addEventListener('click', () => openQuote());
});
document.querySelectorAll('[data-open-owner]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#owner-error').textContent = '';
    ownerForm.reset();
    const passwordInput = ownerForm.elements.password;
    const passwordToggle = ownerForm.querySelector('[data-password-toggle]');
    passwordInput.type = 'password';
    passwordToggle.setAttribute('aria-label', 'Show password');
    passwordToggle.setAttribute('aria-pressed', 'false');
    openDialog(ownerDialog);
  });
});
ownerForm.querySelector('[data-password-toggle]').addEventListener('click', (event) => {
  const toggle = event.currentTarget;
  const passwordInput = ownerForm.elements.password;
  const isVisible = passwordInput.type === 'text';
  passwordInput.type = isVisible ? 'password' : 'text';
  toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
  toggle.setAttribute('aria-pressed', String(!isVisible));
});
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')));
});
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
});
document.querySelectorAll('[data-scroll-catalog]').forEach((button) => {
  button.addEventListener('click', () => {
    switchTab('home');
    window.setTimeout(() => document.querySelector('#tyres').scrollIntoView({ behavior: 'smooth' }), 50);
  });
});

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  checkoutError.textContent = '';
  const submitButton = checkoutForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const payload = Object.fromEntries(new FormData(checkoutForm).entries());
  const items = checkoutLineItems();
  if (!items.length || items.some((item) =>
    (!item.productId && !item.catalogKey) || item.quantity < 1 || item.quantity > 10
  )) {
    checkoutError.textContent = 'Review the tyre quantities and try again.';
    submitButton.disabled = false;
    return;
  }
  payload.items = items;
  delete payload.quantity;
  try {
    await customerApi('/api/customer/me');
    const response = await apiFetch('/api/place-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'Could not place your order.');
      error.status = response.status;
      throw error;
    }
    saveLocalOrderSummary(result, items);
    if (checkoutSource === 'cart') {
      cartItems = [];
      persistCart();
      renderCart();
    }
    closeDialog(checkoutDialog);
    showOrderConfirmation(result, String(payload.email));
    await loadProducts();
  } catch (error) {
    if (error.status === 401) {
      requestCustomerSignIn(items, checkoutSource, Object.fromEntries(new FormData(checkoutForm).entries()));
    } else {
      checkoutError.textContent = error.message;
    }
  } finally {
    submitButton.disabled = false;
  }
});

quoteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const details = new FormData(quoteForm);
  const message = [
    'ApexTyre price enquiry',
    `Name: ${details.get('name')}`,
    `Phone: ${details.get('phone')}`,
    `Requirement: ${details.get('requirement')}`,
    `Location: ${document.querySelector('#location-select').value}`
  ].join('\n');
  window.open(`https://wa.me/${supplierWhatsApp}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  closeDialog(quoteDialog);
  showToast('Your enquiry is ready to send to our team on WhatsApp.');
});

ownerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorMessage = document.querySelector('#owner-error');
  const submitButton = ownerForm.querySelector('[type="submit"]');
  errorMessage.textContent = '';
  submitButton.disabled = true;
  try {
    const response = await apiFetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: new FormData(ownerForm).get('username'),
        password: new FormData(ownerForm).get('password')
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not sign in.');
    window.location.assign('admin.html');
  } catch (error) {
    errorMessage.textContent = error.message;
    submitButton.disabled = false;
  }
});

document.querySelector('#mobile-menu-button').addEventListener('click', (event) => {
  const utilities = document.querySelector('#header-utilities');
  const isOpen = utilities.classList.toggle('menu-open');
  event.currentTarget.setAttribute('aria-expanded', String(isOpen));
});
document.querySelector('#current-year').textContent = new Date().getFullYear();

cartItems = restoreCart();
renderCart();
void refreshCustomerSession();
loadProducts();
loadStorefrontSettings();
window.setInterval(() => {
  if (document.visibilityState === 'visible') loadStorefrontSettings();
}, 30000);
