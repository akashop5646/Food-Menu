import express from 'express';
import { getDB } from '../db.js';
import { ObjectId } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { requireAdmin } from '../middleware/auth.js';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const router = express.Router();

// Sanitize string input — strip HTML tags and limit length
function sanitizeString(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

// GET all menu items (public, supports ?all=true parameter)
router.get('/', async (req, res) => {
  try {
    const { all } = req.query;
    const db = await getDB();
    
    const query = {};
    if (all !== 'true') {
      query.available = { $ne: false };
    }

    let items = await db.collection('menu_items')
      .find(query)
      .sort({ chefPick: -1, createdAt: -1 })
      .toArray();
      
    // Migration for legacy data
    items = items.map(item => {
      if (!item.categories && item.category) {
        item.categories = [item.category];
      }
      return item;
    });
    
    res.json(items);
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create a new menu item (H1 fix: requireAdmin added)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, categories, price, description, image, chefPick } = req.body;
    
    // Validation
    if (!name || price == null) {
      return res.status(400).json({ error: 'Name and price are required.' });
    }

    // Input sanitization (M3 fix)
    const sanitizedName = sanitizeString(name, 200);
    const sanitizedDesc = sanitizeString(description, 1000);
    if (!sanitizedName) {
      return res.status(400).json({ error: 'Invalid item name.' });
    }

    const db = await getDB();
    const newItem = {
      name: sanitizedName,
      categories: Array.isArray(categories) ? categories.map(c => sanitizeString(c, 100)) : [],
      price: Number(price),
      description: sanitizedDesc,
      image: typeof image === 'string' ? image.slice(0, 2000) : '',
      chefPick: Boolean(chefPick),
      available: true,
      createdAt: new Date(),
    };

    // If this item is a chefPick, unset chefPick from all other items
    if (newItem.chefPick) {
      await db.collection('menu_items').updateMany({}, { $set: { chefPick: false } });
    }

    const result = await db.collection('menu_items').insertOne(newItem);
    newItem._id = result.insertedId;
    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating menu item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update a menu item (H1 fix: requireAdmin added)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, categories, price, description, image, chefPick, available } = req.body;
    const updates = {};
    const allowed = ['name', 'categories', 'price', 'description', 'image', 'chefPick', 'available'];
    
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'price') {
          updates[key] = Number(req.body[key]);
        } else if (key === 'categories') {
          updates[key] = Array.isArray(req.body[key]) ? req.body[key].map(c => sanitizeString(c, 100)) : [];
        } else if (key === 'name') {
          updates[key] = sanitizeString(req.body[key], 200);
        } else if (key === 'description') {
          updates[key] = sanitizeString(req.body[key], 1000);
        } else if (key === 'image') {
          updates[key] = typeof req.body[key] === 'string' ? req.body[key].slice(0, 2000) : '';
        } else {
          updates[key] = req.body[key];
        }
      }
    }

    const db = await getDB();
    
    // If this item is updated to be the chefPick, unset chefPick from all other items
    if (updates.chefPick === true) {
      await db.collection('menu_items').updateMany(
        { _id: { $ne: new ObjectId(id) } },
        { $set: { chefPick: false } }
      );
    }

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

// DELETE a menu item (H1 fix: requireAdmin added)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDB();
    
    const item = await db.collection('menu_items').findOne({ _id: new ObjectId(id) });
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    if (item.image && item.image.includes('cloudinary.com')) {
      const parts = item.image.split('/');
      const filename = parts[parts.length - 1];
      const folder = parts[parts.length - 2];
      const publicId = `${folder}/${filename.split('.')[0]}`;
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error('Failed to delete image from Cloudinary:', cloudinaryErr);
      }
    }

    const result = await db.collection('menu_items').deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting menu item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
