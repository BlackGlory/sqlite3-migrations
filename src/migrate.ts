import type { Database } from 'sqlite3'
import { assert, isFunction } from '@blackglory/prelude'
import { promisify } from 'extra-promise'

export interface IMigration {
  version: number
  up: string | ((db: Database) => PromiseLike<void>)
  down: string | ((db: Database) => PromiseLike<void>)
}

export async function migrate(
  db: Database
, migrations: IMigration[]
, targetVersion: number = getMaximumVersion(migrations)
): Promise<void> {
  const run = promisify(db.run.bind(db))
  const exec = promisify(db.exec.bind(db))
  const get = promisify(db.get.bind(db))

  const maxVersion = getMaximumVersion(migrations)

  await run('BEGIN IMMEDIATE')
  try {
    while (true) {
      const done = await migrate(targetVersion, maxVersion)
      if (done) break
    }

    await run('COMMIT')
  } catch (e) {
    await run('ROLLBACK')
    throw e
  }

  async function migrate(
    targetVersion: number
  , maxVersion: number
  ): Promise<boolean> {
    const currentVersion = await getDatabaseVersion()
    if (maxVersion < currentVersion) {
      return true
    } else {
      if (currentVersion === targetVersion) {
        return true
      } else if (currentVersion < targetVersion) {
        await upgrade()
        return false
      } else {
        await downgrade()
        return false
      }
    }
  }

  async function upgrade(): Promise<void> {
    const currentVersion = await getDatabaseVersion()
    const targetVersion = currentVersion + 1

    const migration = migrations.find(x => x.version === targetVersion)
    assert(migration, `Cannot find migration for version ${targetVersion}`)

    try {
      if (isFunction(migration.up)) {
        await migration.up(db)
      } else {
        await exec(migration.up)
      }
    } catch (e) {
      console.error(`Upgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      throw e
    }
    await setDatabaseVersion(targetVersion)
  }

  async function downgrade(): Promise<void> {
    const currentVersion = await getDatabaseVersion()
    const targetVersion = currentVersion - 1

    const migration = migrations.find(x => x.version === currentVersion)
    assert(migration, `Cannot find migration for version ${targetVersion}`)

    try {
      if (isFunction(migration.down)) {
        await migration.down(db)
      } else {
        await exec(migration.down)
      }
    } catch (e) {
      console.error(`Downgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      throw e
    }
    await setDatabaseVersion(targetVersion)
  }

  async function getDatabaseVersion(): Promise<number> {
    const row = await get('PRAGMA user_version;') as {
      user_version: number
    }

    return row.user_version
  }

  async function setDatabaseVersion(version: number): Promise<void> {
    // PRAGMA不支持变量
    await run(`PRAGMA user_version = ${ version }`)
  }
}

function getMaximumVersion(migrations: IMigration[]): number {
  return migrations.reduce((max, cur) => Math.max(cur.version, max), 0)
}
