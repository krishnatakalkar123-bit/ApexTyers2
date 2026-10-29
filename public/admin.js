const loginPanel = document.querySelector('#login-panel');
const dashboardPanel = document.querySelector('#dashboard-panel');
const adminNav = document.querySelector('#admin-nav');
const adminToast = document.querySelector('#admin-toast');
const productDialog = document.querySelector('#product-dialog');
const productForm = document.querySelector('#product-form');
const salesCanvas = document.querySelector('#sales-chart');
const salesPeriod = document.querySelector('#sales-period');
const salesTooltip = document.querySelector('#sales-chart-tooltip');
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const analyticsBrands = [
  'MRF', 'Apollo', 'CEAT', 'Bridgestone', 'Goodyear', 'Michelin',
  'JK Tyre', 'TVS Eurogrip', 'Ralco', 'Maxxis', 'Continental', 'Yokohama'
];
let latestDashboard = null;
let chartPoints = [];
let refreshInProgress = false;
let refreshQueued = false;
let queuedRefreshSilent = true;

function emptyDashboardState() {
  return {
    totalSales: 0,
    totalOrders: 0,
    revenueOrderCount: 0,
    pendingOrders: 0,
    productsSold: 0,
    salesTrend: { daily: [], monthly: [] },
    approvedSales: [],
    brandSales: []
  };
}

function initializeAnalyticsDisplay() {
  latestDashboard = emptyDashboardState();
  chartPoints = [];
  renderAnalytics(latestDashboard);
}

function safe(value) {
  const element = document.createElement('span');
  element.textContent = value ?? '';
  return element.innerHTML;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function showToast(message) {
  adminToast.textContent = message;
  adminToast.classList.add('visible');
  window.setTimeout(() => adminToast.classList.remove('visible'), 3500);
}

async function initialize() {
  try {
    await api('/api/admin/me');
    loginPanel.hidden = true;
    dashboardPanel.hidden = false;
    adminNav.hidden = false;
    initializeAnalyticsDisplay();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await refreshDashboard();
  } catch (error) {
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
    adminNav.hidden = true;
    document.querySelector('#login-error').textContent = error.status === 401 ? '' : error.message;
  }
}

async function refreshDashboard(silent = false) {
  if (refreshInProgress) {
    refreshQueued = true;
    queuedRefreshSilent = queuedRefreshSilent && silent;
    return;
  }
  refreshInProgress = true;
  try {
    const [dashboard, orders, products, customers, settings] = await Promise.all([
      api('/api/admin/dashboard'), api('/api/orders'), api('/api/products'),
      api('/api/admin/customers'), api('/api/admin/storefront-settings')
    ]);
    latestDashboard = dashboard;
    renderAnalytics(dashboard);
    document.querySelector('#low-stock').textContent = dashboard.lowStockCount;
    document.querySelector('#customer-count').textContent = dashboard.customerCount;
    renderOrders(orders);
    renderProducts(products);
    renderCustomers(customers);
    const offerInput = document.querySelector('#diwali-banner-message');
    if (document.activeElement !== offerInput && offerInput.dataset.dirty !== 'true') {
      offerInput.value = settings.diwaliOffer || '';
    }
  } catch (error) {
    if (!silent) showToast(error.message);
    if (error.status === 401) initialize();
  } finally {
    refreshInProgress = false;
    if (refreshQueued) {
      const nextSilent = queuedRefreshSilent;
      refreshQueued = false;
      queuedRefreshSilent = true;
      refreshDashboard(nextSilent);
    }
  }
}

function renderAnalytics(dashboard) {
  const revenue = Number(dashboard.totalSales) || 0;
  const revenueOrderCount = Number(dashboard.revenueOrderCount) || 0;
  document.querySelector('#total-sales').textContent = currency.format(revenue);
  document.querySelector('#total-orders').textContent = Number(dashboard.totalOrders) || 0;
  document.querySelector('#average-order-value').textContent =
    currency.format(revenueOrderCount ? revenue / revenueOrderCount : 0);
  document.querySelector('#pending-orders').textContent = Number(dashboard.pendingOrders) || 0;
  document.querySelector('#products-sold').textContent = Number(dashboard.productsSold) || 0;

  renderSalesChart(dashboard);
  renderBrandBreakdown(dashboard.brandSales || [], revenue);
}

function chartLabel(period, mode) {
  if (mode === 'monthly') {
    const [year, month] = period.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC'
    });
  }
  const [year, month, day] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  });
}

function renderSalesChart(dashboard) {
  const mode = salesPeriod.value;
  const salesByPeriod = new Map((dashboard.salesTrend?.[mode] || []).map((item) => [
    item.period,
    Number(item.revenue)
  ]));
  const approvalsByPeriod = new Map();
  (dashboard.approvedSales || []).forEach((sale) => {
    const approvedAt = String(sale.approved_at || '');
    const period = mode === 'monthly' ? approvedAt.slice(0, 7) : approvedAt.slice(0, 10);
    if (!period) return;
    if (!approvalsByPeriod.has(period)) approvalsByPeriod.set(period, []);
    approvalsByPeriod.get(period).push(sale);
  });
  const now = new Date();
  const periods = Array.from({ length: mode === 'daily' ? 30 : 12 }, (_, index) => {
    const offset = (mode === 'daily' ? 29 : 11) - index;
    if (mode === 'monthly') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
        .toISOString().slice(0, 7);
    }
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset))
      .toISOString().slice(0, 10);
  });
  const data = periods.map((period) => ({
    period,
    label: chartLabel(period, mode),
    revenue: salesByPeriod.get(period) || 0,
    approvals: approvalsByPeriod.get(period) || []
  }));
  const bounds = salesCanvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  const width = bounds.width;
  const height = bounds.height;
  salesCanvas.width = Math.round(width * ratio);
  salesCanvas.height = Math.round(height * ratio);
  const context = salesCanvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const padding = { top: 18, right: 12, bottom: 34, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxRevenue = Math.max(1, ...data.map((point) => point.revenue));
  const points = data.map((point, index) => ({
    ...point,
    x: padding.left + (data.length > 1 ? index / (data.length - 1) : 0.5) * plotWidth,
    y: padding.top + plotHeight - (point.revenue / maxRevenue) * plotHeight
  }));
  chartPoints = points;

  context.font = '10px DM Sans, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + (plotHeight * step) / 4;
    const value = maxRevenue * (1 - step / 4);
    context.beginPath();
    context.strokeStyle = '#203b39';
    context.lineWidth = 1;
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = '#77918a';
    context.fillText(compactMoney(value), padding.left - 10, y);
  }

  if (points.length) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(points[points.length - 1].x, padding.top + plotHeight);
    context.lineTo(points[0].x, padding.top + plotHeight);
    context.closePath();
    const fillGradient = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
    fillGradient.addColorStop(0, 'rgba(27, 216, 177, 0.22)');
    fillGradient.addColorStop(1, 'rgba(27, 216, 177, 0)');
    context.fillStyle = fillGradient;
    context.fill();

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.strokeStyle = '#20d6b1';
    context.lineWidth = 2.5;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.shadowColor = '#20d6b1';
    context.shadowBlur = 9;
    context.stroke();
    context.shadowBlur = 0;

    points.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = '#20d6b1';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = '#0c201e';
      context.stroke();
    });

    const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#8ca49d';
    points.forEach((point, index) => {
      if (labelIndexes.has(index)) context.fillText(point.label, point.x, height - padding.bottom + 12);
    });
  }

  salesCanvas.setAttribute(
    'aria-label',
    `${mode === 'daily' ? 'Daily' : 'Monthly'} sales revenue chart with ${points.length} data points.`
  );
}

function compactMoney(value) {
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
  return `₹${Math.round(value)}`;
}

function renderBrandBreakdown(brands, totalRevenue) {
  const container = document.querySelector('#brand-breakdown');
  const revenueByBrand = new Map(brands.map((brand) => [
    String(brand.brand).toLowerCase(),
    Number(brand.revenue) || 0
  ]));
  const brandRows = analyticsBrands.map((brand) => ({
    brand,
    revenue: revenueByBrand.get(brand.toLowerCase()) || 0
  })).sort((left, right) => right.revenue - left.revenue || analyticsBrands.indexOf(left.brand) - analyticsBrands.indexOf(right.brand));
  container.innerHTML = brandRows.map(({ brand, revenue }) => {
    const share = totalRevenue > 0 ? Math.min(100, (revenue / totalRevenue) * 100) : 0;
    return `<div class="brand-revenue-row">
      <div class="brand-revenue-label"><strong>${safe(brand)}</strong><span>${currency.format(revenue)} · ${share.toFixed(1)}%</span></div>
      <div class="brand-revenue-track"><span role="progressbar" aria-label="${safe(brand)} revenue share" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share.toFixed(1)}" style="width:${share.toFixed(1)}%"></span></div>
    </div>`;
  }).join('');
}

function showChartTooltip(event) {
  if (!chartPoints.length) return;
  const rect = salesCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const point = chartPoints.reduce((closest, candidate) =>
    Math.abs(candidate.x - pointerX) < Math.abs(closest.x - pointerX) ? candidate : closest
  );
  const approvals = point.approvals.slice(0, 4).map((sale) => {
    const approvedAt = new Date(`${String(sale.approved_at).replace(' ', 'T')}Z`);
    const timestamp = approvedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `${sale.order_code} ${timestamp} ${currency.format(sale.revenue)}`;
  });
  salesTooltip.textContent = approvals.length
    ? `${point.label}: ${approvals.join(' · ')}`
    : `${point.label} · ${currency.format(point.revenue)}`;
  salesTooltip.style.left = `${Math.max(70, Math.min(rect.width - 70, point.x))}px`;
  salesTooltip.style.top = `${Math.max(0, point.y - 36)}px`;
  salesTooltip.hidden = false;
}

function renderOrders(orders) {
  const body = document.querySelector('#orders-body');
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="7">No orders yet.</td></tr>';
    return;
  }
  const allowedNext = {
    Pending: ['Processing', 'Cancelled'],
    Processing: ['Shipped', 'Cancelled'],
    Shipped: ['Delivered'],
    Delivered: [],
    Cancelled: []
  };
  body.innerHTML = orders.map((order) => {
    const approvalStatus = order.approval_status || 'Approved & Dispatched';
    const address = [order.address, order.landmark, order.city, order.state, order.pincode].filter(Boolean).join(', ');
    const items = order.items?.length
      ? order.items
      : [{ brand: order.brand, model: order.model, tyre_size: order.tyre_size, quantity: order.quantity }];
    const itemMarkup = items.map((item) =>
      `<span>${safe(item.brand)} ${safe(item.model)} × ${safe(item.quantity)}<small>${safe(item.tyre_size)}</small>${item.product_id ? '' : '<small class="cart-stock-warning">Special order · verify price and availability before approval</small>'}</span>`
    ).join('');
    const actions = [
      approvalStatus === 'Pending Approval' && order.status !== 'Cancelled'
        ? `<button class="button button-primary approve-order" data-order="${safe(order.id)}" type="button">${items.some((item) => !item.product_id) ? 'Confirm & Approve' : 'Approve Order'}</button>`
        : '',
      approvalStatus === 'Approved & Dispatched'
        ? `<a class="text-button invoice-download" href="/api/orders/${encodeURIComponent(order.order_code)}/invoice">Download PDF invoice</a>`
        : ''
    ].filter(Boolean).join('');
    return `<tr>
      <td><strong>${safe(order.order_code || `#${order.id}`)}</strong><small class="order-date">${new Date(order.created_at).toLocaleString()}</small></td>
      <td><strong>${safe(order.customer_name)}</strong><small>${safe(order.phone)} · ${safe(order.email)}</small><small>${safe(address)}</small></td>
      <td class="order-line-items">${itemMarkup}${Number(order.delivery_amount) ? `<small>Delivery ${currency.format(order.delivery_amount)}</small>` : ''}</td>
      <td>${safe(order.quantity)}</td>
      <td>${currency.format(order.total_amount)}<small>incl. GST</small></td>
      <td><span class="order-state">${safe(approvalStatus)}</span><select class="status-select" data-order="${safe(order.id)}" aria-label="Fulfilment status">
        ${[order.status, ...(allowedNext[order.status] || [])].map((status) =>
          `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}
      </select></td>
      <td class="order-actions">${actions || '<span class="order-no-action">No action</span>'}</td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.approve-order').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const approved = await api(`/api/admin/orders/${button.dataset.order}/approve`, { method: 'POST' });
        showToast(`${approved.orderCode} approved. Revenue and sales chart updated.`);
        await refreshDashboard();
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    });
  });
  body.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api(`/api/orders/${select.dataset.order}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: select.value })
        });
        showToast('Order status updated.');
        await refreshDashboard();
      } catch (error) {
        await refreshDashboard();
        showToast(error.message);
      }
    });
  });
}

function renderProducts(products) {
  const container = document.querySelector('#admin-products');
  container.innerHTML = products.length ? products.map((product) => `<article class="inventory-item">
    <div><strong>${safe(product.brand)} ${safe(product.model)}</strong><span>${safe(product.tyre_size)} · ${safe(product.stock_quantity)} in stock</span></div>
    <div class="inventory-actions"><button class="text-button edit-product" data-id="${safe(product.id)}">Edit</button><button class="text-button danger delete-product" data-id="${safe(product.id)}">Delete</button></div>
  </article>`).join('') : '<p>No products added yet.</p>';
  container.querySelectorAll('.edit-product').forEach((button) => {
    button.addEventListener('click', () => editProduct(products.find((product) => String(product.id) === button.dataset.id)));
  });
  container.querySelectorAll('.delete-product').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Delete this tyre from inventory?')) return;
      try {
        await api(`/api/products/${button.dataset.id}`, { method: 'DELETE' });
        showToast('Tyre deleted.');
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function renderCustomers(customers) {
  const body = document.querySelector('#customers-body');
  body.innerHTML = customers.length ? customers.map((customer) => `<tr>
    <td>${safe(customer.full_name)}</td><td>${safe(customer.phone)}<br>${safe(customer.email)}</td>
    <td>${safe(customer.order_count)} · <button class="text-button customer-history" data-email="${safe(customer.email)}">History</button></td>
    <td>${currency.format(customer.total_spent)}</td>
  </tr>`).join('') : '<tr><td colspan="4">No customers yet.</td></tr>';
  body.querySelectorAll('.customer-history').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const orders = await api(`/api/admin/customers/${encodeURIComponent(button.dataset.email)}/orders`);
        document.querySelector('#customer-dialog-title').textContent = button.closest('tr').querySelector('td').textContent;
        document.querySelector('#customer-history').innerHTML = `
          <p class="customer-contact">${safe(button.dataset.email)}</p>
          ${orders.length ? orders.map((order) => `<article class="history-order">
            <div class="history-order-heading"><strong>Order #${safe(order.id)}</strong><span>${new Date(order.created_at).toLocaleDateString()}</span></div>
            <p>${safe(order.brand)} ${safe(order.model)} · ${safe(order.tyre_size)} × ${safe(order.quantity)}</p>
            <div class="history-order-heading"><span>${safe(order.status)} · ${safe(order.payment_method.toUpperCase())} (${safe(order.payment_status)})</span><strong>${currency.format(order.total_amount)}</strong></div>
          </article>`).join('') : '<p>No orders yet.</p>'}`;
        document.querySelector('#customer-dialog').showModal();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function editProduct(product) {
  productForm.reset();
  document.querySelector('#product-dialog-title').textContent = product ? 'Edit tyre' : 'Add a tyre';
  for (const [key, value] of Object.entries(product || {})) {
    if (productForm.elements[key]) productForm.elements[key].value = value;
  }
  document.querySelector('#product-error').textContent = '';
  productDialog.showModal();
}

const loginForm = document.querySelector('#login-form');
loginForm.querySelector('[data-admin-password-toggle]').addEventListener('click', (event) => {
  const toggle = event.currentTarget;
  const passwordInput = loginForm.elements.password;
  const isVisible = passwordInput.type === 'text';
  passwordInput.type = isVisible ? 'password' : 'text';
  toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
  toggle.setAttribute('aria-pressed', String(!isVisible));
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorText = document.querySelector('#login-error');
  errorText.textContent = '';
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    username: formData.get('username'),
    password: formData.get('password')
  };
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(payload) });
    await initialize();
  } catch (error) {
    errorText.textContent = error.message;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
    dashboardPanel.hidden = true;
    adminNav.hidden = true;
    loginPanel.hidden = false;
    latestDashboard = null;
  } catch (error) {
    showToast(error.message);
  }
});

salesPeriod.addEventListener('change', () => {
  if (latestDashboard) renderSalesChart(latestDashboard);
});
salesCanvas.addEventListener('pointermove', showChartTooltip);
salesCanvas.addEventListener('pointerleave', () => {
  salesTooltip.hidden = true;
});
window.addEventListener('resize', () => {
  if (latestDashboard && !dashboardPanel.hidden) renderSalesChart(latestDashboard);
});

document.querySelector('#add-product-button').addEventListener('click', () => editProduct());
document.querySelector('#close-product').addEventListener('click', () => productDialog.close());
document.querySelector('#close-customer').addEventListener('click', () => document.querySelector('#customer-dialog').close());
document.querySelector('#refresh-orders').addEventListener('click', refreshDashboard);
document.querySelector('#refresh-products').addEventListener('click', refreshDashboard);
const diwaliBannerForm = document.querySelector('#diwali-banner-form');
const diwaliBannerInput = document.querySelector('#diwali-banner-message');
diwaliBannerInput.addEventListener('input', () => { diwaliBannerInput.dataset.dirty = 'true'; });
diwaliBannerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorText = document.querySelector('#diwali-banner-error');
  const submitButton = diwaliBannerForm.querySelector('[type="submit"]');
  errorText.textContent = '';
  submitButton.disabled = true;
  try {
    const result = await api('/api/admin/storefront-settings', {
      method: 'PUT',
      body: JSON.stringify({ diwaliOffer: diwaliBannerInput.value })
    });
    diwaliBannerInput.value = result.diwaliOffer;
    delete diwaliBannerInput.dataset.dirty;
    showToast('Diwali banner updated. The storefront will sync the offer shortly.');
  } catch (error) {
    errorText.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorText = document.querySelector('#product-error');
  errorText.textContent = '';
  const payload = Object.fromEntries(new FormData(productForm).entries());
  const id = payload.id;
  delete payload.id;
  payload.price = Number(payload.price);
  payload.discount = Number(payload.discount);
  payload.stock_quantity = Number(payload.stock_quantity);
  try {
    await api(id ? `/api/products/${id}` : '/api/products', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    productDialog.close();
    showToast(id ? 'Tyre updated.' : 'Tyre added.');
    await refreshDashboard();
  } catch (error) {
    errorText.textContent = error.message;
  }
});

initialize();
window.setInterval(() => {
  if (!dashboardPanel.hidden && document.visibilityState === 'visible') refreshDashboard(true);
}, 5000);
