import express from 'express';
import { getDB } from '../db.js';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';

const router = express.Router();

// GET all tables
router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const tables = await db.collection('tables').find({}).sort({ number: 1 }).toArray();
    // Return tables with base64 QR codes mapped (or we can return raw data and generate on frontend)
    // The requirement says: generate and download high-resolution QR codes, so saving them in the DB or returning them as data URI is good.
    res.json(tables);
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST to create a new table
router.post('/', async (req, res) => {
  try {
    const { name, location, seats, baseUrl } = req.body;
    const db = await getDB();
    
    // Auto-increment number or just get max number
    const maxTable = await db.collection('tables').find().sort({ number: -1 }).limit(1).toArray();
    const number = (maxTable.length > 0 ? maxTable[0].number : 0) + 1;
    
    const tableName = name || `Table ${number}`;
    
    // Unique URL for the table ordering system
    // Use frontend's baseUrl if provided, so mobile devices on the same network get the correct IP link
    const base = baseUrl || 'http://localhost:3000';
    const orderUrl = `${base}/?table=${encodeURIComponent(tableName)}`;
    
    // Generate high-resolution QR Code data URI
    // For high resolution, scale factor can be adjusted
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

// DELETE table by ID
router.delete('/:id', async (req, res) => {
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

export default router;
