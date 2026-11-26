/**
 * GST invoicing: HSN codes, party state/email, CGST/SGST/IGST split, financial-year
 * invoice numbering and credit notes (sales returns).
 */
const money = (t, name) => t.decimal(name, 14, 2).notNullable().defaultTo(0);
const qty = (t, name) => t.decimal(name, 14, 3).notNullable().defaultTo(0);

/** Indian financial year (April–March) of a 'YYYY-MM-DD' date, e.g. '2026-27'. */
const fyOf = d => {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export async function up(knex) {
  await knex.schema.alterTable('materials', t => { t.string('hsn', 10); });
  await knex('materials').update({ hsn: '2517' }); // crushed stone / aggregates

  await knex.schema.alterTable('parties', t => {
    t.string('state', 40);
    t.string('email', 254);
  });

  await knex.schema.alterTable('sales', t => {
    t.string('fy', 7);
    t.integer('seq');
    t.string('tax_type', 5).notNullable().defaultTo('intra'); // intra = CGST+SGST, inter = IGST
    money(t, 'cgst');
    money(t, 'sgst');
    money(t, 'igst');
    t.unique(['fy', 'seq']);
    t.index('fy');
  });
  const sales = await knex('sales').select('id', 'date', 'gst_amount');
  for (const s of sales) {
    const g = Number(s.gst_amount) || 0;
    const half = Math.round((g / 2) * 100) / 100;
    await knex('sales').where({ id: s.id }).update({ fy: fyOf(s.date), cgst: half, sgst: Math.round((g - half) * 100) / 100, igst: 0 });
  }

  await knex.schema.createTable('credit_notes', t => {
    t.increments('id');
    t.string('date', 10).notNullable();
    t.string('note_no', 40).notNullable().unique();
    t.string('fy', 7).notNullable();
    t.integer('seq');
    t.integer('sale_id').unsigned().notNullable().references('id').inTable('sales').onDelete('RESTRICT');
    t.integer('party_id').unsigned().notNullable().references('id').inTable('parties').onDelete('RESTRICT');
    t.integer('material_id').unsigned().notNullable().references('id').inTable('materials').onDelete('RESTRICT');
    qty(t, 'qty');
    money(t, 'rate');
    t.decimal('gst_pct', 5, 2).notNullable().defaultTo(0);
    t.string('tax_type', 5).notNullable().defaultTo('intra');
    money(t, 'subtotal');
    money(t, 'gst_amount');
    money(t, 'cgst');
    money(t, 'sgst');
    money(t, 'igst');
    money(t, 'amount');
    t.boolean('restock').notNullable().defaultTo(true);
    t.string('reason', 300);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['fy', 'seq']);
    t.index('date');
    t.index('sale_id');
    t.index('party_id');
    t.index('material_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('credit_notes');
  await knex.schema.alterTable('sales', t => {
    t.dropUnique(['fy', 'seq']);
    t.dropIndex('fy');
    t.dropColumns('fy', 'seq', 'tax_type', 'cgst', 'sgst', 'igst');
  });
  await knex.schema.alterTable('parties', t => { t.dropColumns('state', 'email'); });
  await knex.schema.alterTable('materials', t => { t.dropColumn('hsn'); });
}
