/**
 * Users whose password was set by an administrator (new account or reset) must choose
 * their own password at their next sign-in, so the admin never keeps knowing it.
 */
export async function up(knex) {
  await knex.schema.alterTable('users', t => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('users', t => { t.dropColumn('must_change_password'); });
}
