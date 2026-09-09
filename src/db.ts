import Dexie, { type Table } from 'dexie';

export interface Row {
  id?: number;
  key: string;
  value: unknown;
}

interface GarageDB extends Dexie {
  kv: Table<Row, string>;
}

class GarageDB_ extends Dexie {
  constructor() {
    super('garage-tracker');
    this.version(1).stores({ kv: 'key' });
  }
  kv!: Table<Row, string>;
}

const db = new GarageDB_();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function kvDel(key: string): Promise<void> {
  await db.kv.delete(key);
}

export interface AppConfig {
  user: string;      // github username
  repo: string;      // private data repo name (default: garage)
  pat: string;       // fine-grained PAT (runtime only, never leaves the device except to api.github.com / github.com)
  name: string;      // git commit identity name
  email: string;     // git commit identity email
  lastSync?: string; // iso
  remoteHead?: string; // last known head sha
}

export async function getCfg(): Promise<AppConfig | undefined> {
  return kvGet<AppConfig>('cfg');
}
export async function saveCfg(cfg: AppConfig): Promise<void> {
  await kvSet('cfg', cfg);
}
