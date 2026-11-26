/** Crusher downtime per production shift (hours and main reason). */
export async function up(knex) {
  await knex.schema.alterTable('production', t => {
    t.decimal('downtime_hours', 5, 2).notNullable().defaultTo(0);
    t.string('downtime_reason', 40);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('production', t => { t.dropColumns('downtime_hours', 'downtime_reason'); });
}
