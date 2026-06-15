import express from 'express';
import { getDB } from '../db.js';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET all tables (public — needed for customer-facing features)
router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const tables = await db.collection('tables').find({}).sort({ number: 1 }).toArray();
    res.json(tables);
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST to create a new table (H1 fix: requireAdmin added)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, location, seats, baseUrl } = req.body;
    const db = await getDB();
    
    // Auto-increment number or just get max number
    const maxTable = await db.collection('tables').find().sort({ number: -1 }).limit(1).toArray();
    const number = (maxTable.length > 0 ? maxTable[0].number : 0) + 1;
    
    const tableName = name || `Table ${number}`;
    const loc = location || 'Main Dining Room';
    
    // Unique URL for the table ordering system
    // Use frontend's baseUrl if provided, so mobile devices on the same network get the correct IP link
    const base = baseUrl || 'http://localhost:3000';
    const orderUrl = `${base}/?table=${encodeURIComponent(tableName)}&location=${encodeURIComponent(loc)}`;
    
    // Generate high-resolution QR Code data URI
    const qrUrl = await QRCode.toDataURL(orderUrl, {
      width: 800,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    const newTable = {
      number,
      name: tableName,
      location: location || 'Main Dining Room',
      seats: seats || 4,
      status: 'Idle',
      qrUrl,
      orderUrl,
      createdAt: new Date()
    };

    const result = await db.collection('tables').insertOne(newTable);
    newTable._id = result.insertedId;
    
    res.status(201).json(newTable);
  } catch (error) {
    console.error('Error creating table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE table by ID (H1 fix: requireAdmin added)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDB();
    const result = await db.collection('tables').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT to update a table by ID (requireAdmin)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location, seats, baseUrl } = req.body;
    const db = await getDB();

    const table = await db.collection('tables').findOne({ _id: new ObjectId(id) });
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const tableName = name || table.name;
    const loc = location || table.location;
    const s = seats !== undefined ? seats : table.seats;

    // Regenerate QR URL since table name or location might have changed
    const base = baseUrl || 'http://localhost:3000';
    const orderUrl = `${base}/?table=${encodeURIComponent(tableName)}&location=${encodeURIComponent(loc)}`;
    const qrUrl = await QRCode.toDataURL(orderUrl, {
      width: 800,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    const updateFields = {
      name: tableName,
      location: loc,
      seats: Number(s) || 4,
      orderUrl,
      qrUrl
    };

    await db.collection('tables').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    const updatedTable = { ...table, ...updateFields };
    res.json(updatedTable);
  } catch (error) {
    console.error('Error updating table:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
