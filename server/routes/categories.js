import express from 'express';
import { getDB } from '../db.js';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET all categories (public — needed for customer menu display)
router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const categories = await db.collection('categories').find().sort({ name: 1 }).toArray();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST add a new category (H1 fix: requireAdmin added)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    // M3 fix: validate type and sanitize
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const sanitizedName = name.replace(/<[^>]*>/g, '').trim().slice(0, 100);
    if (!sanitizedName) {
      return res.status(400).json({ error: 'Invalid category name' });
    }

    const db = await getDB();
    // Check if it already exists
    const existing = await db.collection('categories').findOne({ name: sanitizedName });
    if (existing) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const newCategory = { name: sanitizedName };
    const result = await db.collection('categories').insertOne(newCategory);
    newCategory._id = result.insertedId;
    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a category (H1 fix: requireAdmin added)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDB();
    const result = await db.collection('categories').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
