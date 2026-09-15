package com.pmgt.pos.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import app.cash.sqldelight.db.AfterVersion
import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.db.SqlSchema
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import java.io.File

/** Physical schema stays Watermelon v3; SQLDelight's generated logical schema is never run. */
internal object LegacySqlSchema : SqlSchema<QueryResult.Value<Unit>> {
    override val version: Long = LegacyTables.version.toLong()
    override fun create(driver: SqlDriver): QueryResult.Value<Unit> {
        LegacyDdl.statements.forEach { driver.execute(null, it, 0) }
        return QueryResult.Unit
    }
    override fun migrate(driver: SqlDriver, oldVersion: Long, newVersion: Long, vararg callbacks: AfterVersion): QueryResult.Value<Unit> {
        throw AdoptionBlocked("Unsupported local schema migration. The original database has been preserved.")
    }
}

object AndroidDatabase {
    /** Matches installed Watermelon JSIInstaller._resolveDatabasePath, including the root path. */
    fun legacyPath(context: Context): File = File(context.getDatabasePath("watermelon.db").path.replace("/databases", ""))

    /** Local adoption only. Use AdoptionVerifier before advertising server-verified readiness. */
    @Synchronized
    fun open(context: Context): PosDatabase {
        val path = legacyPath(context)
        var before: AdoptionIntegrity? = null
        val initializing = Initialization.state(context) == "initializing"
        if (path.exists()) {
            // Do not let an unreadable identity reach the mutating open helper.
            DeviceIdentity.readOrCreate(context, adopting = true)
            try {
                SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READONLY, {
                    throw AdoptionBlocked("Local database corruption detected. The original files have been preserved.")
                }).use { readonly ->
                    fun query(sql: String): List<List<String?>> = readonly.rawQuery(sql, null).use { cursor ->
                        buildList { while (cursor.moveToNext()) add((0 until cursor.columnCount).map { if (cursor.isNull(it)) null else cursor.getString(it) }) }
                    }
                    val interruptedEmptyCreate = initializing && readonly.version == 0 &&
                        query("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'android_metadata'").isEmpty()
                    if (!interruptedEmptyCreate) before = LegacyIntegrity.inspect(::query)
                }
            } catch (error: AdoptionBlocked) {
                throw error
            } catch (_: Exception) {
                throw AdoptionBlocked("The existing local database cannot be read. Adoption is blocked without replacing it.")
            }
        } else {
            Initialization.beginOrResume(context)
            DeviceIdentity.readOrCreate(context, adopting = false)
        }
        val driver = AndroidSqliteDriver(
            schema = LegacySqlSchema,
            context = context,
            name = path.path,
            callback = object : AndroidSqliteDriver.Callback(LegacySqlSchema) {
                override fun onConfigure(db: SupportSQLiteDatabase) {
                    // Same file and WAL: never copy only the main database.
                    db.query("PRAGMA journal_mode = WAL").use { it.moveToFirst() }
                }
                override fun onCorruption(db: SupportSQLiteDatabase) {
                    // Android's default handler deletes corrupt databases. Never invoke it here.
                    throw AdoptionBlocked("Local database corruption detected. The original files have been preserved.")
                }
            },
        )
        try {
            val after = LegacyIntegrity.inspect(driver) // Forces open before returning or completing intent.
            if (before != null && before != after) throw AdoptionBlocked("Local adoption integrity counts or metadata changed. Adoption is blocked.")
            if (Initialization.state(context) == "initializing") Initialization.complete(context)
            return PosDatabase(driver)
        } catch (error: Exception) {
            driver.close()
            if (error is AdoptionBlocked) throw error
            throw AdoptionBlocked("The local database could not be opened safely. Existing tablet files have been preserved.")
        }
    }
}
