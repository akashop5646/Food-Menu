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
    await db.collection('employee_activity_events').createIndex({ 'actor.userId': 1, createdAt: -1, _id: -1 });
    await db.collection('employee_activity_events').createIndex({ createdAt: -1, _id: -1 });
    await db.collection('employee_audit_failures').createIndex({ occurredAt: -1 });
    await db.collection('order_revisions').createIndex({ orderId: 1, newVersion: 1 }, { unique: true });
    await db.collection('order_revisions').createIndex({ timestamp: -1 });

    // Pre-audit duplicate checkoutSessionId and idempotencyKey values
    const dupSessions = await db.collection('orders').aggregate([
      { $match: { checkoutSessionId: { $type: 'string' } } },
      { $group: { _id: '$checkoutSessionId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    const dupKeys = await db.collection('orders').aggregate([
      { $match: { idempotencyKey: { $type: 'string' } } },
      { $group: { _id: '$idempotencyKey', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (dupSessions.length > 0 || dupKeys.length > 0) {
      const errorMsg = `Error: Database pre-audit found ${dupSessions.length} duplicate checkoutSessionId values and ${dupKeys.length} duplicate idempotencyKey values. Startup aborted.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Create unique partial indexes
    await db.collection('orders').createIndex(
      { checkoutSessionId: 1 },
      { unique: true, partialFilterExpression: { checkoutSessionId: { $type: 'string' } } }
    );
    await db.collection('orders').createIndex(
      { idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
    );

    console.log('✅ MongoDB Indexes verified/created successfully.');
  } catch (err) {
    if (err.message && err.message.startsWith('Error: Database pre-audit')) {
      throw err; // startup-blocking
    }
    console.warn('⚠️ Non-blocking index creation error:', err.message);
  }

  return db;
}

export async function getDB() {
  if (mockDb) return mockDb;
  if (!db) await connectDB();
  return db;
}
