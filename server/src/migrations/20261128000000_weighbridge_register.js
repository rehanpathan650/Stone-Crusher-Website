/**
 * Standalone weighbridge register (slips can be billed later), delivery details on dispatches,
 * customer credit limits, purchase GST (input tax), royalty permit details, expense payee and production operator.
 */
const money = (t, name) => t.decimal(name, 14, 2).notNullable().defaultTo(0);
const kg = (t, name) => t.decimal(name, 12, 1);

export async function up(knex) {
  await knex.schema.createTable('weighments', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('time', 5); // HH:MM, as printed on the slip
    t.string('slip_no', 40).notNullable().unique();
    t.string('fy', 7).notNullable();
    t.integer('seq');
    t.string('type', 15).notNullable().defaultTo('Loaded'); // Loaded | Empty | Re-weighment
    t.string('vehicle_no', 30).notNullable();
    t.integer('party_id').unsigned().references('id').inTable('parties').onDelete('SET NULL');
    t.integer('material_id').unsigned().references('id').inTable('materials').onDelete('SET NULL');
    kg(t, 'gross_weight');
    kg(t, 'tare_weight');
    kg(t, 'net_weight');
    money(t, 'rate');
    t.string('driver', 100);
    t.string('notes', 300);
    t.integer('sale_id').unsigned().references('id').inTable('sales').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['fy', 'seq']);
    t.index('date');
    t.index('vehicle_no');
    t.index('sale_id');
  });

  await knex.schema.alterTable('sales', t => {
    t.string('destination', 200);
    t.string('driver', 100);
    t.string('delivery_status', 12).notNullable().defaultTo('Dispatched'); // Dispatched | Delivered
  });

  await knex.schema.alterTable('parties', t => { money(t, 'credit_limit'); }); // 0 = no limit

  await knex.schema.alterTable('purchases', t => {
    t.string('bill_no', 40);
    t.decimal('gst_pct', 5, 2).notNullable().defaultTo(0);
    money(t, 'subtotal');
    money(t, 'gst_amount');
    money(t, 'cgst');
    money(t, 'sgst');
    money(t, 'igst');
    t.string('tax_type', 5).notNullable().defaultTo('intra');
  });
  // Existing purchases had no GST: taxable value = amount − transport
  await knex('purchases').update({ subtotal: knex.raw('amount - transport') });

  await knex.schema.alterTable('royalty_permits', t => {
    t.string('quarry', 120);
    t.string('mineral', 60);
    t.string('payment_ref', 60);
  });

  await knex.schema.alterTable('expenses', t => { t.string('paid_to', 120); });
  await knex.schema.alterTable('production', t => {
    t.integer('operator_id').unsigned().references('id').inTable('employees').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('production', t => { t.dropColumn('operator_id'); });
  await knex.schema.alterTable('expenses', t => { t.dropColumn('paid_to'); });
  await knex.schema.alterTable('royalty_permits', t => { t.dropColumns('quarry', 'mineral', 'payment_ref'); });
  await knex.schema.alterTable('purchases', t => { t.dropColumns('bill_no', 'gst_pct', 'subtotal', 'gst_amount', 'cgst', 'sgst', 'igst', 'tax_type'); });
  await knex.schema.alterTable('parties', t => { t.dropColumn('credit_limit'); });
  await knex.schema.alterTable('sales', t => { t.dropColumns('destination', 'driver', 'delivery_status'); });
  await knex.schema.dropTableIfExists('weighments');
}
