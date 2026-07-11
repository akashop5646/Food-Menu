import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// Get all staff members
router.get('/staff', requireAdmin, async (req, res) => {
  try {
    const db = await getDB();
    const staff = await db.collection('admins').find({}).project({ password: 0 }).toArray();
    res.json(staff);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch staff members' });
  }
});

// Add a new staff member
router.post('/staff', requireAdmin, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const db = await getDB();
    const existing = await db.collection('admins').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'A staff member with this email already exists' });
    }

    const newStaff = {
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
      role: 'STAFF',
      createdAt: new Date(),
    };

    if (password) {
      newStaff.password = await bcrypt.hash(password, 12);
      newStaff.provider = 'email';
    } else {
      newStaff.provider = 'google'; // Indicates they must use Google Sign-in
    }

    const result = await db.collection('admins').insertOne(newStaff);
    newStaff._id = result.insertedId;
    delete newStaff.password;
    
    res.status(201).json(newStaff);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add staff member' });
  }
});

// Update a staff member's role
router.patch('/staff/:id/role', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (role !== 'ADMIN' && role !== 'STAFF') {
      return res.status(400).json({ error: 'Invalid role. Master Admin role cannot be assigned.' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const db = await getDB();
    const targetUser = await db.collection('admins').findOne({ _id: new ObjectId(id) });
    
    if (!targetUser) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // A MASTER_ADMIN account cannot be edited or demoted
    if (targetUser.role === 'MASTER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Master Admin account is protected.' });
    }

    // Admin cannot change any other admin roles
    if (targetUser.role === 'ADMIN' && req.user.role !== 'MASTER_ADMIN') {
      return res.status(403).json({ error: 'You cannot modify the role of another Admin' });
    }

    await db.collection('admins').updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.json({ success: true, role });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update staff member role' });
  }
});

// Delete a staff member
router.delete('/staff/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent an admin from deleting themselves
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const db = await getDB();
    const targetUser = await db.collection('admins').findOne({ _id: new ObjectId(id) });

    if (!targetUser) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // A MASTER_ADMIN account cannot be deleted
    if (targetUser.role === 'MASTER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Master Admin account is protected.' });
    }

    // Admin cannot delete other admin accounts
    if (targetUser.role === 'ADMIN' && req.user.role !== 'MASTER_ADMIN') {
      return res.status(403).json({ error: 'You cannot delete another Admin account' });
    }

    await db.collection('admins').deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete staff member' });
  }
});

// Get Razorpay Key ID (Public endpoint)
router.get('/razorpay', async (req, res) => {
  try {
    res.json({ razorpayKeyId: process.env.RAZORPAY_KEY_ID || '' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Razorpay settings' });
  }
});

// Get Restaurant Name (Public endpoint)
router.get('/restaurant-name', async (req, res) => {
  try {
    const db = await getDB();
    const config = await db.collection('configs').findOne({ key: 'restaurant_name' });
    res.json({ restaurantName: config ? config.value : 'Aurum Restaurant' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch restaurant name' });
  }
});

// Update Restaurant Name (Admin only)
router.post('/restaurant-name', requireAdmin, async (req, res) => {
  try {
    const { restaurantName } = req.body;
    const db = await getDB();
    await db.collection('configs').updateOne(
      { key: 'restaurant_name' },
      { $set: { value: restaurantName || '' } },
      { upsert: true }
    );
    res.json({ success: true, restaurantName });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update restaurant name' });
  }
});

// Get Restaurant Profile (Public endpoint)
router.get('/restaurant-profile', async (req, res) => {
  try {
    const db = await getDB();
    const configs = await db.collection('configs').find({
      key: { $in: ['restaurant_name', 'restaurant_address', 'restaurant_phone', 'restaurant_fssai', 'restaurant_email', 'restaurant_hours', 'restaurant_map_link'] }
    }).toArray();
    
    const profile = {
      restaurantName: 'Aurum Restaurant',
      restaurantAddress: '',
      restaurantPhone: '',
      restaurantFssai: '',
      restaurantEmail: '',
      restaurantHours: 'Monday - Sunday, 11:00 AM - 11:00 PM IST',
      restaurantMapLink: ''
    };
    
    configs.forEach(config => {
      if (config.key === 'restaurant_name') profile.restaurantName = config.value;
      if (config.key === 'restaurant_address') profile.restaurantAddress = config.value;
      if (config.key === 'restaurant_phone') profile.restaurantPhone = config.value;
      if (config.key === 'restaurant_fssai') profile.restaurantFssai = config.value;
      if (config.key === 'restaurant_email') profile.restaurantEmail = config.value;
      if (config.key === 'restaurant_hours') profile.restaurantHours = config.value;
      if (config.key === 'restaurant_map_link') profile.restaurantMapLink = config.value;
    });
    
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch restaurant profile' });
  }
});

// Update Restaurant Profile (Admin only)
router.post('/restaurant-profile', requireAdmin, async (req, res) => {
  try {
    const { restaurantName, restaurantAddress, restaurantPhone, restaurantFssai, restaurantEmail, restaurantHours, restaurantMapLink } = req.body;
    const db = await getDB();
    
    const updates = [
      { key: 'restaurant_name', value: restaurantName || '' },
      { key: 'restaurant_address', value: restaurantAddress || '' },
      { key: 'restaurant_phone', value: restaurantPhone || '' },
      { key: 'restaurant_fssai', value: restaurantFssai || '' },
      { key: 'restaurant_email', value: restaurantEmail || '' },
      { key: 'restaurant_hours', value: restaurantHours || 'Monday - Sunday, 11:00 AM - 11:00 PM IST' },
      { key: 'restaurant_map_link', value: restaurantMapLink || '' }
    ];
    
    for (const update of updates) {
      await db.collection('configs').updateOne(
        { key: update.key },
        { $set: { value: update.value } },
        { upsert: true }
      );
    }
    
    res.json({ success: true, profile: { restaurantName, restaurantAddress, restaurantPhone, restaurantFssai, restaurantEmail, restaurantHours, restaurantMapLink } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update restaurant profile' });
  }
});

// Get Convenience Fee Configuration (Public endpoint)
router.get('/convenience-fee', async (req, res) => {
  try {
    const db = await getDB();
    const configs = await db.collection('configs').find({
      key: { $in: ['convenience_fee_enabled', 'convenience_fee_amount'] }
    }).toArray();

    let enabled = false;
    let amount = 0;
    let amountValid = false;

    configs.forEach(config => {
      if (config.key === 'convenience_fee_enabled') {
        enabled = typeof config.value === 'boolean' ? config.value : config.value === 'true';
      }
      if (config.key === 'convenience_fee_amount') {
        const val = Number(config.value);
        if (Number.isFinite(val) && val >= 0 && val <= 20) {
          amount = val;
          amountValid = true;
        }
      }
    });

    // Safely normalize malformed stored config to disabled/0
    if (enabled && !amountValid) {
      enabled = false;
      amount = 0;
    }

    res.json({ enabled, amount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch convenience fee configuration' });
  }
});

// Update Convenience Fee Configuration (Admin only)
router.post('/convenience-fee', requireAdmin, async (req, res) => {
  try {
    const { enabled, amount } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Enabled status must be a boolean' });
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0 || numAmount > 20) {
      return res.status(400).json({ error: 'Convenience fee amount must be a finite number between 0 and 20' });
    }

    const db = await getDB();
    await db.collection('configs').updateOne(
      { key: 'convenience_fee_enabled' },
      { $set: { value: enabled } },
      { upsert: true }
    );
    await db.collection('configs').updateOne(
      { key: 'convenience_fee_amount' },
      { $set: { value: numAmount } },
      { upsert: true }
    );

    res.json({ success: true, enabled, amount: numAmount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update convenience fee configuration' });
  }
});

export default router;
