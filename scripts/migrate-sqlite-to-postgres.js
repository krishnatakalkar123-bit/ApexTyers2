require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { initializeDatabase, pool, resetIdentity, withTransaction } = require('../database');

const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'apextyre.db'));
const tables = ['products', 'orders', 'order_items', 'app_settings'];

const tableDefinitions = {
  products: {
    columns: [
      'id', 'brand', 'model', 'tyre_size', 'rim_size', 'vehicle_type', 'price', 'discount',
      'stock_quantity', 'image_url', 'created_at', 'updated_at'
    ]
  },
  orders: {
    columns: [
      'id', 'customer_name', 'phone', 'email', 'address', 'landmark', 'pincode', 'city', 'state',
      'vehicle_details', 'product_id', 'brand', 'model', 'tyre_size', 'quantity', 'unit_price',
      'total_amount', 'payment_method', 'payment_status', 'status', 'order_code', 'subtotal_amount',
      'gst_amount', 'delivery_amount', 'approval_status', 'approved_at', 'invoice_token_hash', 'created_at'
    ]
  },
  order_items: {
    columns: [
      'id', 'order_id', 'product_id', 'brand', 'model', 'tyre_size', 'quantity', 'unit_price',
      'subtotal_amount', 'gst_amount'
    ]
  },
  app_settings: {
    columns: ['setting_key', 'setting_value', 'updated_at']
  }
};

function openSourceDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function sqliteExec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => error ? reject(error) : resolve());
  });
}

function sqliteAll(database, sql) {
  return new Promise((resolve, reject) => {
    database.all(sql, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function closeSourceDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => error ? reject(error) : resolve());
  });
}

async function assertTargetIsEmpty(client) {
  for (const table of tables) {
    const tableExists = await client.query(
      'SELECT to_regclass($1) IS NOT NULL AS table_exists',
      [`public.${table}`]
    );
    if (!tableExists.rows[0].table_exists) continue;
    const result = await client.query(`SELECT COUNT(*) AS count FROM public.${table}`);
    if (Number(result.rows[0].count) > 0) {
      throw new Error(
        `PostgreSQL table "${table}" is not empty. No SQLite rows were imported; use a clean target database.`
      );
    }
  }
}

function valuesFor(row, columns) {
  return columns.map((column) => row[column] ?? null);
}

async function insertRows(client, table, rows) {
  const { columns } = tableDefinitions[table];
  if (!rows.length) return 0;
  const columnSql = columns.map((column) => `"${column}"`).join(', ');
  let inserted = 0;
  for (const row of rows) {
    const values = valuesFor(row, columns);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const result = await client.query(
      `INSERT INTO "${table}" (${columnSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values
    );
    inserted += result.rowCount;
  }
  if (inserted !== rows.length) {
    throw new Error(
      `Only ${inserted} of ${rows.length} ${table} rows were inserted. The import was rolled back to avoid partial data.`
    );
  }
  return inserted;
}

async function migrate() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source database not found: ${sourcePath}`);
  }

  const source = await openSourceDatabase(sourcePath);
  let snapshotOpen = false;
  try {
    await sqliteExec(source, 'BEGIN');
    snapshotOpen = true;
    const existingTables = await sqliteAll(
      source,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const availableTables = new Set(existingTables.map((table) => table.name));
    const missingTables = tables.filter((table) => !availableTables.has(table));
    if (missingTables.length) {
      throw new Error(`SQLite source is missing required tables: ${missingTables.join(', ')}.`);
    }

    const sourceRows = {};
    for (const table of tables) {
      sourceRows[table] = await sqliteAll(source, `SELECT * FROM "${table}" ORDER BY rowid`);
    }
    await sqliteExec(source, 'COMMIT');
    snapshotOpen = false;

    await assertTargetIsEmpty(pool);
    await initializeDatabase({ seed: false });
    await withTransaction(async (client) => {
      await assertTargetIsEmpty(client);
      for (const table of tables) {
        await insertRows(client, table, sourceRows[table]);
      }
      for (const table of ['products', 'orders', 'order_items']) {
        await resetIdentity(client, table);
      }
    });

    for (const table of tables) {
      console.log(`Imported ${table}: ${sourceRows[table].length} rows.`);
    }
    console.log('SQLite source was opened read-only and was not changed.');
  } catch (error) {
    if (snapshotOpen) {
      try {
        await sqliteExec(source, 'ROLLBACK');
      } catch (rollbackError) {
        console.error('Could not close the SQLite read transaction:', rollbackError.message);
      }
    }
    throw error;
  } finally {
    await closeSourceDatabase(source);
  }
}

migrate()
  .catch((error) => {
    console.error('SQLite-to-PostgreSQL import failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
