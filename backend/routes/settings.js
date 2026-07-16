import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDB } from '../db.js';
import { requireAdmin, requireMasterAdmin } from '../middleware/auth.js';
import { recordEmployeeActivity } from '../services/employeeAudit.js';

const router = Router();

const SETTLEMENT_CONFIG_ID = 'razorpay_route_split_settlement';
const MAX_SETTLEMENT_RECIPIENTS = 10;
const TOTAL_BASIS_POINTS = 10000;
const LINKED_ACCOUNT_ID_PATTERN = /^acc_[A-Za-z0-9_]{3,100}$/;
const RECIPIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const SETTLEMENT_RECIPIENT_TYPES = Object.freeze({
  RESTAURANT_OWNER: 'RESTAURANT_OWNER',
  OTHER: 'OTHER'
});

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

  const normalized = recipients.map((recipient) => {
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

    const recipientType = recipient.recipientType || 'OTHER';
    if (!Object.values(SETTLEMENT_RECIPIENT_TYPES).includes(recipientType)) {
      throw new SettlementValidationError('Invalid recipient type');
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

    return { id, label, linkedAccountId, allocationBasisPoints, enabled: recipient.enabled, recipientType };
  });

  const enabledOwnerCount = normalized.filter(
    r => r.enabled && r.recipientType === SETTLEMENT_RECIPIENT_TYPES.RESTAURANT_OWNER
  ).length;
  if (enabledOwnerCount > 1) {
    throw new SettlementValidationError('Only one enabled settlement recipient can be designated as the Restaurant Owner.');
  }

  return normalized;
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

  const enabledOwnerCount = recipients.filter(
    r => r.enabled && r.recipientType === SETTLEMENT_RECIPIENT_TYPES.RESTAURANT_OWNER
  ).length;
  if (enabledOwnerCount !== 1) {
    throw new SettlementValidationError('Select one enabled recipient as the Restaurant Owner before activating the configuration.');
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
      recipients: (config.active.recipients || []).map(r => ({
        ...r,
        recipientType: r.recipientType || 'OTHER'
      })),
      totalBasisPoints: config.active.totalBasisPoints,
      externalAllocationBasisPoints: activeSummary.externalAllocationBasisPoints,
      platformRetainedBasisPoints: activeSummary.platformRetainedBasisPoints,
      activatedAt: config.active.activatedAt,
      activatedBy: config.active.activatedBy,
      disabledAt: config.disabledAt || null,
      disabledBy: config.disabledBy || null,
    } : null,
    draft: {
      recipients: (draft.recipients || []).map(r => ({
        ...r,
        recipientType: r.recipientType || 'OTHER'
      })),
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'STAFF_ACCOUNT_CREATED',
      {
        type: 'STAFF',
        id: result.insertedId.toString(),
        displayLabel: `Staff account created for ${newStaff.name}`
      },
      {
        name: newStaff.name,
        provider: password ? 'EMAIL' : 'GOOGLE'
      }
    );
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'STAFF_ROLE_CHANGED',
      {
        type: 'STAFF',
        id: id,
        displayLabel: `Role of staff member ${targetUser.name} changed to ${role}`
      },
      {
        fromRole: targetUser.role,
        toRole: role
      }
    );
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'STAFF_ACCOUNT_DELETED',
      {
        type: 'STAFF',
        id: id,
        displayLabel: `Staff account for ${targetUser.name} deleted`
      },
      {
        name: targetUser.name
      }
    );
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
      key: { $in: ['convenience_fee_enabled', 'convenience_fee_type', 'convenience_fee_percentage', 'convenience_fee_amount'] }
    }).toArray();

    let enabled = false;
    let type = 'PERCENTAGE';
    let percentage = 0;
    let amount = 0;
    let percentageExists = false;

    configs.forEach(config => {
      if (config.key === 'convenience_fee_enabled') {
        enabled = typeof config.value === 'boolean' ? config.value : config.value === 'true';
      }
      if (config.key === 'convenience_fee_type') {
        type = String(config.value);
      }
      if (config.key === 'convenience_fee_percentage') {
        const val = Number(config.value);
        if (Number.isFinite(val) && val >= 0) {
          percentage = val;
          percentageExists = true;
        }
      }
      if (config.key === 'convenience_fee_amount') {
        const val = Number(config.value);
        if (Number.isFinite(val) && val >= 0) {
          amount = val;
        }
      }
    });

    if (!percentageExists) {
      res.json({ enabled, type: 'FIXED', percentage: 0, amount });
    } else {
      res.json({ enabled, type, percentage });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch convenience fee configuration' });
  }
});

// Update Convenience Fee Configuration (Master Admin only)
router.post('/convenience-fee', requireMasterAdmin, async (req, res) => {
  try {
    const { enabled, type, percentage } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Enabled status must be a boolean' });
    }

    const activeType = type || 'PERCENTAGE';
    if (activeType !== 'PERCENTAGE') {
      return res.status(400).json({ error: 'Invalid convenience fee type' });
    }

    const numPercentage = Number(percentage);
    if (!Number.isFinite(numPercentage) || numPercentage < 0 || numPercentage > 20) {
      return res.status(400).json({ error: 'Convenience fee percentage must be a finite number between 0 and 20' });
    }

    const db = await getDB();
    await db.collection('configs').updateOne(
      { key: 'convenience_fee_enabled' },
      { $set: { value: enabled } },
      { upsert: true }
    );
    await db.collection('configs').updateOne(
      { key: 'convenience_fee_type' },
      { $set: { value: activeType } },
      { upsert: true }
    );
    await db.collection('configs').updateOne(
      { key: 'convenience_fee_percentage' },
      { $set: { value: numPercentage } },
      { upsert: true }
    );

    res.json({ success: true, enabled, type: activeType, percentage: numPercentage });

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'CONVENIENCE_FEE_UPDATED',
      {
        type: 'CONFIGURATION',
        id: 'convenience_fee',
        displayLabel: `Convenience fee updated: ${enabled ? 'enabled' : 'disabled'}, type: ${activeType}, percentage: ${numPercentage}%`
      },
      {
        enabled: enabled,
        type: activeType,
        percentage: numPercentage
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to update convenience fee configuration' });
  }
});

// Helper to mask sensitive identifiers server-side
function maskId(id) {
  if (!id || typeof id !== 'string') return null;
  const parts = id.split('_');
  const prefix = parts.length > 1 ? `${parts[0]}_` : '';
  const actualId = parts.length > 1 ? parts.slice(1).join('_') : id;
  if (actualId.length <= 4) return id;
  const suffixLen = prefix === 'acc_' ? 4 : 3;
  const suffix = actualId.substring(actualId.length - suffixLen);
  return `${prefix}••••••••${suffix}`;
}

// Helper to escape regex metacharacters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 1. Summary Monitoring Endpoint (All-time operational summary)
router.get('/split-settlement/monitoring/summary', requireMasterAdmin, async (req, res) => {
  try {
    const db = await getDB();
    const pipeline = [
      { $match: { paymentStatus: 'PAID', 'splitSettlement.status': { $exists: true } } },
      { $group: { _id: '$splitSettlement.status', count: { $sum: 1 } } }
    ];
    const results = await db.collection('orders').aggregate(pipeline).toArray();

    const summary = {
      total: 0,
      processed: 0,
      processing: 0,
      pending: 0,
      partiallyProcessed: 0,
      retryPending: 0,
      reconciliationRequired: 0,
      failed: 0,
      skipped: 0,
      needsAttention: 0
    };

    let totalCount = 0;
    for (const r of results) {
      const status = r._id;
      const count = r.count;
      totalCount += count;
      if (status === 'PROCESSED') summary.processed = count;
      else if (status === 'PROCESSING') summary.processing = count;
      else if (status === 'PENDING') summary.pending = count;
      else if (status === 'PARTIALLY_PROCESSED') summary.partiallyProcessed = count;
      else if (status === 'RETRY_PENDING') summary.retryPending = count;
      else if (status === 'RECONCILIATION_REQUIRED') summary.reconciliationRequired = count;
      else if (status === 'FAILED') summary.failed = count;
      else if (status === 'SKIPPED') summary.skipped = count;
    }

    summary.total = totalCount;
    summary.needsAttention = (
      summary.reconciliationRequired +
      summary.failed +
      summary.retryPending +
      summary.partiallyProcessed
    );

    res.json({ summary });
  } catch (error) {
    console.error('Failed to get split settlement monitoring summary:', error);
    res.status(500).json({ error: 'Failed to fetch monitoring summary.' });
  }
});

// 2. History Monitoring Endpoint (Paginated, filterable, searchable)
router.get('/split-settlement/monitoring/history', requireMasterAdmin, async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    if (page < 1) page = 1;
    let limit = parseInt(req.query.limit) || 20;
    if (limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const ALLOWED_STATUSES = ['PENDING', 'PROCESSING', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED', 'PROCESSED', 'PARTIALLY_PROCESSED', 'FAILED', 'SKIPPED', 'NEEDS_ATTENTION'];
    const status = req.query.status;
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid settlement status filter.' });
    }

    let fromDate = null;
    let toDate = null;
    if (req.query.from) {
      fromDate = new Date(req.query.from);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: 'Invalid from date parameter.' });
      }
    }
    if (req.query.to) {
      toDate = new Date(req.query.to);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'Invalid to date parameter.' });
      }
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }

    const query = {
      paymentStatus: 'PAID',
      'splitSettlement.status': { $exists: true }
    };
    if (status) {
      if (status === 'NEEDS_ATTENTION') {
        query['splitSettlement.status'] = { $in: ['RECONCILIATION_REQUIRED', 'FAILED', 'RETRY_PENDING', 'PARTIALLY_PROCESSED'] };
      } else {
        query['splitSettlement.status'] = status;
      }
    }
    if (fromDate || toDate) {
      query['splitSettlement.createdAt'] = {};
      if (fromDate) query['splitSettlement.createdAt'].$gte = fromDate;
      if (toDate) query['splitSettlement.createdAt'].$lte = toDate;
    }

    let search = req.query.search;
    if (search && typeof search === 'string') {
      search = search.trim().substring(0, 50);
      if (search.length > 0) {
        const orConditions = [];
        const escaped = escapeRegExp(search);
        const searchRegex = new RegExp(escaped, 'i');
        orConditions.push({ table: searchRegex });
        orConditions.push({ location: searchRegex });

        if (/^[0-9a-fA-F]{24}$/.test(search)) {
          orConditions.push({ _id: new ObjectId(search) });
        }
        query.$or = orConditions;
      }
    }

    const db = await getDB();
    const total = await db.collection('orders').countDocuments(query);
    const skip = (page - 1) * limit;

    const ordersList = await db.collection('orders')
      .find(query)
      .sort({ 'splitSettlement.createdAt': -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const mappedOrders = ordersList.map(order => {
      const recipients = order.splitSettlement?.recipients || [];
      const processedRecipientCount = recipients.filter(r =>
        ['PROCESSED', 'SKIPPED_ZERO_AMOUNT', 'SKIPPED_MINIMUM_AMOUNT'].includes(r.status)
      ).length;

      return {
        orderId: order._id.toString(),
        displayOrderId: order._id.toString().substring(18),
        table: order.table,
        location: order.location || null,
        foodSubtotalPaise: Math.round(Number(order.total) * 100),
        externalTransferAmountPaise: order.splitSettlement?.externalTransferAmountPaise || 0,
        platformRetainedAmountPaise: order.splitSettlement?.platformRetainedAmountPaise || 0,
        status: order.splitSettlement?.status || 'PENDING',
        recipientCount: recipients.length,
        processedRecipientCount,
        createdAt: order.splitSettlement?.createdAt || order.createdAt || null,
        processedAt: order.splitSettlement?.processedAt || null
      };
    });

    res.json({
      orders: mappedOrders,
      pagination: {
        total,
        pages: Math.ceil(total / limit) || 1,
        page,
        limit
      }
    });
  } catch (error) {
    console.error('Failed to get split settlement monitoring history:', error);
    res.status(500).json({ error: 'Failed to fetch monitoring history.' });
  }
});

// 3. Details Monitoring Endpoint (Read-only single settlement details)
router.get('/split-settlement/monitoring/orders/:orderId', requireMasterAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId || !ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: 'Valid order ID is required.' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order || !order.splitSettlement) {
      return res.status(404).json({ error: 'Settlement details not found for this order.' });
    }

    const mapped = {
      order: {
        id: order._id.toString(),
        table: order.table,
        location: order.location || null,
        foodSubtotalPaise: Math.round(Number(order.total) * 100),
        paymentStatus: order.paymentStatus,
        paidAt: order.paidAt || null
      },
      settlement: {
        provider: order.splitSettlement.provider || 'RAZORPAY_ROUTE',
        splitBase: order.splitSettlement.splitBase || 'FOOD_SUBTOTAL',
        configurationVersion: order.splitSettlement.configurationVersion || 0,
        externalAllocationBasisPoints: order.splitSettlement.externalAllocationBasisPoints || 0,
        platformRetainedBasisPoints: order.splitSettlement.platformRetainedBasisPoints || 0,
        externalTransferAmountPaise: order.splitSettlement.externalTransferAmountPaise || 0,
        platformRetainedAmountPaise: order.splitSettlement.platformRetainedAmountPaise || 0,
        status: order.splitSettlement.status || 'PENDING',
        createdAt: order.splitSettlement.createdAt || order.createdAt || null,
        processedAt: order.splitSettlement.processedAt || null,
        razorpayPaymentId: maskId(order.splitSettlement.razorpayPaymentId),
        recipients: (order.splitSettlement.recipients || []).map(r => ({
          label: r.label,
          allocationBasisPoints: r.allocationBasisPoints || 0,
          amountPaise: r.amountPaise || 0,
          status: r.status || 'PENDING',
          transferStatus: r.transferStatus || null,
          attemptCount: r.attemptCount || 0,
          lastAttemptAt: r.lastAttemptAt || null,
          processedAt: r.processedAt || null,
          failureCode: r.failureCode || null,
          failureDescription: r.failureDescription || null,
          linkedAccountId: maskId(r.linkedAccountId),
          transferId: maskId(r.transferId)
        }))
      }
    };

    res.json(mapped);
  } catch (error) {
    console.error('Failed to get split settlement order monitoring details:', error);
    res.status(500).json({ error: 'Failed to fetch monitoring details.' });
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'SETTLEMENT_CONFIGURATION_UPDATED',
      {
        type: 'SETTLEMENT_CONFIG',
        id: SETTLEMENT_CONFIG_ID,
        displayLabel: `Settlement draft saved (version: ${config.version || 0}, revision: ${config.revision || 0})`
      },
      {
        action: 'DRAFT_SAVED',
        version: config.version || 0,
        totalBasisPoints: totalBasisPoints
      }
    );
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'SETTLEMENT_CONFIGURATION_UPDATED',
      {
        type: 'SETTLEMENT_CONFIG',
        id: SETTLEMENT_CONFIG_ID,
        displayLabel: `Settlement configuration activated (version: ${nextVersion})`
      },
      {
        action: 'ACTIVATED',
        version: nextVersion,
        totalBasisPoints: totalBasisPoints
      }
    );
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

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'SETTLEMENT_CONFIGURATION_UPDATED',
      {
        type: 'SETTLEMENT_CONFIG',
        id: SETTLEMENT_CONFIG_ID,
        displayLabel: `Settlement configuration disabled (version: ${config.version || 0})`
      },
      {
        action: 'DISABLED',
        version: config.version || 0,
        totalBasisPoints: config.active?.totalBasisPoints || 0
      }
    );
  } catch (error) {
    if (error instanceof SettlementValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to disable split settlement configuration');
    res.status(500).json({ error: 'Failed to disable split settlement configuration' });
  }
});

// Get Legal & Compliance Settings (Public)
router.get('/legal', async (req, res) => {
  try {
    const db = await getDB();
    const configs = await db.collection('configs').find({
      key: { $in: [
        'legal_effective_date',
        'legal_grievance_officer_name',
        'legal_grievance_officer_email',
        'legal_data_hosting_location',
        'legal_grievance_response_days',
        'legal_policy_version'
      ] }
    }).toArray();

    const result = {
      effectiveDate: '',
      grievanceOfficerName: '',
      grievanceOfficerEmail: '',
      dataHostingLocation: 'India',
      grievanceResponseDays: '',
      policyVersion: 1
    };

    configs.forEach(config => {
      if (config.key === 'legal_effective_date') result.effectiveDate = config.value;
      if (config.key === 'legal_grievance_officer_name') result.grievanceOfficerName = config.value;
      if (config.key === 'legal_grievance_officer_email') result.grievanceOfficerEmail = config.value;
      if (config.key === 'legal_data_hosting_location') result.dataHostingLocation = config.value || 'India';
      if (config.key === 'legal_grievance_response_days') result.grievanceResponseDays = config.value !== '' ? Number(config.value) : '';
      if (config.key === 'legal_policy_version') result.policyVersion = Number(config.value) || 1;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch legal settings' });
  }
});

// Update Legal & Compliance Settings (Master Admin only)
router.post('/legal', requireMasterAdmin, async (req, res) => {
  try {
    const {
      effectiveDate,
      grievanceOfficerName,
      grievanceOfficerEmail,
      dataHostingLocation,
      grievanceResponseDays
    } = req.body;

    // 1. Validate effective date
    if (effectiveDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || isNaN(Date.parse(effectiveDate))) {
        return res.status(400).json({ error: 'Effective date must be in YYYY-MM-DD format.' });
      }
    }

    // 2. Validate email
    if (grievanceOfficerEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(grievanceOfficerEmail)) {
        return res.status(400).json({ error: 'Invalid grievance officer email format.' });
      }
    }

    // 3. Validate hosting location
    if (dataHostingLocation !== undefined && dataHostingLocation !== 'India') {
      return res.status(400).json({ error: 'Data hosting location must be India.' });
    }

    // 4. Validate response days
    let parsedResponseDays = '';
    if (grievanceResponseDays !== undefined && grievanceResponseDays !== null && grievanceResponseDays !== '') {
      const days = Number(grievanceResponseDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        return res.status(400).json({ error: 'Grievance response days must be a positive integer between 1 and 90.' });
      }
      parsedResponseDays = days;
    }

    // 5. Validate Grievance Officer Name conditional requirement
    const hasOtherGrievanceDetails = grievanceOfficerEmail || parsedResponseDays;
    if (hasOtherGrievanceDetails && (!grievanceOfficerName || String(grievanceOfficerName).trim() === '')) {
      return res.status(400).json({ error: 'Grievance officer name is required when other grievance details are provided.' });
    }

    const db = await getDB();

    // 6. Get and increment policy version
    const versionConfig = await db.collection('configs').findOne({ key: 'legal_policy_version' });
    const currentVersion = versionConfig ? Number(versionConfig.value) : 1;
    const nextVersion = currentVersion + 1;

    const updates = [
      { key: 'legal_effective_date', value: effectiveDate || '' },
      { key: 'legal_grievance_officer_name', value: grievanceOfficerName || '' },
      { key: 'legal_grievance_officer_email', value: grievanceOfficerEmail || '' },
      { key: 'legal_data_hosting_location', value: dataHostingLocation || 'India' },
      { key: 'legal_grievance_response_days', value: parsedResponseDays !== '' ? String(parsedResponseDays) : '' },
      { key: 'legal_policy_version', value: String(nextVersion) }
    ];

    for (const update of updates) {
      await db.collection('configs').updateOne(
        { key: update.key },
        { $set: { value: update.value } },
        { upsert: true }
      );
    }

    const actor = {
      userId: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role || 'ADMIN'
    };

    // Record employee activity
    await recordEmployeeActivity(
      actor,
      'LEGAL_SETTINGS_UPDATED',
      {
        type: 'CONFIGURATION',
        id: 'legal_settings',
        displayLabel: 'Legal & Compliance settings updated'
      },
      {
        effectiveDate: effectiveDate || '',
        grievanceOfficerName: grievanceOfficerName || '',
        grievanceOfficerEmail: grievanceOfficerEmail || '',
        dataHostingLocation: dataHostingLocation || 'India',
        grievanceResponseDays: parsedResponseDays !== '' ? Number(parsedResponseDays) : 0
      }
    );

    res.json({
      success: true,
      legal: {
        effectiveDate,
        grievanceOfficerName,
        grievanceOfficerEmail,
        dataHostingLocation: dataHostingLocation || 'India',
        grievanceResponseDays: parsedResponseDays,
        policyVersion: nextVersion
      }
    });
  } catch (error) {
    console.error('Failed to update legal settings:', error);
    res.status(500).json({ error: 'Failed to update legal settings' });
  }
});

export default router;
