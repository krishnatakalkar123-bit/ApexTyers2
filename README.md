# apexTyre.com

A lightweight tyre-shop website built with HTML, CSS, vanilla JavaScript, Express, SQLite, and Nodemailer. The first run creates `apextyre.db` automatically and seeds sample CEAT, MRF, and Apollo products.

## Project files

```text
apextyre/
├── public/
│   ├── admin.html       # Owner dashboard and product editor
│   ├── admin.js         # Dashboard and inventory interactions
│   ├── catalog-data.js  # Shared storefront and server-side catalogue/estimate data
│   ├── script.js        # Storefront catalog filters and checkout
│   ├── index.html       # Customer storefront
│   └── styles.css       # Responsive design
├── .env.example         # Configuration template
├── .gitignore
├── package.json
├── server.js            # Express API, SQLite setup, and email alert
└── apextyre.db          # Created automatically when the server starts
```

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, install dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env`. On Windows PowerShell, run:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Open `.env` and set:
   - `PORT`: web server port (default `3000`)
   - `EMAIL_USER`: Gmail account used to send order alerts
   - `EMAIL_PASS`: a Gmail **App Password**, not the normal Gmail password
   - `OWNER_EMAIL`: shop owner's destination inbox
   - `ADMIN_USERNAME`: owner username for `/admin` (defaults to `admin`)
   - `ADMIN_PASSWORD`: owner password for `/admin`
   - `BUSINESS_GSTIN`: registered seller GSTIN required for a statutory invoice
   - `BUSINESS_ADDRESS`: registered seller address required for a statutory invoice
   - `SESSION_SECRET`: a private random value with at least 32 characters

   Generate a strong session secret from PowerShell with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   To create a Gmail App Password, enable 2-Step Verification on the Google account, then create an App Password in Google Account security settings. Do not commit `.env` or share its values. Email settings can be left blank during local UI development; the order is still saved and the server logs that email is not configured.

5. Start the server:

   ```sh
   node server.js
   ```

   Or use `npm start`. Open `http://localhost:3000` for the storefront and `http://localhost:3000/admin` for the owner dashboard.

SQLite creates the local `apextyre.db` file and sample catalog on first startup. Product changes and orders persist in this file. To reset local sample data, stop the server and remove this specific database file; the next startup recreates it.

## API routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/api/products` | Public | Fetch the tyre catalog |
| GET | `/api/storefront-settings` | Public | Read the owner-published festival ticker message |
| POST | `/api/place-order` | Public | Save a uniquely numbered pending single-tyre or multi-item order, reserve stock and email the owner |
| GET | `/api/orders/:orderCode/status` | Public order token | Check approval state for the matching order |
| GET | `/api/orders/:orderCode/invoice` | Owner session or order token | Download the approved order's PDF invoice |
| POST | `/api/admin/login` | Public, rate-limited | Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` |
| POST | `/api/admin/logout` | Owner | End the owner session |
| GET | `/api/admin/dashboard` | Owner | Approved revenue and order metrics, daily/monthly trends, approval timestamps, brand revenue, stock and customer totals |
| GET / PUT | `/api/admin/storefront-settings` | Owner | Read or update the storefront Diwali offer ticker |
| GET | `/api/orders` | Owner | List recent orders |
| POST | `/api/admin/orders/:id/approve` | Owner | Approve once, record the sale, and mark as dispatched |
| PATCH | `/api/orders/:id/status` | Owner | Update an order status |
| GET | `/api/admin/customers` | Owner | Customer directory and order summaries |
| GET | `/api/admin/customers/:email/orders` | Owner | A customer's order history |
| POST / PUT / DELETE | `/api/products` and `/api/products/:id` | Owner | Manage tyre inventory |

The storefront cart is saved in browser storage, supports quantity changes and removal, and submits selected lines to the server. In-stock products use the database price and reserve stock transactionally. Any catalogue model without enough matching inventory can still be submitted as a special-order request using a server-validated catalogue key and an indicative catalogue estimate; no inventory is reserved for that request. The order is saved in SQLite and appears in the owner's order list across browsers/devices. The owner must verify price and availability before approving a special order. Successful checkout also stores a limited local order-history summary (order ID, status, amount, and item names only); customer contact and address details remain in the server database. The cart and checkout show a flat ₹99 delivery charge and calculate 18% GST on the tyre subtotal plus delivery; the server repeats all price and tax calculations. The owner dashboard refreshes order and sales data every 5 seconds while open. Pending Approval orders do not count toward revenue, average order value, brand sales, or products sold. Approving an order records one approval timestamp and sale amount; the chart tooltip shows the approved order and timestamp.

The backend validates checkout values and calculates prices from SQLite rather than trusting prices sent by the browser. Checkout saves a unique `APX-YYYY-NNNNNN` order code, persists each tyre in `order_items`, and reserves all requested stock transactionally. Approval is an atomic, one-time transition. Order records retain product details in case the product is later deleted. Admin routes require a signed, HttpOnly cookie. Customers receive an order access token for checking approval and downloading their approved itemized invoice; the token is kept in the browser page and sent in a request header.

The Diwali ticker is stored in SQLite. Only an authenticated owner can update it from the dashboard; storefront clients read the public text-only setting and refresh it periodically. Clearing the setting hides the ticker.

The generated PDF includes a GST calculation and the seller contact, but statutory invoices require the real registered seller GSTIN and address. Set `BUSINESS_GSTIN` and `BUSINESS_ADDRESS` before production use; otherwise the PDF is marked pro forma.

## Email and payments

After an order is committed to SQLite, Nodemailer sends an itemized order receipt with an 18% GST estimate to the customer's checkout email and an order alert to `OWNER_EMAIL` (defaults to `swapnilnarwade73@gmail.com`). Delivery is reported separately for each message; if Gmail is unavailable, the order stays saved and the failure is logged and shown in the confirmation. Because the order is still pending owner approval, the customer email is an order receipt/estimate rather than a final tax invoice. The approved GST invoice remains available for download after approval.

COD, UPI and online payment selections are recorded, but this starter does **not** collect payment or mark UPI/online orders as paid. Connect a payment provider and verify its server-side webhook before treating an online order as paid.

For production, deploy behind HTTPS, configure a strong unique `SESSION_SECRET` and owner password, use a dedicated Gmail sender with an App Password, and back up the SQLite database. SQLite is appropriate for a small single-server shop; use a managed database if you need multiple application servers or high write concurrency.
