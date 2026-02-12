import type { Database } from 'sqlite3'
import { assert, isFunction } from '@blackglory/prelude'
import { promisify } from 'extra-promise'
import { max } from 'extra-utils'

export interface IMigration {
  version: number
  up: string | ((db: Database) => PromiseLike<void>)
  down: string | ((db: Database) => PromiseLike<void>)
}

interface IMigrateOptions {
  targetVersion?: number
  throwOnNewerVersion?: boolean
}

export async function migrate(
  db: Database
, migrations: IMigration[]
, {
    targetVersion = getMaximumVersion(migrations)
  , throwOnNewerVersion = false
  }: IMigrateOptions = {}
): Promise<void> {
  const run = promisify(db.run.bind(db))
  const exec = promisify(db.exec.bind(db))
  const get = promisify(db.get.bind(db))

  const maxVersion = getMaximumVersion(migrations)

  while (true) {
    await run('BEGIN IMMEDIATE')
    try {
      const done = await migrate(targetVersion, maxVersion)

      await run('COMMIT')

      if (done) break
    } catch (e) {
      await run('ROLLBACK')

      throw e
    }
  }

  async function migrate(
    targetVersion: number
  , maxVersion: number
  ): Promise<boolean> {
    const currentVersion = await getDatabaseVersion()
    if (maxVersion < currentVersion) {
      if (throwOnNewerVersion) {
        throw new Error(`Database version ${currentVersion} is higher than the maximum known migration version.`)
      } else {
        return true
      }
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
    assert(migration, `Cannot find a migration for version ${targetVersion}.`)

    try {
      if (isFunction(migration.up)) {
        await migration.up(db)
      } else {
        await exec(migration.up)
      }
    } catch (e) {
      throw new Error(
        `Upgrade from version ${currentVersion} to version ${targetVersion} failed.`
      , { cause: e }
      )
    }
    await setDatabaseVersion(targetVersion)
  }

  async function downgrade(): Promise<void> {
    const currentVersion = await getDatabaseVersion()
    const targetVersion = currentVersion - 1

    const migration = migrations.find(x => x.version === currentVersion)
    assert(migration, `Cannot find a migration for version ${currentVersion}.`)

    try {
      if (isFunction(migration.down)) {
        await migration.down(db)
      } else {
        await exec(migration.down)
      }
    } catch (e) {
      throw new Error(
        `Downgrade from version ${currentVersion} to version ${targetVersion} failed.`
      , { cause: e }
      )
    }
    await setDatabaseVersion(targetVersion)
  }

  async function getDatabaseVersion(): Promise<number> {
    const row = await get('PRAGMA user_version') as {
      user_version: number
    }

    return row['user_version']
  }

  async function setDatabaseVersion(version: number): Promise<void> {
    // PRAGMA不支持变量
    await run(`PRAGMA user_version = ${version}`)
  }
}

function getMaximumVersion(migrations: IMigration[]): number {
  return migrations
    .map(x => x.version)
    .reduce(max, 0)
}
