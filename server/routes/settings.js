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
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const db = await getDB();
    const targetUser = await db.collection('admins').findOne({ _id: new ObjectId(id) });
    
    if (!targetUser) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Admin cannot change any other admin roles
    if (targetUser.role === 'ADMIN') {
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

    // Admin cannot delete other admin accounts
    if (targetUser.role === 'ADMIN') {
      return res.status(403).json({ error: 'You cannot delete another Admin account' });
    }

    await db.collection('admins').deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete staff member' });
  }
});

// Get Google Pay ID (Public endpoint)
router.get('/gpay', async (req, res) => {
  try {
    const db = await getDB();
    const config = await db.collection('configs').findOne({ key: 'gpay_id' });
    res.json({ gpayId: config ? config.value : '' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Google Pay ID' });
  }
});

// Update Google Pay ID (Admin only)
router.post('/gpay', requireAdmin, async (req, res) => {
  try {
    const { gpayId } = req.body;
    if (gpayId && !gpayId.includes('@')) {
      return res.status(400).json({ error: 'Invalid UPI VPA format. Must contain @ (e.g. name@bank)' });
    }
    const db = await getDB();
    await db.collection('configs').updateOne(
      { key: 'gpay_id' },
      { $set: { value: gpayId || '' } },
      { upsert: true }
    );
    res.json({ success: true, gpayId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Google Pay ID' });
  }
});

export default router;
