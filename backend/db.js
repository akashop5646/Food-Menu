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
let mockDb = null;

export function setMockDB(mock) {
  mockDb = mock;
}

export async function connectDB() {
  if (mockDb) return mockDb;
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing. Please configure it in your deployment environment variables.');
  }
  if (!dbName) {
    throw new Error('MONGODB_DB environment variable is missing. Please configure it in your deployment environment variables.');
  }
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB — database: ${dbName}`);
  
  // Database Optimizer: Create indexes on menu_items to speed up sorting, searching, and pagination queries
  try {
    await db.collection('menu_items').createIndex({ available: 1, chefPick: -1, createdAt: -1 });
    await db.collection('menu_items').createIndex({ chefPick: -1, createdAt: -1 });
    await db.collection('menu_items').createIndex({ categories: 1 });
    await db.collection('menu_items').createIndex({ name: 1 });
    await db.collection('orders').createIndex({ 'splitSettlement.status': 1, 'splitSettlement.processingLeaseUntil': 1 });
    await db.collection('orders').createIndex({ 'splitSettlement.recipients.transferId': 1 }, { sparse: true });
    console.log('✅ MongoDB Indexes verified/created successfully.');
  } catch (err) {
    console.warn('⚠️ Non-blocking index creation error:', err.message);
  }

  return db;
}

export async function getDB() {
  if (mockDb) return mockDb;
  if (!db) await connectDB();
  return db;
}
