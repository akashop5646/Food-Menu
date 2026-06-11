import express from 'express';
import { getDB } from '../db.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

// GET all categories
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

// POST add a new category
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const db = await getDB();
    // Check if it already exists
    const existing = await db.collection('categories').findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const newCategory = { name: name.trim() };
    const result = await db.collection('categories').insertOne(newCategory);
    newCategory._id = result.insertedId;
    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a category
router.delete('/:id', async (req, res) => {
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
