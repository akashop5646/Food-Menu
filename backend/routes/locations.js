import express from 'express';
import { getDB } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

// GET all locations (public — needed for customer-facing features)
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

// POST to create a new location (H1 fix: requireAdmin added)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    // M3 fix: validate type and sanitize
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });

    const sanitizedName = name.replace(/<[^>]*>/g, '').trim().slice(0, 200);
    if (!sanitizedName) return res.status(400).json({ error: 'Invalid location name' });

    const db = await getDB();
    const newLocation = { name: sanitizedName, createdAt: new Date() };
    const result = await db.collection('locations').insertOne(newLocation);
    newLocation._id = result.insertedId;

    res.status(201).json(newLocation);
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a location by ID (requireAdmin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid location ID' });
    }

    const db = await getDB();

    // Check if any tables still reference this location
    const assignedTables = await db.collection('tables').find({
      $or: [
        { locationId: id },
        { locationId: new ObjectId(id) }
      ]
    }).toArray();

    if (assignedTables.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete location while tables are assigned to it.',
        code: 'LOCATION_IN_USE',
        assignedTableCount: assignedTables.length
      });
    }

    const result = await db.collection('locations').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
