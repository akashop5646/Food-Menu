import { MongoClient } from 'mongodb';
import dns from 'dns';

// Force Google DNS — Reliance ISP blocks SRV record lookups
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (err) {
  console.warn('Failed to set DNS servers (expected in some serverless environments):', err.message);
}

let client;
let db;

export async function connectDB() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB — database: ${dbName}`);
  return db;
}

export async function getDB() {
  if (!db) await connectDB();
  return db;
}

