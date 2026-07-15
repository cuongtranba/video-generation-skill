import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export type Database = pg.Pool

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createPool(connectionString: string): Database {
  return new pg.Pool({ connectionString })
}

export async function migrate(db: Database): Promise<void> {
  for (const name of ['001_init.sql', '002_style.sql']) {
    const sqlPath = path.join(__dirname, '..', 'migrations', name)
    const sql = await readFile(sqlPath, 'utf8')
    await db.query(sql)
  }
}
