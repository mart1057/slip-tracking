// สร้างฐานข้อมูล (ถ้ายังไม่มี) และตารางจาก db/schema.sql  ใช้: npm run db:init
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const url = new URL(config.databaseUrl);
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`ชื่อฐานข้อมูลใน DATABASE_URL ใช้ได้เฉพาะตัวอักษร ตัวเลข และ _ (ได้รับ "${dbName}")`);
  process.exit(1);
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (!exists.rowCount) {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`สร้างฐานข้อมูล ${dbName} แล้ว`);
}
await admin.end();

const schema = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/schema.sql'), 'utf8');
const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();
await client.query(schema);
await client.end();
console.log(`ตารางในฐานข้อมูล ${dbName} พร้อมใช้งาน`);
