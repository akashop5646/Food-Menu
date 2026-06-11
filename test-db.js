import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import dns from 'dns';

// Force Google DNS — Reliance ISP blocks SRV record lookups
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

async function testConnection() {
  console.log('🔌 Connecting to MongoDB...');
  console.log(`   URI: ${uri.replace(/\/\/.*@/, '//***:***@')}`);
  console.log(`   Database: ${dbName}`);

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected successfully!');

    const db = client.db(dbName);

    // Ping the database
    const pingResult = await db.command({ ping: 1 });
    console.log('✅ Ping result:', JSON.stringify(pingResult));

    // List existing collections
    const collections = await db.listCollections().toArray();
    console.log(`📂 Collections in "${dbName}":`, collections.length ? collections.map(c => c.name).join(', ') : '(none yet)');

    // Insert a test document
    const testCollection = db.collection('connection_test');
    const testDoc = { message: 'Hello from Aurum Table!', timestamp: new Date() };
    const insertResult = await testCollection.insertOne(testDoc);
    console.log('✅ Test insert successful! ID:', insertResult.insertedId.toString());

    // Read it back
    const found = await testCollection.findOne({ _id: insertResult.insertedId });
    console.log('✅ Test read successful! Message:', found.message);

    // Clean up the test document
    await testCollection.deleteOne({ _id: insertResult.insertedId });
    console.log('🧹 Test document cleaned up.');

    console.log('\n🎉 Database is fully working!');
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  } finally {
    await client.close();
    console.log('🔒 Connection closed.');
  }
}

testConnection();
