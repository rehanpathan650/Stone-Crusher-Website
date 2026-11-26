/** Overtime hours on attendance, overtime rate per employee, and monthly bonuses / deductions. */
export async function up(knex) {
  await knex.schema.alterTable('attendance', t => {
    t.decimal('ot_hours', 5, 2).notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('employees', t => {
    t.decimal('ot_rate', 10, 2).notNullable().defaultTo(0); // per hour; 0 = derive from wage (8-hour day, 26-day month)
  });
  await knex.schema.createTable('payroll_adjustments', t => {
    t.increments('id');
    t.string('month', 7).notNullable(); // YYYY-MM
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('kind', 10).notNullable(); // bonus | deduction
    t.decimal('amount', 14, 2).notNullable();
    t.string('note', 200);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['month', 'employee_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('payroll_adjustments');
  await knex.schema.alterTable('employees', t => { t.dropColumn('ot_rate'); });
  await knex.schema.alterTable('attendance', t => { t.dropColumn('ot_hours'); });
}
