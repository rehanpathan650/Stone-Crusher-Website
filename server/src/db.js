import fs from 'node:fs';
import path from 'node:path';
import knex from 'knex';
import { config } from './config.js';

export const isPg = Boolean(config.databaseUrl);

if (!isPg) fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });

export const db = knex(
  isPg
    ? {
        client: 'pg',
        connection: config.databaseSsl
          ? { connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } }
          : config.databaseUrl,
        pool: { min: 0, max: config.dbPoolMax },
      }
    : {
        client: 'better-sqlite3',
        connection: { filename: config.sqliteFile },
        useNullAsDefault: true,
        pool: {
          afterCreate(conn, done) {
            conn.pragma('journal_mode = WAL');
            conn.pragma('foreign_keys = ON');
            conn.pragma('busy_timeout = 5000');
            done();
          },
        },
      }
);

/** Case-insensitive LIKE for the active database. */
export const likeOp = isPg ? 'ilike' : 'like';

export async function migrate() {
  await db.migrate.latest({
    directory: path.join(config.root, 'src', 'migrations'),
    loadExtensions: ['.js'],
  });
}
