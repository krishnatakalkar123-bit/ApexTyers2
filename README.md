# apexTyre.com

A lightweight tyre-shop website built with HTML, CSS, vanilla JavaScript, Express, PostgreSQL, and Nodemailer. The existing `apextyre.db` is retained as the read-only source for a one-time import.

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
├── database.js          # PostgreSQL pool, schema, and initial catalog
├── scripts/
│   └── migrate-sqlite-to-postgres.js # One-time read-only SQLite import
├── server.js            # Express API and email alerts
└── apextyre.db          # Existing SQLite source; retained after import
```

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, install dependencies:

   ```sh
   npm install
   ```

3. If you do not already have a `.env`, copy the template. This command preserves an existing `.env`:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

4. Open `.env` and set:
   - `PORT`: web server port (default `3000`)
   - `DATABASE_URL`: PostgreSQL connection URL from Neon
   - `PG_POOL_MAX`: optional maximum PostgreSQL pool size (default `10`)
   - `EMAIL_USER`: Gmail account used to send order alerts
   - `EMAIL_PASS`: a Gmail **App Password**, not the normal Gmail password
   - `OWNER_EMAIL`: shop owner's destination inbox
   - `ADMIN_USERNAME`: owner username for `/admin` (defaults to `admin`)
   - `ADMIN_PASSWORD`: owner password for `/admin`
   - `BUSINESS_GSTIN`: registered seller GSTIN required for a statutory invoice
   - `BUSINESS_ADDRESS`: registered seller address required for a statutory invoice
   - `SESSION_SECRET`: a private random value with at least 32 characters
   - `FRONTEND_ORIGIN`: exact Netlify site origin for credentialed CORS

   Generate a strong session secret from PowerShell with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   To create a Gmail App Password, enable 2-Step Verification on the Google account, then create an App Password in Google Account security settings. Do not commit `.env` or share its values. Email settings can be left blank during local UI development; the order is still saved and the server logs that email is not configured.

5. Set `window.APEXTYRE_API_URL` in `public/api-config.js` to the Render backend origin when the frontend is hosted separately. Leave it empty for local development.

6. Start the server:

   ```sh
   npm start
   ```

   Open `http://localhost:3000` for the storefront and `http://localhost:3000/admin` for the owner dashboard.

The server creates PostgreSQL tables idempotently and inserts sample catalog rows only when their unique product keys are absent. It does not truncate tables or overwrite existing product/settings data. Render's `PORT` environment variable is used automatically.

## Import existing SQLite data

The migration command opens SQLite read-only, reads one consistent snapshot, and imports products, orders, order items, and settings in a single PostgreSQL transaction with their original IDs. It refuses to import if any destination table already contains rows; no rows are overwritten, and a failed import is rolled back.

1. Stop the old SQLite-backed server and make a separate SQLite backup. From this folder, run:

   ```powershell
   node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database('apextyre.db',sqlite3.OPEN_READONLY); db.backup('apextyre.pre-postgres.bak.db',(error)=>{if(error){console.error(error.message);process.exitCode=1;} db.close();});"
   ```

   Retain both `apextyre.db` and `apextyre.pre-postgres.bak.db`.
2. Set `DATABASE_URL` in `.env` to the Neon database URL. Use a new/empty Neon database for this import.
3. Confirm `apextyre.db` in this project folder is the intended source.
4. Run:

   ```powershell
   npm run migrate:sqlite
   ```

   To use another SQLite file:

   ```powershell
   npm run migrate:sqlite -- "C:\path\to\apextyre.db"
   ```

5. Verify the reported row counts, then start with `npm start`. The original SQLite database is not modified or deleted.

For Netlify, set `public/api-config.js` to the Render service origin (for example `https://your-service.onrender.com`) and set Render's `FRONTEND_ORIGIN` to the exact Netlify site origin. Configure `DATABASE_URL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` as Render environment variables; never commit their values. Use the SSL-enabled connection string supplied by Neon (normally it includes `sslmode=require`); the PostgreSQL driver reads the TLS setting from that URL.

The SQLite importer uses `sqlite3`, which is a development dependency because the running backend does not use SQLite. Run the importer locally with `npm install` before deployment; do not run the migration script as the Render start command. Render Free services can spin down after inactivity, so cold starts and continuous 24/7 availability are not guaranteed on the free tier. Use an always-on hosting plan if uninterrupted availability is required.

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

The storefront cart is saved in browser storage, supports quantity changes and removal, and submits selected lines to the server. In-stock products use the PostgreSQL price and reserve stock transactionally. Any catalogue model without enough matching inventory can still be submitted as a special-order request using a server-validated catalogue key and an indicative catalogue estimate; no inventory is reserved for that request. The order is saved in PostgreSQL and appears in the owner's order list across browsers/devices. The owner must verify price and availability before approving a special order. Successful checkout also stores a limited local order-history summary (order ID, status, amount, and item names only); customer contact and address details remain in the server database. The cart and checkout show a flat ₹99 delivery charge and calculate 18% GST on the tyre subtotal plus delivery; the server repeats all price and tax calculations. The owner dashboard refreshes order and sales data every 5 seconds while open. Pending Approval orders do not count toward revenue, average order value, brand sales, or products sold. Approving an order records one approval timestamp and sale amount; the chart tooltip shows the approved order and timestamp.

The backend validates checkout values and calculates prices from PostgreSQL rather than trusting prices sent by the browser. Checkout saves a unique `APX-YYYY-NNNNNN` order code, persists each tyre in `order_items`, and reserves all requested stock transactionally using one PostgreSQL client. Approval is an atomic, one-time transition. Order records retain product details in case the product is later deleted. Admin routes require a signed, HttpOnly cookie. Customers receive an order access token for checking approval and downloading their approved itemized invoice; the token is kept in the browser page and sent in a request header.

The Diwali ticker is stored in PostgreSQL. Only an authenticated owner can update it from the dashboard; storefront clients read the public text-only setting and refresh it periodically. Clearing the setting hides the ticker.

The generated PDF includes a GST calculation and the seller contact, but statutory invoices require the real registered seller GSTIN and address. Set `BUSINESS_GSTIN` and `BUSINESS_ADDRESS` before production use; otherwise the PDF is marked pro forma.

## Email and payments

After an order is committed to PostgreSQL, Nodemailer sends an itemized order receipt with an 18% GST estimate to the customer's checkout email and an order alert to `OWNER_EMAIL` (defaults to `swapnilnarwade73@gmail.com`). Delivery is reported separately for each message; if Gmail is unavailable, the order stays saved and the failure is logged and shown in the confirmation. Because the order is still pending owner approval, the customer email is an order receipt/estimate rather than a final tax invoice. The approved GST invoice remains available for download after approval.

COD, UPI and online payment selections are recorded, but this starter does **not** collect payment or mark UPI/online orders as paid. Connect a payment provider and verify its server-side webhook before treating an online order as paid.

For production, deploy behind HTTPS, configure a strong unique `SESSION_SECRET` and owner password, use a dedicated Gmail sender with an App Password, and use Neon backup/restore procedures for PostgreSQL.
