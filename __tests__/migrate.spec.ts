import { describe, test, expect } from 'vitest'
import { Database } from 'sqlite3'
import { migrate, IMigration } from '@src/migrate.js'
import { promisify } from 'extra-promise'
import { getErrorAsync } from 'return-style'

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
  describe('The maximum known migration version < user_version', () => {
    test('throwOnNewerVersion = false', async () => {
      const db = new Database(':memory:')
      await setDatabaseVersion(db, 999)

      await migrate(db, migrations, {
        targetVersion: 2
      , throwOnNewerVersion: false
      })
      const version = await getDatabaseVersion(db)

      expect(version).toBe(999)
    })

    test('', async () => {
      const db = new Database(':memory:')
      setDatabaseVersion(db, 999)

      const error = await getErrorAsync(() => migrate(db, migrations, {
        targetVersion: 2
      , throwOnNewerVersion: true
      }))

      expect(error).toBeInstanceOf(Error)
      const version = await getDatabaseVersion(db)
      expect(version).toBe(999)
    })
  })

  test('upgrade', async () => {
    const db = new Database(':memory:')

    const versionBefore = await getDatabaseVersion(db)
    await migrate(db, migrations, { targetVersion: 2 })
    const versionAfter = await getDatabaseVersion(db)

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(2)
    const tables = await getDatabaseTables(db)
    expect(tables).toEqual(['test'])
    const schema = await getTableSchema(db, 'test')
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
    const db = new Database(':memory:')
    await migrate(db, migrations, { targetVersion: 2 })

    const versionBefore = await getDatabaseVersion(db)
    await migrate(db, migrations, { targetVersion: 0 })
    const versionAfter = await getDatabaseVersion(db)

    expect(versionBefore).toBe(2)
    expect(versionAfter).toBe(0)
    const tables = await getDatabaseTables(db)
    expect(tables).toEqual([])
  })

  test('edge: empty migrations', async () => {
    const db = new Database(':memory:')

    const versionBefore = await getDatabaseVersion(db)
    await migrate(db, [])
    const versionAfter = await getDatabaseVersion(db)

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(0)
  })
})

async function setDatabaseVersion(
  db: Database
, version: number
): Promise<void> {
  await promisify(db.exec.bind(db))(`PRAGMA user_version = ${version};`)
}

async function getDatabaseVersion(db: Database): Promise<number> {
  const result = await promisify(db.get.bind(db))('PRAGMA user_version;') as {
    user_version: number
  }

  return result['user_version']
}

async function getTableSchema(
  db: Database
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

async function getDatabaseTables(db: Database): Promise<string[]> {
  const result = await promisify(db.all.bind(db))(`
    SELECT name
      FROM sqlite_master
     WHERE type='table';
  `) as Array<{ name: string }>

  return result.map(x => x['name'])
}
