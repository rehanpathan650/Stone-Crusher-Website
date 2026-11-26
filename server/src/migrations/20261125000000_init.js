/** Initial schema. Dates are stored as 'YYYY-MM-DD' strings so they behave the same in SQLite and PostgreSQL. */

const money = (t, name) => t.decimal(name, 14, 2).notNullable().defaultTo(0);
const qty = (t, name) => t.decimal(name, 14, 3).notNullable().defaultTo(0);
const fk = (t, name, table, onDelete = 'RESTRICT') =>
  t.integer(name).unsigned().references('id').inTable(table).onDelete(onDelete);
const createdBy = t => fk(t, 'created_by', 'users', 'SET NULL');

export async function up(knex) {
  await knex.schema.createTable('users', t => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.string('email', 254).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('role', 20).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('failed_attempts').notNullable().defaultTo(0);
    t.bigInteger('locked_until');
    t.bigInteger('last_login_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('sessions', t => {
    t.string('id', 64).primary(); // SHA-256 of the cookie token; raw token is never stored
    fk(t, 'user_id', 'users', 'CASCADE').notNullable();
    t.string('csrf_token', 64).notNullable();
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.bigInteger('created_at').notNullable();
    t.bigInteger('last_seen_at').notNullable();
    t.bigInteger('expires_at').notNullable();
    t.index('user_id');
    t.index('expires_at');
  });

  await knex.schema.createTable('audit_logs', t => {
    t.increments('id');
    fk(t, 'user_id', 'users', 'SET NULL');
    t.string('action', 40).notNullable();
    t.string('entity', 40);
    t.string('entity_id', 40);
    t.text('details');
    t.string('ip', 64);
    t.bigInteger('created_at').notNullable();
    t.index('created_at');
    t.index(['entity', 'entity_id']);
  });

  await knex.schema.createTable('settings', t => {
    t.string('key', 60).primary();
    t.text('value');
  });

  await knex.schema.createTable('materials', t => {
    t.increments('id');
    t.string('name', 100).notNullable().unique();
    t.string('unit', 20).notNullable();
    money(t, 'rate');
    t.boolean('is_raw').notNullable().defaultTo(false);
    qty(t, 'opening');
    qty(t, 'reorder_level');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('parties', t => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('type', 20).notNullable();
    t.string('phone', 30);
    t.string('gstin', 20);
    t.string('address', 300);
    money(t, 'opening');
    t.timestamps(true, true);
    t.index('name');
  });

  await knex.schema.createTable('vehicles', t => {
    t.increments('id');
    t.string('number', 30).notNullable().unique();
    t.string('kind', 40);
    t.string('ownership', 10).notNullable().defaultTo('own');
    t.string('driver', 100);
    t.string('phone', 30);
    t.string('notes', 500);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('employees', t => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.string('role', 60);
    t.string('phone', 30);
    t.string('joined_on', 10);
    t.string('wage_type', 10).notNullable().defaultTo('daily');
    money(t, 'wage');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('sales', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('bill_no', 40).unique();
    fk(t, 'party_id', 'parties').notNullable();
    t.string('vehicle_no', 30);
    fk(t, 'material_id', 'materials').notNullable();
    qty(t, 'qty');
    money(t, 'rate');
    money(t, 'transport');
    t.decimal('gst_pct', 5, 2).notNullable().defaultTo(0);
    money(t, 'subtotal');
    money(t, 'gst_amount');
    money(t, 'amount');
    money(t, 'paid');
    t.string('mode', 20);
    t.string('notes', 500);
    createdBy(t);
    t.timestamps(true, true);
    t.index('date');
    t.index('party_id');
    t.index('material_id');
  });

  await knex.schema.createTable('purchases', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    fk(t, 'party_id', 'parties').notNullable();
    fk(t, 'material_id', 'materials').notNullable();
    t.string('vehicle_no', 30);
    qty(t, 'qty');
    money(t, 'rate');
    money(t, 'transport');
    money(t, 'amount');
    money(t, 'paid');
    t.string('mode', 20);
    t.string('notes', 500);
    createdBy(t);
    t.timestamps(true, true);
    t.index('date');
    t.index('party_id');
    t.index('material_id');
  });

  await knex.schema.createTable('production', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('shift', 20);
    fk(t, 'material_id', 'materials').notNullable();
    qty(t, 'qty');
    fk(t, 'raw_material_id', 'materials');
    qty(t, 'raw_qty');
    t.decimal('run_hours', 5, 2).notNullable().defaultTo(0);
    t.string('notes', 500);
    createdBy(t);
    t.timestamps(true, true);
    t.index('date');
    t.index('material_id');
    t.index('raw_material_id');
  });

  await knex.schema.createTable('expenses', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('category', 40).notNullable();
    money(t, 'amount');
    t.string('mode', 20);
    t.string('vehicle_no', 30);
    fk(t, 'employee_id', 'employees');
    t.string('description', 300);
    createdBy(t);
    t.timestamps(true, true);
    t.index('date');
    t.index('category');
    t.index('employee_id');
  });

  await knex.schema.createTable('payments', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('direction', 3).notNullable(); // 'in' received, 'out' paid
    fk(t, 'party_id', 'parties').notNullable();
    money(t, 'amount');
    t.string('mode', 20);
    t.string('reference', 60);
    t.string('notes', 500);
    createdBy(t);
    t.timestamps(true, true);
    t.index('date');
    t.index('party_id');
  });

  await knex.schema.createTable('attendance', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    fk(t, 'employee_id', 'employees', 'CASCADE').notNullable();
    t.string('status', 1).notNullable(); // P, H, A
    t.unique(['date', 'employee_id']);
    t.index('employee_id');
  });

  const m = (name, unit, rate, is_raw = false, reorder_level = 50) => ({ name, unit, rate, is_raw, opening: 0, reorder_level });
  await knex('materials').insert([
    m('Boulder (Raw)', 'Ton', 450, true, 200),
    m('40 mm Aggregate', 'Ton', 750),
    m('20 mm Aggregate', 'Ton', 850),
    m('10 mm Aggregate', 'Ton', 800),
    m('6 mm Grit', 'Ton', 700),
    m('Stone Dust', 'Ton', 400),
    m('M-Sand', 'Ton', 950),
    m('GSB', 'Ton', 550),
  ]);
}

export async function down(knex) {
  for (const t of ['attendance', 'payments', 'expenses', 'production', 'purchases', 'sales', 'employees', 'vehicles',
    'parties', 'materials', 'settings', 'audit_logs', 'sessions', 'users']) {
    await knex.schema.dropTableIfExists(t);
  }
}
