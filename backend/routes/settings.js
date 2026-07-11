import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDB } from '../db.js';
import { requireAdmin, requireMasterAdmin } from '../middleware/auth.js';

const router = Router();

const SETTLEMENT_CONFIG_ID = 'razorpay_route_split_settlement';
const MAX_SETTLEMENT_RECIPIENTS = 10;
const TOTAL_BASIS_POINTS = 10000;
const LINKED_ACCOUNT_ID_PATTERN = /^acc_[A-Za-z0-9_]{3,100}$/;
const RECIPIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

class SettlementValidationError extends Error {}

const createEmptyDraft = () => ({
  recipients: [],
  totalBasisPoints: 0,
  updatedAt: null,
  updatedBy: null,
});

const createDefaultSettlementConfig = (userId) => {
  const now = new Date();
  return {
    provider: 'RAZORPAY_ROUTE',
    splitBase: 'FOOD_SUBTOTAL',
    version: 0,
    revision: 0,
    activeStatus: 'NOT_CONFIGURED',
    active: null,
    draft: createEmptyDraft(),
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
};

async function getSettlementConfig(db, userId) {
  const config = await db.collection('settlement_configs').findOneAndUpdate(
    { _id: SETTLEMENT_CONFIG_ID },
    { $setOnInsert: createDefaultSettlementConfig(userId) },
    { upsert: true, returnDocument: 'after' }
  );

  return config;
}

function getTotalBasisPoints(recipients) {
  return recipients.reduce(
    (total, recipient) => total + (recipient.enabled ? recipient.allocationBasisPoints : 0),
    0
  );
}

export function getAllocationSummary(recipients) {
  const externalAllocationBasisPoints = getTotalBasisPoints(recipients);
  return {
    externalAllocationBasisPoints,
    platformRetainedBasisPoints: TOTAL_BASIS_POINTS - externalAllocationBasisPoints,
  };
}

function normalizeRecipients(recipients) {
  if (!Array.isArray(recipients)) {
    throw new SettlementValidationError('Recipients must be an array');
  }

  if (recipients.length > MAX_SETTLEMENT_RECIPIENTS) {
    throw new SettlementValidationError(`A maximum of ${MAX_SETTLEMENT_RECIPIENTS} recipients is allowed`);
  }

  const seenIds = new Set();
  const seenEnabledAccountIds = new Set();

  return recipients.map((recipient) => {
    if (!recipient || typeof recipient !== 'object') {
      throw new SettlementValidationError('Each recipient must be an object');
    }

    const id = recipient.id ? String(recipient.id) : randomUUID();
    if (!RECIPIENT_ID_PATTERN.test(id) || seenIds.has(id)) {
      throw new SettlementValidationError('Recipient IDs must be unique valid identifiers');
    }
    seenIds.add(id);

    const label = typeof recipient.label === 'string' ? recipient.label.trim() : '';
    if (!label || label.length > 80) {
      throw new SettlementValidationError('Each recipient label must be between 1 and 80 characters');
    }

    if (typeof recipient.enabled !== 'boolean') {
      throw new SettlementValidationError('Recipient enabled status must be a boolean');
    }

    const linkedAccountId = typeof recipient.linkedAccountId === 'string'
      ? recipient.linkedAccountId.trim()
      : '';
    const allocationBasisPoints = Number(recipient.allocationBasisPoints);

    if (!Number.isInteger(allocationBasisPoints) || allocationBasisPoints < 0 || allocationBasisPoints > TOTAL_BASIS_POINTS) {
      throw new SettlementValidationError('Recipient allocation must be an integer between 0 and 10000 basis points');
    }

    if (recipient.enabled) {
      if (!LINKED_ACCOUNT_ID_PATTERN.test(linkedAccountId)) {
        throw new SettlementValidationError('Each enabled recipient requires a valid Razorpay linked account ID');
      }
      if (seenEnabledAccountIds.has(linkedAccountId)) {
        throw new SettlementValidationError('Enabled recipients cannot use duplicate Razorpay linked account IDs');
      }
      if (allocationBasisPoints <= 0) {
        throw new SettlementValidationError('Each enabled recipient must have an allocation greater than 0');
      }
      seenEnabledAccountIds.add(linkedAccountId);
    }

    return { id, label, linkedAccountId, allocationBasisPoints, enabled: recipient.enabled };
  });
}

export function validateDraftRecipients(recipients) {
  const normalizedRecipients = normalizeRecipients(recipients);
  const totalBasisPoints = getTotalBasisPoints(normalizedRecipients);

  if (totalBasisPoints > TOTAL_BASIS_POINTS) {
    throw new SettlementValidationError('Enabled allocation cannot exceed 100%');
  }

  return { recipients: normalizedRecipients, totalBasisPoints };
}

export function validateDraftForActivation(draft) {
  const { recipients, totalBasisPoints } = validateDraftRecipients(draft?.recipients || []);

  if (totalBasisPoints <= 0 || totalBasisPoints > TOTAL_BASIS_POINTS) {
    throw new SettlementValidationError('Enabled external recipients must receive more than 0% and no more than 100%');
  }

  return { recipients, totalBasisPoints };
}

function presentSettlementConfig(config) {
  const draft = config.draft || createEmptyDraft();
  const draftSummary = getAllocationSummary(draft.recipients || []);
  const draftTotal = draftSummary.externalAllocationBasisPoints;
  const activeSummary = config.active
    ? getAllocationSummary(config.active.recipients || [])
    : null;
  const isValidForActivation = draftTotal > 0 && draftTotal <= TOTAL_BASIS_POINTS;

  return {
    provider: 'RAZORPAY_ROUTE',
    splitBase: 'FOOD_SUBTOTAL',
    status: config.activeStatus === 'ACTIVE'
      ? 'ACTIVE'
      : config.activeStatus === 'DISABLED'
        ? 'DISABLED'
        : (draft.recipients || []).length > 0 ? 'DRAFT' : 'NOT_CONFIGURED',
    version: config.version || 0,
    revision: config.revision || 0,
    createdAt: config.createdAt || null,
    updatedAt: config.updatedAt || null,
    active: config.active ? {
      version: config.active.version,
      recipients: config.active.recipients,
      totalBasisPoints: config.active.totalBasisPoints,
      externalAllocationBasisPoints: activeSummary.externalAllocationBasisPoints,
      platformRetainedBasisPoints: activeSummary.platformRetainedBasisPoints,
      activatedAt: config.active.activatedAt,
      activatedBy: config.active.activatedBy,
      disabledAt: config.disabledAt || null,
      disabledBy: config.disabledBy || null,
    } : null,
    draft: {
      recipients: draft.recipients || [],
      totalBasisPoints: draftTotal,
      externalAllocationBasisPoints: draftSummary.externalAllocationBasisPoints,
      platformRetainedBasisPoints: draftSummary.platformRetainedBasisPoints,
      isValidForActivation,
      updatedAt: draft.updatedAt || null,
    },
  };
}

function parseRevision(revision) {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new SettlementValidationError('A valid settlement configuration revision is required');
  }
  return revision;
}

function sendSettlementConflict(res) {
  return res.status(409).json({
    error: 'Settlement configuration changed in another session. Refresh and try again.',
  });
}

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

// Split settlement configuration is intentionally isolated from public and normal-admin settings.
// It stores Route configuration only; it never creates or manages Razorpay transfers.
router.get('/split-settlement', requireMasterAdmin, async (req, res) => {
  try {
    const db = await getDB();
    const config = await getSettlementConfig(db, req.user.id);
    res.json(presentSettlementConfig(config));
  } catch (error) {
    console.error('Failed to fetch split settlement configuration');
    res.status(500).json({ error: 'Failed to fetch split settlement configuration' });
  }
});

router.put('/split-settlement/draft', requireMasterAdmin, async (req, res) => {
  try {
    const revision = parseRevision(req.body?.revision);
    const { recipients, totalBasisPoints } = validateDraftRecipients(req.body?.recipients);
    const db = await getDB();
    const now = new Date();
    const draft = {
      recipients,
      totalBasisPoints,
      updatedAt: now,
      updatedBy: req.user.id,
    };

    const config = await db.collection('settlement_configs').findOneAndUpdate(
      { _id: SETTLEMENT_CONFIG_ID, revision },
      {
        $set: {
          draft,
          updatedAt: now,
          updatedBy: req.user.id,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!config) {
      return sendSettlementConflict(res);
    }

    res.json(presentSettlementConfig(config));
  } catch (error) {
    if (error instanceof SettlementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to save split settlement draft');
    res.status(500).json({ error: 'Failed to save split settlement draft' });
  }
});

router.post('/split-settlement/activate', requireMasterAdmin, async (req, res) => {
  try {
    const revision = parseRevision(req.body?.revision);
    const db = await getDB();
    const currentConfig = await db.collection('settlement_configs').findOne({
      _id: SETTLEMENT_CONFIG_ID,
      revision,
    });

    if (!currentConfig) {
      return sendSettlementConflict(res);
    }

    const { recipients, totalBasisPoints } = validateDraftForActivation(currentConfig.draft);
    const now = new Date();
    const nextVersion = (currentConfig.version || 0) + 1;
    const active = {
      version: nextVersion,
      recipients,
      totalBasisPoints,
      activatedAt: now,
      activatedBy: req.user.id,
    };

    const config = await db.collection('settlement_configs').findOneAndUpdate(
      { _id: SETTLEMENT_CONFIG_ID, revision },
      {
        $set: {
          active,
          activeStatus: 'ACTIVE',
          version: nextVersion,
          updatedAt: now,
          updatedBy: req.user.id,
        },
        $unset: { disabledAt: '', disabledBy: '' },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!config) {
      return sendSettlementConflict(res);
    }

    res.json(presentSettlementConfig(config));
  } catch (error) {
    if (error instanceof SettlementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to activate split settlement configuration');
    res.status(500).json({ error: 'Failed to activate split settlement configuration' });
  }
});

router.post('/split-settlement/disable', requireMasterAdmin, async (req, res) => {
  try {
    const revision = parseRevision(req.body?.revision);
    const db = await getDB();
    const now = new Date();
    const config = await db.collection('settlement_configs').findOneAndUpdate(
      { _id: SETTLEMENT_CONFIG_ID, revision, active: { $ne: null }, activeStatus: 'ACTIVE' },
      {
        $set: {
          activeStatus: 'DISABLED',
          disabledAt: now,
          disabledBy: req.user.id,
          updatedAt: now,
          updatedBy: req.user.id,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!config) {
      const existingConfig = await db.collection('settlement_configs').findOne({ _id: SETTLEMENT_CONFIG_ID });
      if (existingConfig && existingConfig.revision === revision) {
        return res.status(400).json({ error: 'There is no active split settlement configuration to disable' });
      }
      return sendSettlementConflict(res);
    }

    res.json(presentSettlementConfig(config));
  } catch (error) {
    if (error instanceof SettlementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to disable split settlement configuration');
    res.status(500).json({ error: 'Failed to disable split settlement configuration' });
  }
});

export default router;
