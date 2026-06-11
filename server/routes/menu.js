import express from 'express';
import { getDB } from '../db.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

// GET all menu items (public)
router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const items = await db.collection('menu_items')
      .find({ available: { $ne: false } })
      .sort({ chefPick: -1, createdAt: -1 })
      .toArray();
    res.json(items);
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET distinct categories
router.get('/categories', async (req, res) => {
  try {
    const db = await getDB();
    const categories = await db.collection('menu_items').distinct('category');
    res.json(categories.sort());
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create a new menu item
router.post('/', async (req, res) => {
  try {
    const { name, category, price, description, image, chefPick } = req.body;
    if (!name || !category || price == null) {
      return res.status(400).json({ error: 'Name, category, and price are required.' });
    }

    const db = await getDB();
    const newItem = {
      name,
      category,
      price: Number(price),
      description: description || '',
      image: image || '',
      chefPick: Boolean(chefPick),
      available: true,
      createdAt: new Date(),
    };

    const result = await db.collection('menu_items').insertOne(newItem);
    newItem._id = result.insertedId;
    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating menu item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update a menu item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const allowed = ['name', 'category', 'price', 'description', 'image', 'chefPick', 'available'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = key === 'price' ? Number(req.body[key]) : req.body[key];
      }
    }

    const db = await getDB();
    const result = await db.collection('menu_items').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Error updating menu item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a menu item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDB();
    const result = await db.collection('menu_items').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting menu item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
