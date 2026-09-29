import { buildApp } from './app.js';
import { getRuntimeConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';

const config = getRuntimeConfig();
const database = openDatabase(config.databasePath);
const repository = new Repository(database);
const app = buildApp({ repository, config });

const close = async (): Promise<void> => {
  await app.close();
  database.close();
};

process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));

try {
  await app.listen({ host: config.host, port: config.port });
  console.info(`XDB API listening on http://${config.host}:${config.port}`);
} catch (error) {
  console.error(error);
  await close();
  process.exit(1);
}
