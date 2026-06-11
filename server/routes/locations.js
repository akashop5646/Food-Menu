import express from 'express';
import { getDB } from '../db.js';

const router = express.Router();

// GET all locations
router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const locations = await db.collection('locations').find({}).sort({ name: 1 }).toArray();
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST to create a new location
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const db = await getDB();
    const newLocation = { name, createdAt: new Date() };
    const result = await db.collection('locations').insertOne(newLocation);
    newLocation._id = result.insertedId;
    
    res.status(201).json(newLocation);
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
