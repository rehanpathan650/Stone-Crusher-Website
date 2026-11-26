/**
 * Diesel issue log and maintenance log per machine/vehicle. Each entry with a cost keeps
 * one linked expense row in sync, so profit and expense reports include it automatically.
 */
const money = (t, name) => t.decimal(name, 14, 2).notNullable().defaultTo(0);

export async function up(knex) {
  await knex.schema.alterTable('vehicles', t => {
    t.string('meter_type', 5).notNullable().defaultTo('km'); // 'km' odometer or 'hours' hour meter
  });
  await knex('vehicles').whereIn('kind', ['JCB / Loader', 'Excavator', 'Crusher Unit', 'Generator']).update({ meter_type: 'hours' });

  await knex.schema.alterTable('expenses', t => {
    t.string('source', 20); // null = entered directly; 'diesel' / 'maintenance' = managed by that log
  });

  await knex.schema.createTable('diesel_logs', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.integer('vehicle_id').unsigned().notNullable().references('id').inTable('vehicles').onDelete('RESTRICT');
    t.decimal('litres', 10, 2).notNullable();
    money(t, 'rate');
    money(t, 'amount');
    t.decimal('meter', 12, 1);
    t.string('mode', 20);
    t.string('notes', 300);
    t.integer('expense_id').unsigned().references('id').inTable('expenses').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('date');
    t.index(['vehicle_id', 'date']);
  });

  await knex.schema.createTable('maintenance', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.integer('vehicle_id').unsigned().notNullable().references('id').inTable('vehicles').onDelete('RESTRICT');
    t.string('kind', 20).notNullable();
    t.string('description', 300).notNullable();
    money(t, 'parts_cost');
    money(t, 'labour_cost');
    money(t, 'amount');
    t.decimal('meter', 12, 1);
    t.decimal('downtime_hours', 6, 1).notNullable().defaultTo(0);
    t.string('next_due_date', 10);
    t.decimal('next_due_meter', 12, 1);
    t.string('mode', 20);
    t.integer('expense_id').unsigned().references('id').inTable('expenses').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('date');
    t.index(['vehicle_id', 'date']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('maintenance');
  await knex.schema.dropTableIfExists('diesel_logs');
  await knex.schema.alterTable('expenses', t => { t.dropColumn('source'); });
  await knex.schema.alterTable('vehicles', t => { t.dropColumn('meter_type'); });
}
