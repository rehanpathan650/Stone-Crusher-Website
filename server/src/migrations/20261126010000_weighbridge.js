/**
 * Weighbridge slips on dispatches, hired-vehicle freight payable to the owner,
 * default tare per vehicle, and the mining royalty / transit pass register.
 */
const money = (t, name) => t.decimal(name, 14, 2).notNullable().defaultTo(0);
const kg = (t, name) => t.decimal(name, 12, 1);

export async function up(knex) {
  await knex.schema.alterTable('sales', t => {
    t.string('slip_no', 30);
    kg(t, 'gross_weight');
    kg(t, 'tare_weight');
    kg(t, 'net_weight');
    money(t, 'freight_cost'); // owed to a hired vehicle's owner for this trip
    t.string('royalty_pass_no', 40);
    t.index('vehicle_no');
  });

  await knex.schema.alterTable('vehicles', t => {
    kg(t, 'tare_weight');
    t.integer('owner_party_id').unsigned().references('id').inTable('parties').onDelete('SET NULL');
    money(t, 'freight_rate'); // default freight per trip for hired vehicles
  });

  await knex.schema.createTable('royalty_permits', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('permit_no', 40).notNullable().unique();
    t.decimal('qty', 14, 3).notNullable().defaultTo(0); // tons covered
    money(t, 'amount');
    t.string('valid_until', 10);
    t.string('notes', 300);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('date');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('royalty_permits');
  await knex.schema.alterTable('vehicles', t => { t.dropColumns('tare_weight', 'owner_party_id', 'freight_rate'); });
  await knex.schema.alterTable('sales', t => {
    t.dropIndex('vehicle_no');
    t.dropColumns('slip_no', 'gross_weight', 'tare_weight', 'net_weight', 'freight_cost', 'royalty_pass_no');
  });
}
