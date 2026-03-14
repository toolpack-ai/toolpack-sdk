import { DatabaseAdapter } from './base.js';
import { SQLiteAdapter } from './sqlite.js';
import { PostgresAdapter } from './postgres.js';
import { MysqlAdapter } from './mysql.js';

export class DatabaseAdapterFactory {
    static getAdapter(connectionString: string): DatabaseAdapter {
        if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) {
            return new PostgresAdapter(connectionString);
        } else if (connectionString.startsWith('mysql://')) {
            return new MysqlAdapter(connectionString);
        } else if (connectionString.startsWith('sqlite://')) {
            return new SQLiteAdapter(connectionString.replace('sqlite://', ''));
        } else {
            // Default to SQLite if it's just a file path and has no protocol
            return new SQLiteAdapter(connectionString);
        }
    }
}
