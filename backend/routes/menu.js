import express from 'express';
import { getDB } from '../db.js';
import { ObjectId } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';
import { requireAdmin } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// Sanitize string input — strip HTML tags and limit length
function sanitizeString(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
}

function parseCategories(value) {
  if (Array.isArray(value)) {
    return value.map((category) => sanitizeString(category, 100)).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((category) => sanitizeString(category, 100)).filter(Boolean);
      }
    } catch {
      return [sanitizeString(value, 100)].filter(Boolean);
    }
  }

  return [];
}

async function compressImageLosslessly(buffer) {
  try {
    const { default: sharp } = await import('sharp');
    return sharp(buffer)
      .rotate()
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
  } catch (error) {
    console.warn('Sharp unavailable, uploading original image buffer:', error?.message || error);
    return buffer;
  }
}

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'food-menu', resource_type: 'image' }, // ponytail: use food-menu folder
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

// GET menu items (public, supports ?all=true, ?limit, ?offset, ?search, ?category, ?status parameters)
router.get('/', async (req, res) => {
  try {
    const { all, limit, offset, search, category, status, sort, adminMetadata } = req.query;
    const db = await getDB();
    
    const query = {};
    if (all !== 'true') {
      query.available = { $ne: false };
    } else if (status === 'In Stock') {
      query.available = { $ne: false };
    } else if (status === 'Out of Stock') {
      query.available = false;
    }

    if (category && category !== 'All') {
      query.$or = [
        { categories: category },
        { category: category }
      ];
    }

    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); // regex escape
      if (query.$or) {
        // If we already have $or for categories, we should wrap them in an $and
        const categoryOr = query.$or;
        delete query.$or;
        query.$and = [
          { $or: categoryOr },
          {
            $or: [
              { name: { $regex: escapedSearch, $options: 'i' } },
              { description: { $regex: escapedSearch, $options: 'i' } }
            ]
          }
        ];
      } else {
        query.$or = [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { description: { $regex: escapedSearch, $options: 'i' } }
        ];
      }
    }

    // Determine sorting logic using a strict allowlist
    let mongoSort = { chefPick: -1, createdAt: -1, _id: -1 }; // Default fallback
    if (sort === 'newest') {
      mongoSort = { createdAt: -1, _id: -1 };
    } else if (sort === 'oldest') {
      mongoSort = { createdAt: 1, _id: 1 };
    } else if (sort === 'name_asc') {
      mongoSort = { name: 1, _id: 1 };
    } else if (sort === 'name_desc') {
      mongoSort = { name: -1, _id: -1 };
    } else if (sort === 'price_asc') {
      mongoSort = { price: 1, name: 1, _id: 1 };
    } else if (sort === 'price_desc') {
      mongoSort = { price: -1, name: 1, _id: -1 };
    }

    let cursor = db.collection('menu_items')
      .find(query)
      .sort(mongoSort);

    const parsedLimit = parseInt(limit, 10) || 0;
    const parsedOffset = parseInt(offset, 10) || 0;

    if (parsedLimit > 0) {
      cursor = cursor.skip(parsedOffset).limit(parsedLimit);
    }

    let items = await cursor.toArray();
      
    // Migration for legacy data
    items = items.map(item => {
      if (!item.categories && item.category) {
        item.categories = [item.category];
      }
      return item;
    });

    if (adminMetadata === 'true') {
      // Inline Admin/MasterAdmin Authorization Check for metadata mode
      let hasAdminAccess = false;
      try {
        const token = req.cookies?.token;
        if (token) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded.role === 'ADMIN' || decoded.role === 'MASTER_ADMIN') {
            hasAdminAccess = true;
          }
        }
      } catch (err) {
        // Ignore token decode/verification error and deny access
      }

      if (!hasAdminAccess) {
        return res.status(403).json({ error: 'Forbidden: Admin access required for metadata.' });
      }

      const totalCount = await db.collection('menu_items').countDocuments(query);
      const hasMore = parsedLimit > 0 ? (parsedOffset + items.length < totalCount) : false;

      return res.json({
        items,
        totalCount,
        limit: parsedLimit || 10,
        offset: parsedOffset,
        hasMore
      });
    }
    
    res.json(items);
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create a new menu item (H1 fix: requireAdmin added)
router.post('/', requireAdmin, upload.single('imageFile'), async (req, res) => {
  try {
    const { name, price, description } = req.body;
    
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
    let image = typeof req.body.image === 'string' ? req.body.image.slice(0, 2000) : '';

    if (req.file) {
      const compressed = await compressImageLosslessly(req.file.buffer);
      const uploaded = await uploadBufferToCloudinary(compressed);
      image = uploaded.secure_url || uploaded.url || image;
    }

    const newItem = {
      name: sanitizedName,
      categories: parseCategories(req.body.categories),
      price: Number(price),
      description: sanitizedDesc,
      image,
      chefPick: parseBoolean(req.body.chefPick),
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

// PATCH bulk availability updates (H1 fix: requireAdmin added)
router.patch('/bulk-availability', requireAdmin, async (req, res) => {
  try {
    // Require JSON content-type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }

    const { ids, available } = req.body;

    // available must be an actual boolean
    if (typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available must be a boolean.' });
    }

    // ids must be an array
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array.' });
    }

    // Reject empty array
    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids array cannot be empty.' });
    }

    // Enforce maximum batch size
    if (ids.length > 100) {
      return res.status(400).json({ error: 'Maximum batch size is 100 items.' });
    }

    // Validate and trim every ID, require string
    const validatedIds = [];
    for (const id of ids) {
      if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Every ID must be a string.' });
      }
      const trimmed = id.trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'IDs cannot be empty strings.' });
      }
      if (!ObjectId.isValid(trimmed)) {
        return res.status(400).json({ error: `Invalid ObjectId format: ${trimmed}` });
      }
      validatedIds.push(trimmed);
    }

    // Deduplicate
    const uniqueIds = [...new Set(validatedIds)];

    const db = await getDB();
    const objectIds = uniqueIds.map(id => new ObjectId(id));

    // Find current state of matched items to calculate modified count
    const items = await db.collection('menu_items')
      .find({ _id: { $in: objectIds } })
      .project({ _id: 1, available: 1 })
      .toArray();

    const matchedCount = items.length;
    const modifiedCount = items.filter(item => item.available !== available).length;
    const missingCount = uniqueIds.length - matchedCount;

    // Perform bulk update
    await db.collection('menu_items').updateMany(
      { _id: { $in: objectIds } },
      { $set: { available, updatedAt: new Date() } }
    );

    res.json({
      requested: ids.length,
      unique: uniqueIds.length,
      matched: matchedCount,
      modified: modifiedCount,
      missing: missingCount
    });
  } catch (error) {
    console.error('Error updating bulk availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update a menu item (H1 fix: requireAdmin added)
router.put('/:id', requireAdmin, upload.single('imageFile'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    if (req.body.name !== undefined) updates.name = sanitizeString(req.body.name, 200);
    if (req.body.categories !== undefined) updates.categories = parseCategories(req.body.categories);
    if (req.body.price !== undefined) updates.price = Number(req.body.price);
    if (req.body.description !== undefined) updates.description = sanitizeString(req.body.description, 1000);
    if (req.body.chefPick !== undefined) updates.chefPick = parseBoolean(req.body.chefPick);
    if (req.body.available !== undefined) updates.available = parseBoolean(req.body.available, true);

    const db = await getDB();

    if (req.file) {
      // Fetch the existing item to get the old image URL for cleanup
      const existingItem = await db.collection('menu_items').findOne({ _id: new ObjectId(id) });
      if (existingItem?.image && existingItem.image.includes('cloudinary.com')) {
        // Delete the old image from Cloudinary to prevent orphaned assets
        const parts = existingItem.image.split('/');
        const filename = parts[parts.length - 1];
        const folder = parts[parts.length - 2];
        const publicId = `${folder}/${filename.split('.')[0]}`;
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudinaryErr) {
          console.error('Failed to delete old image from Cloudinary:', cloudinaryErr);
          // Non-blocking — proceed with the upload even if cleanup fails
        }
      }

      const compressed = await compressImageLosslessly(req.file.buffer);
      const uploaded = await uploadBufferToCloudinary(compressed);
      updates.image = uploaded.secure_url || uploaded.url || '';
    } else if (req.body.image !== undefined) {
      updates.image = typeof req.body.image === 'string' ? req.body.image.slice(0, 2000) : '';
    }
    
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
