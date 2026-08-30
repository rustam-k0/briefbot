import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../../config/env.js';
import { createDatabase } from './client.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
try { await migrate(db, { migrationsFolder: 'drizzle' }); }
finally { await pool.end(); }
