import sqlite3 from 'sqlite3'
import { migrate, IMigration } from '@src/migrate.js'
import { promisify } from 'extra-promise'

const migrations: IMigration[] = [
  {
    version: 1
  , up: `
      CREATE TABLE test (
        id INTEGER PRIMARY KEY
      );
    `
  , down: `
      DROP TABLE test;
    `
  }
, {
    version: 2
  , async up(db) {
      await promisify(db.exec.bind(db))(`
        ALTER TABLE test
          ADD COLUMN name TEXT;
      `)
    }
  , async down(db) {
      await promisify(db.exec.bind(db))(`
        -- https://www.sqlite.org/faq.html#q11
        CREATE TEMPORARY TABLE test_backup (
          id   INTEGER PRIMARY KEY
        , name TEXT
        );

        INSERT INTO test_backup
        SELECT id, name
          FROM test;

        DROP TABLE test;

        CREATE TABLE test (
          id INTEGER PRIMARY KEY
        );

        INSERT INTO test
        SELECT id
          FROM test_backup;

        DROP TABLE test_backup;
      `)
    }
  }
]

describe('migrate', () => {
  describe('The maximum version of migrations < user_version', () => {
    it('skip migrations', async () => {
      const db = new sqlite3.Database(':memory:')
      await setDatabaseVersion(db, 999)

      await migrate(db, migrations, 2)
      const versionAfter = await getDatabaseVersion(db)

      expect(versionAfter).toBe(999)
    })
  })

  test('upgrade', async () => {
    const db = new sqlite3.Database(':memory:')

    const versionBefore = await getDatabaseVersion(db)
    await migrate(db, migrations, 2)
    const versionAfter = await getDatabaseVersion(db)
    const tables = await getDatabaseTables(db)
    const schema = await getTableSchema(db, 'test')

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(2)
    expect(tables).toEqual(['test'])
    expect(schema).toMatchObject([
      {
        name: 'id'
      , type: 'INTEGER'
      }
    , {
        name: 'name'
      , type: 'TEXT'
      }
    ])
  })

  test('downgrade', async () => {
    const db = new sqlite3.Database(':memory:')
    await migrate(db, migrations, 2)

    const versionBefore = await getDatabaseVersion(db)
    await migrate(db, migrations, 0)
    const versionAfter = await getDatabaseVersion(db)
    const tables = await getDatabaseTables(db)

    expect(versionBefore).toBe(2)
    expect(versionAfter).toBe(0)
    expect(tables).toEqual([])
  })
})

async function setDatabaseVersion(
  db: sqlite3.Database
, version: number
): Promise<void> {
  await promisify(db.exec.bind(db))(`PRAGMA user_version = ${version};`)
}

async function getDatabaseVersion(db: sqlite3.Database): Promise<number> {
  const result = await promisify(db.get.bind(db))('PRAGMA user_version;') as {
    user_version: number
  }

  return result['user_version']
}

async function getTableSchema(
  db: sqlite3.Database
, tableName: string
): Promise<Array<{
  name: string
  type: string
}>> {
  const result = await promisify(db.all.bind(db))(`PRAGMA table_info(${tableName});`) as Array<{
    name: string
    type: string
  }>

  return result
}

async function getDatabaseTables(db: sqlite3.Database): Promise<string[]> {
  const result = await promisify(db.all.bind(db))(`
    SELECT name
      FROM sqlite_master
     WHERE type='table';
  `) as Array<{ name: string }>

  return result.map(x => x['name'])
}
