import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);
dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

async function run() {
  if (!uri || !dbName) {
    console.error('Error: MongoDB URI or Database name is missing from environment.');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('checkout_codes');

    // Count legacy records where expiresAt does not exist
    const count = await collection.countDocuments({
      expiresAt: { $exists: false }
    });

    if (count === 0) {
      console.log('Removed 0 legacy checkout-code records.');
      return;
    }

    // Delete those records
    const result = await collection.deleteMany({
      expiresAt: { $exists: false }
    });

    console.log(`Removed ${result.deletedCount} legacy checkout-code records.`);
  } catch (err) {
    console.error('Error while running legacy checkout codes cleanup script:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
