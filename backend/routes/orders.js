import { Router } from 'express';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDB } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';
import { initializeAndProcessSettlementForPaidOrder } from '../services/settlement.js';
import { recordEmployeeActivity } from '../services/employeeAudit.js';

const router = Router();

const MAX_UNIQUE_ITEMS = 50;
const MAX_ITEM_QUANTITY = 99;
const MAX_TOTAL_QUANTITY = 500;

function getCanonicalFingerprint(userId, payload) {
  const mergedItems = {};
  for (const item of payload.items || []) {
    const id = String(item.id || item._id || '').trim();
    if (id) {
      const quantity = Math.max(0, parseInt(item.quantity, 10) || 0);
      mergedItems[id] = (mergedItems[id] || 0) + quantity;
    }
  }

  const sortedItemIds = Object.keys(mergedItems).sort();
  const canonicalItems = sortedItemIds.map(id => ({
    id,
    quantity: mergedItems[id]
  }));

  const canonicalRequest = {
    userId: String(userId || '').trim(),
    table: payload.table ? String(payload.table).trim() : '',
    tableId: payload.tableId ? String(payload.tableId).trim() : '',
    location: payload.location ? String(payload.location).trim() : '',
    locationId: payload.locationId ? String(payload.locationId).trim() : '',
    paymentType: payload.paymentType ? String(payload.paymentType).trim() : 'LATER',
    paymentStatus: payload.paymentStatus ? String(payload.paymentStatus).trim() : 'PENDING',
    items: canonicalItems
  };

  const sortedKeys = Object.keys(canonicalRequest).sort();
  const sortedObj = {};
  for (const key of sortedKeys) {
    sortedObj[key] = canonicalRequest[key];
  }

  const canonicalString = JSON.stringify(sortedObj);
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

function getAllowlistedResponse(order) {
  if (!order) return null;
  return {
    _id: order._id,
    table: order.table,
    location: order.location,
    tableId: order.tableId,
    locationId: order.locationId,
    items: order.items,
    total: order.total,
    convenienceFee: order.convenienceFee,
    totalPayable: order.totalPayable,
    paymentType: order.paymentType,
    paymentStatus: order.paymentStatus,
    source: order.source,
    status: order.status,
    confirmedBy: order.confirmedBy,
    createdAt: order.createdAt,
    deviceId: order.deviceId,
    customerIp: order.customerIp,
    checkoutSessionId: order.checkoutSessionId,
    version: order.version,
    isUpdated: order.isUpdated,
    updatedAt: order.updatedAt,
    lastAmendedBy: order.lastAmendedBy
  };
}

// Drop TTL index on checkout_codes collection to remove code expiration
(async () => {
  try {
    const db = await getDB();
    await db.collection('checkout_codes').dropIndex('createdAt_1');
    console.log('Successfully dropped TTL index on checkout_codes');
  } catch (err) {
    // If the index doesn't exist, MongoDB returns an IndexNotFound error, which we can ignore
    if (err.codeName !== 'IndexNotFound') {
      console.error('Failed to drop TTL index on checkout_codes:', err);
    }
  }
})();

// Generate a unique 4-digit code for a checkout session (Public endpoint)
router.post('/checkout-code', async (req, res) => {
  try {
    const { table, location, items, total, deviceId, customerIp, checkoutSessionId } = req.body;

    if (!table) return res.status(400).json({ error: 'Table is required.' });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items must be a non-empty array.' });
    }
    if (total === undefined || total === null) {
      return res.status(400).json({ error: 'Total amount is required.' });
    }

    const db = await getDB();

    // If this checkoutSessionId already has an active code, return it
    if (checkoutSessionId) {
      const existing = await db.collection('checkout_codes').findOne({
        checkoutSessionId,
        used: false
      });
      if (existing) {
        return res.json({ code: existing.code });
      }
    }

    // Generate a unique 4-digit code (retry on collision)
    let code;
    let attempts = 0;
    while (attempts < 20) {
      code = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
      const collision = await db.collection('checkout_codes').findOne({ code, used: false });
      if (!collision) break;
      attempts++;
    }

    if (attempts >= 20) {
      return res.status(503).json({ error: 'Could not generate a unique code. Please try again.' });
    }

    const orderId = new ObjectId();

    await db.collection('checkout_codes').insertOne({
      code,
      orderPayload: { _id: orderId, table, location, items, total, deviceId, customerIp, checkoutSessionId },
      checkoutSessionId: checkoutSessionId || null,
      used: false,
      createdAt: new Date()
    });

    res.json({ code, orderId });
  } catch (error) {
    console.error('Failed to generate checkout code:', error);
    res.status(500).json({ error: 'Failed to generate checkout code.' });
  }
});

// Verify a 4-digit code and return the order payload (Waiter/Auth endpoint)
router.post('/verify-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 4) {
      return res.status(400).json({ error: 'A valid 4-digit code is required.' });
    }

    const db = await getDB();
    const entry = await db.collection('checkout_codes').findOne({ code: String(code), used: false });

    if (!entry) {
      return res.status(404).json({ error: 'Invalid or already used code. Please check and try again.' });
    }

    // Delete the verified code document immediately so it doesn't pile up in the database
    await db.collection('checkout_codes').deleteOne({ _id: entry._id });

    res.json({ orderPayload: entry.orderPayload });
  } catch (error) {
    console.error('Failed to verify checkout code:', error);
    res.status(500).json({ error: 'Failed to verify code.' });
  }
});

// Check if table has an active verified order (Public endpoint)
router.get('/active', async (req, res) => {
  try {
    const { table, deviceId, checkoutSessionId } = req.query;
    if (!table) return res.status(400).json({ error: 'Table is required.' });

    // ponytail: extract client IP address to identify customer across page refreshes
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp && clientIp.includes(',')) {
      clientIp = clientIp.split(',')[0].trim();
    }

    // ponytail: query orders from today to show receipt for same-day session
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const db = await getDB();

    // Construct identifying OR query conditions
    const orConditions = [];
    if (deviceId) {
      orConditions.push({ deviceId });
    }
    if (clientIp) {
      orConditions.push({ customerIp: clientIp });
    }
    if (checkoutSessionId) {
      orConditions.push({ checkoutSessionId });
    }

    const query = {
      table: table,
      createdAt: { $gte: todayStart }
    };

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    // Fetch all active/completed orders from today sorted by newest first
    const activeOrders = await db.collection('orders').find(query).sort({ createdAt: -1 }).toArray();

    let targetOrderVerified = false;
    let targetOrder = null;
    if (checkoutSessionId) {
      targetOrder = activeOrders.find(o => o.checkoutSessionId === checkoutSessionId) || null;
      targetOrderVerified = !!targetOrder;
    } else {
      targetOrder = activeOrders[0] || null;
      targetOrderVerified = !!targetOrder;
    }

    res.json({ 
      verified: targetOrderVerified, 
      order: targetOrder,
      orders: activeOrders
    });
  } catch (error) {
    console.error('Failed to check active orders:', error);
    res.status(500).json({ error: 'Failed to check active orders.' });
  }
});

// Create a verified order (called by Waiter scanning page)
router.post('/', requireAuth, async (req, res) => {
  let idempotencyFingerprint = null;
  let idempotencyKey = null;
  const { table, location, tableId, locationId, items, total, paymentType, paymentStatus, source, deviceId, customerIp, checkoutSessionId } = req.body;

  try {
    // Validation checks
    if (!table) return res.status(400).json({ error: 'Table is required.' });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items must be a non-empty array.' });
    }
    if (total === undefined || total === null) {
      return res.status(400).json({ error: 'Total amount is required.' });
    }
    if (paymentStatus !== 'PAID' && paymentStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Invalid payment status (PAID or PENDING required).' });
    }

    const normalizedPaymentType = typeof paymentType === 'string' && paymentType.trim()
      ? paymentType.trim()
      : 'LATER';

    const db = await getDB();

    // 1. Mandatory Manual Idempotency Check & Fingerprinting
    if (source === 'MANUAL') {
      idempotencyKey = req.headers && req.headers['idempotency-key'];
      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        return res.status(400).json({ error: 'Idempotency-Key header is required for manual orders.' });
      }

      const validKeyRegex = /^[a-zA-Z0-9-]{16,64}$/;
      if (!validKeyRegex.test(idempotencyKey)) {
        return res.status(400).json({ error: 'Invalid Idempotency-Key format. Must be UUID or alphanumeric between 16 and 64 characters.' });
      }

      idempotencyFingerprint = getCanonicalFingerprint(req.user.id, {
        table,
        tableId,
        location,
        locationId,
        paymentType: normalizedPaymentType,
        paymentStatus,
        items
      });

      const existing = await db.collection('orders').findOne({ idempotencyKey });
      if (existing) {
        if (existing.idempotencyFingerprint === idempotencyFingerprint) {
          return res.status(201).json({
            ...getAllowlistedResponse(existing),
            duplicate: true
          });
        } else {
          return res.status(409).json({ error: 'Idempotency conflict: An order with this key already exists with different details.' });
        }
      }
    }

    // 2. Scanned Orders Idempotency Check
    if (source !== 'MANUAL' && checkoutSessionId) {
      const existing = await db.collection('orders').findOne({ checkoutSessionId });
      if (existing) {
        return res.status(201).json({
          ...getAllowlistedResponse(existing),
          duplicate: true
        });
      }
    }

    // 3. Validation Bounds on Items
    const itemMap = {};
    for (const item of items) {
      const id = item.id || item._id;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: `Invalid item ID: ${id}` });
      }
      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
        return res.status(400).json({ error: `Invalid quantity for item: ${item.name || id}` });
      }
      if (qty > MAX_ITEM_QUANTITY) {
        return res.status(400).json({ error: `Quantity for item exceeds the maximum limit of ${MAX_ITEM_QUANTITY}.` });
      }
      const stringId = String(id);
      itemMap[stringId] = (itemMap[stringId] || 0) + qty;
    }

    const uniqueItemIds = Object.keys(itemMap);
    if (uniqueItemIds.length > MAX_UNIQUE_ITEMS) {
      return res.status(400).json({ error: `Order exceeds the maximum limit of ${MAX_UNIQUE_ITEMS} unique items.` });
    }

    const totalQuantity = Object.values(itemMap).reduce((sum, q) => sum + q, 0);
    if (totalQuantity > MAX_TOTAL_QUANTITY) {
      return res.status(400).json({ error: `Total order quantity exceeds the maximum limit of ${MAX_TOTAL_QUANTITY} items.` });
    }

    // 4. Fetch menu items and build the canonical items list using DB values
    const dbItems = await db.collection('menu_items').find({
      _id: { $in: uniqueItemIds.map(id => new ObjectId(id)) }
    }).toArray();

    if (dbItems.length !== uniqueItemIds.length) {
      return res.status(400).json({ error: 'One or more menu items not found in database.' });
    }

    const verifiedItems = [];
    let calculatedTotal = 0;

    for (const dbItem of dbItems) {
      const stringId = dbItem._id.toString();
      const quantity = itemMap[stringId];

      if (dbItem.available === false) {
        return res.status(400).json({ error: `Menu item is currently unavailable: ${dbItem.name}` });
      }
      if (dbItem.deleted === true) {
        return res.status(400).json({ error: `Menu item was deleted: ${dbItem.name}` });
      }

      const verifiedPrice = Number(dbItem.price);
      calculatedTotal += verifiedPrice * quantity;

      verifiedItems.push({
        id: dbItem._id, // MongoDB ObjectId object
        name: dbItem.name,
        price: verifiedPrice,
        quantity: quantity
      });
    }

    // Fetch convenience fee configuration
    const feeConfigs = await db.collection('configs').find({
      key: { $in: ['convenience_fee_enabled', 'convenience_fee_amount'] }
    }).toArray();

    let feeEnabled = false;
    let feeAmount = 0;
    let feeAmountValid = false;

    feeConfigs.forEach(c => {
      if (c.key === 'convenience_fee_enabled') {
        feeEnabled = typeof c.value === 'boolean' ? c.value : c.value === 'true';
      }
      if (c.key === 'convenience_fee_amount') {
        const val = Number(c.value);
        if (Number.isFinite(val) && val >= 0 && val <= 20) {
          feeAmount = val;
          feeAmountValid = true;
        }
      }
    });

    if (feeEnabled && !feeAmountValid) {
      feeEnabled = false;
      feeAmount = 0;
    }

    const convenienceFee = feeEnabled ? feeAmount : 0;
    const totalPayable = Number((calculatedTotal + convenienceFee).toFixed(2));

    const orderIdVal = req.body._id;
    const newOrder = {
      _id: orderIdVal && ObjectId.isValid(orderIdVal) ? new ObjectId(orderIdVal) : new ObjectId(),
      table,
      location: location || null,
      tableId: tableId || null,
      locationId: locationId || null,
      items: verifiedItems,
      total: Number(calculatedTotal.toFixed(2)),
      convenienceFee: Number(convenienceFee),
      totalPayable: Number(totalPayable),
      paymentType: normalizedPaymentType,
      paymentStatus,
      source: source || 'QR',
      status: 'NEW',
      statusUpdatedAt: new Date(),
      confirmedBy: req.user.name || req.user.email,
      createdAt: new Date(),
      deviceId: deviceId || null,
      customerIp: customerIp || null,
      checkoutSessionId: checkoutSessionId || null,
      version: 1
    };

    if (source === 'MANUAL') {
      newOrder.idempotencyKey = idempotencyKey;
      newOrder.idempotencyFingerprint = idempotencyFingerprint;
    }

    const result = await db.collection('orders').insertOne(newOrder);

    // Clean up any remaining checkout codes for this checkoutSessionId so they don't pile up
    if (checkoutSessionId) {
      await db.collection('checkout_codes').deleteMany({ checkoutSessionId });
    }

    // Broadcast order creation event
    broadcast('ORDER_CREATED', getAllowlistedResponse(newOrder));

    res.status(201).json(getAllowlistedResponse(newOrder));

    // Record employee activity post-response/mutation
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'ORDER_CREATED',
      {
        type: 'ORDER',
        id: result.insertedId.toString(),
        displayLabel: `Order created for Table ${newOrder.table}`
      },
      {
        total: newOrder.total,
        itemsCount: newOrder.items.length
      }
    );
  } catch (error) {
    if (error.code === 11000) {
      const isIdempotencyConflict = error.keyPattern && error.keyPattern.idempotencyKey;
      const isSessionConflict = error.keyPattern && error.keyPattern.checkoutSessionId;

      if (isIdempotencyConflict && idempotencyKey) {
        const existing = await db.collection('orders').findOne({ idempotencyKey });
        if (existing) {
          if (existing.idempotencyFingerprint === idempotencyFingerprint) {
            return res.status(201).json({
              ...getAllowlistedResponse(existing),
              duplicate: true
            });
          } else {
            return res.status(409).json({ error: 'Idempotency conflict: An order with this key already exists with different details.' });
          }
        }
      }

      if (isSessionConflict && checkoutSessionId) {
        const existing = await db.collection('orders').findOne({ checkoutSessionId });
        if (existing) {
          return res.status(201).json({
            ...getAllowlistedResponse(existing),
            duplicate: true
          });
        }
      }
    }

    console.error('Failed to create order:', error);
    res.status(500).json({ error: 'Failed to confirm order.' });
  }
});

// Fetch orders (supports active=true filter for Live KDS)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { active } = req.query;
    const db = await getDB();
    
    let query = {};
    if (active === 'true') {
      // Active orders shown in KDS columns
      query.status = { $in: ['NEW', 'PREPARING', 'READY'] };
    }

    const orders = await db.collection('orders')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json(orders);
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// Advance order KDS status (NEW -> PREPARING -> READY -> COMPLETED)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['NEW', 'PREPARING', 'READY', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid KDS status.' });
    }

    const db = await getDB();
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, statusUpdatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Broadcast status change
    broadcast('ORDER_STATUS_CHANGED', { id, status });

    res.json({ success: true, id, status });

    // Record employee activity
    await recordEmployeeActivity(
      {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'ADMIN'
      },
      'ORDER_STATUS_CHANGED',
      {
        type: 'ORDER',
        id: id,
        displayLabel: `Order status advanced to ${status}`
      },
      { toStatus: status }
    );
  } catch (error) {
    console.error('Failed to update KDS status:', error);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// Manually verify payment (PENDING -> PAID)
router.patch('/:id/payment', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    if (paymentStatus !== 'PAID') {
      return res.status(400).json({ error: 'Invalid payment status change.' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Idempotency: if already paid, return success but don't broadcast
    if (order.paymentStatus === 'PAID') {
      return res.json({ success: true, id, paymentStatus: 'PAID', alreadyPaid: true });
    }

    const result = await db.collection('orders').updateOne(
      { 
        _id: new ObjectId(id),
        paymentStatus: { $ne: 'PAID' }
      },
      { 
        $set: { 
          paymentStatus: 'PAID',
          paymentVerifiedBy: 'ADMIN',
          manuallyVerifiedAt: new Date()
        } 
      }
    );

    if (result.modifiedCount > 0) {
      // Broadcast payment update
      broadcast('PAYMENT_UPDATED', { 
        _id: id, 
        id, 
        paymentStatus: 'PAID',
        table: order.table
      });
      // Record employee activity
      await recordEmployeeActivity(
        {
          userId: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role || 'ADMIN'
        },
        'ORDER_PAYMENT_VERIFIED',
        {
          type: 'ORDER',
          id: id,
          displayLabel: `Order payment manually verified for Table ${order.table}`
        },
        { paymentStatus: 'PAID' }
      );
    }

    res.json({ success: true, id, paymentStatus: 'PAID' });
  } catch (error) {
    console.error('Failed to update payment status:', error);
    res.status(500).json({ error: 'Failed to update payment status.' });
  }
});

// Create a Razorpay Order (Public/Customer endpoint)
router.post('/razorpay-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId || !ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: 'Valid internal orderId is required' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.paymentStatus === 'PAID') {
      return res.status(400).json({ error: 'Order has already been paid' });
    }

    const amount = order.totalPayable ?? order.total;
    if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({ error: 'Razorpay keys not configured' });
    }

    // ponytail: use standard library fetch to avoid extra dependencies
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify({
        amount: Math.round(Number(amount) * 100), // convert to paise
        currency: 'INR',
        receipt: `ord_${orderId}`
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.description || 'Razorpay order creation failed' });
    }

    // Save the razorpayOrderId on the order document in MongoDB
    await db.collection('orders').updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { razorpayOrderId: data.id } }
    );

    res.json(data);
  } catch (error) {
    console.error('Failed to create Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// Verify payment signature and update order (Public/Customer endpoint)
// Fetch payment details from Razorpay API
async function fetchRazorpayPaymentDetails(paymentId) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured');
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch payment details from Razorpay: ${response.statusText}`);
  }
  return await response.json();
}

// Shared payment reconciliation helper
export async function reconcileSuccessfulRazorpayPayment({
  razorpayOrderId,
  razorpayPaymentId,
  amount,
  currency,
  paidAt,
  source
}) {
  if (!razorpayOrderId || !razorpayPaymentId) {
    return { success: false, reason: 'INVALID_IDENTIFIERS' };
  }

  const db = await getDB();

  // Find order by razorpayOrderId
  const order = await db.collection('orders').findOne({ razorpayOrderId });
  if (!order) {
    console.warn(`⚠️ Razorpay reconciliation warning: No local order found with razorpayOrderId=${razorpayOrderId}`);
    return { success: false, reason: 'ORDER_NOT_FOUND' };
  }

  // Calculate authoritative expected amount in paise
  const expectedAmountInPaise = Math.round(
    Number(order.totalPayable ?? order.total) * 100
  );

  // Validate amount and currency
  if (Number(amount) !== expectedAmountInPaise) {
    console.warn(`⚠️ Razorpay reconciliation warning: Amount mismatch. Expected ${expectedAmountInPaise} paise, got ${amount} paise for razorpayOrderId=${razorpayOrderId}`);
    return { success: false, reason: 'AMOUNT_MISMATCH' };
  }
  if (String(currency).toUpperCase() !== 'INR') {
    console.warn(`⚠️ Razorpay reconciliation warning: Currency mismatch. Expected INR, got ${currency} for razorpayOrderId=${razorpayOrderId}`);
    return { success: false, reason: 'CURRENCY_MISMATCH' };
  }

  // Idempotency: check if already PAID
  if (order.paymentStatus === 'PAID') {
    return {
      success: true,
      changed: false,
      alreadyPaid: true,
      order
    };
  }

  // Never allow one Razorpay payment ID to be attached to multiple internal orders
  const duplicatePayment = await db.collection('orders').findOne({
    razorpayPaymentId,
    _id: { $ne: order._id }
  });
  if (duplicatePayment) {
    console.warn(`⚠️ Razorpay reconciliation warning: Duplicate payment ID ${razorpayPaymentId} already used for another order`);
    return { success: false, reason: 'DUPLICATE_PAYMENT_ID' };
  }

  // Atomic update to PAID to prevent race conditions
  const result = await db.collection('orders').findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: { $ne: 'PAID' }
    },
    {
      $set: {
        paymentStatus: 'PAID',
        paymentType: 'RAZORPAY',
        razorpayPaymentId,
        paidAt: paidAt || new Date(),
        paymentUpdatedAt: new Date(),
        paymentVerifiedBy: source // 'WEBHOOK' or 'FRONTEND'
      }
    },
    {
      returnDocument: 'after'
    }
  );

  if (!result) {
    // In case of a race where it became PAID concurrently, fetch and return the order
    const updatedOrder = await db.collection('orders').findOne({ _id: order._id });
    return {
      success: true,
      changed: false,
      alreadyPaid: true,
      order: updatedOrder
    };
  }

  const updatedOrder = result;

  // Broadcast payment update
  broadcast('PAYMENT_UPDATED', {
    _id: updatedOrder._id.toString(),
    id: updatedOrder._id.toString(),
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY',
    razorpayOrderId: updatedOrder.razorpayOrderId,
    razorpayPaymentId: updatedOrder.razorpayPaymentId,
    paidAt: updatedOrder.paidAt,
    table: updatedOrder.table
  });

  // Settlement is independent from payment confirmation. It must never make a captured payment appear to fail.
  initializeAndProcessSettlementForPaidOrder(updatedOrder._id).catch(() => {
    console.error('Failed to initialize split settlement for a paid order');
  });

  return {
    success: true,
    changed: true,
    alreadyPaid: false,
    order: updatedOrder
  };
}

// Verify payment signature and update order (Public/Customer endpoint)
router.post('/:id/verify-payment', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Valid internal order ID is required' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (
      typeof razorpay_order_id !== 'string' || !razorpay_order_id.trim() ||
      typeof razorpay_payment_id !== 'string' || !razorpay_payment_id.trim() ||
      typeof razorpay_signature !== 'string' || !razorpay_signature.trim()
    ) {
      return res.status(400).json({ error: 'Invalid or missing Razorpay payment details' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ error: 'Razorpay secret key not configured' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Cryptographically verify checkout signature using keySecret
    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    const bufGen = Buffer.from(generatedSignature, 'hex');
    const bufSig = Buffer.from(razorpay_signature, 'hex');

    if (bufGen.length !== bufSig.length || !crypto.timingSafeEqual(bufGen, bufSig)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Fetch authoritative payment details from Razorpay API
    let paymentDetails;
    try {
      paymentDetails = await fetchRazorpayPaymentDetails(razorpay_payment_id);
    } catch (fetchErr) {
      console.error('Failed to fetch Razorpay payment details during verification:', fetchErr.message);
      return res.status(400).json({ error: 'Failed to verify payment details with payment gateway' });
    }

    // Call the shared payment reconciliation helper
    const result = await reconcileSuccessfulRazorpayPayment({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: paymentDetails.amount,
      currency: paymentDetails.currency,
      paidAt: paymentDetails.created_at ? new Date(paymentDetails.created_at * 1000) : new Date(),
      source: 'FRONTEND'
    });

    if (!result.success) {
      return res.status(400).json({ error: `Reconciliation failed: ${result.reason}` });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to verify payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Amend an active unpaid order (KDS editing endpoint)
router.patch('/:id/amend', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason, version, tableId, locationId, items } = req.body;

  try {
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Valid order ID is required.' });
    }

    // 1. Normalize reason: trim, 5-500 characters, reject whitespace-only
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!normalizedReason || normalizedReason.length < 5 || normalizedReason.length > 500) {
      return res.status(400).json({ error: 'Amendment reason must be between 5 and 500 characters long.' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // 2. State locks: PAID, COMPLETED, splitSettlement present (except SKIPPED)
    if (order.paymentStatus === 'PAID') {
      return res.status(400).json({ error: 'Paid orders cannot be amended.' });
    }
    if (order.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Completed orders cannot be amended.' });
    }
    if (order.splitSettlement && order.splitSettlement.status !== 'SKIPPED') {
      return res.status(400).json({ error: 'Settlement-linked orders cannot be amended.' });
    }

    // 3. Optimistic Concurrency loaded version verification (supporting physically absent legacy versions)
    const loadedVersion = Number(version);
    if (isNaN(loadedVersion) || loadedVersion <= 0) {
      return res.status(400).json({ error: 'A valid loaded version is required.' });
    }

    const dbVersion = Number(order.version || 1);
    if (loadedVersion !== dbVersion) {
      return res.status(409).json({ error: 'Concurrency conflict: The order has been updated by another terminal. Please reload.' });
    }

    // 4. Resolve Table and Location authoritatively from database records
    let targetTableName = order.table;
    let targetLocationName = order.location;
    let targetTableId = order.tableId ? new ObjectId(order.tableId) : null;
    let targetLocationId = order.locationId ? new ObjectId(order.locationId) : null;

    if (tableId) {
      if (!ObjectId.isValid(tableId)) {
        return res.status(400).json({ error: 'Invalid Table ID format.' });
      }
      const dbTable = await db.collection('tables').findOne({ _id: new ObjectId(tableId) });
      if (!dbTable) {
        return res.status(400).json({ error: 'Invalid or non-existent Table.' });
      }
      targetTableId = dbTable._id;
      targetTableName = dbTable.name || `Table ${dbTable.number}`;

      // Automatically sync location from table
      if (dbTable.locationId) {
        targetLocationId = new ObjectId(dbTable.locationId);
        targetLocationName = dbTable.location;
      } else if (dbTable.location) {
        const dbLocation = await db.collection('locations').findOne({ name: dbTable.location });
        if (dbLocation) {
          targetLocationId = dbLocation._id;
          targetLocationName = dbLocation.name;
        } else {
          targetLocationId = null;
          targetLocationName = dbTable.location;
        }
      }
    }

    if (locationId) {
      if (!ObjectId.isValid(locationId)) {
        return res.status(400).json({ error: 'Invalid Location ID format.' });
      }
      const dbLocation = await db.collection('locations').findOne({ _id: new ObjectId(locationId) });
      if (!dbLocation) {
        return res.status(400).json({ error: 'Invalid or non-existent Location.' });
      }
      targetLocationId = dbLocation._id;
      targetLocationName = dbLocation.name;
    }

    // 5. Items validation
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be a valid array.' });
    }

    const itemMap = {};
    for (const item of items) {
      const itemId = item.id || item._id;
      if (!itemId || !ObjectId.isValid(itemId)) {
        return res.status(400).json({ error: `Invalid item ID: ${itemId}` });
      }
      const qty = Number(item.quantity);
      if (isNaN(qty) || qty < 0 || !Number.isInteger(qty)) {
        return res.status(400).json({ error: `Invalid quantity for item: ${item.name || itemId}` });
      }
      if (qty > MAX_ITEM_QUANTITY) {
        return res.status(400).json({ error: `Quantity for item exceeds the maximum limit of ${MAX_ITEM_QUANTITY}.` });
      }
      const stringId = String(itemId);
      itemMap[stringId] = (itemMap[stringId] || 0) + qty;
    }

    const uniqueItemIds = Object.keys(itemMap).filter(id => itemMap[id] > 0);
    if (uniqueItemIds.length === 0) {
      return res.status(400).json({ error: 'Amended order must contain at least one item.' });
    }
    if (uniqueItemIds.length > MAX_UNIQUE_ITEMS) {
      return res.status(400).json({ error: `Order exceeds the maximum limit of ${MAX_UNIQUE_ITEMS} unique items.` });
    }

    const totalQuantity = Object.values(itemMap).reduce((sum, q) => sum + q, 0);
    if (totalQuantity > MAX_TOTAL_QUANTITY) {
      return res.status(400).json({ error: `Total order quantity exceeds the maximum limit of ${MAX_TOTAL_QUANTITY} items.` });
    }

    const dbItems = await db.collection('menu_items').find({
      _id: { $in: uniqueItemIds.map(id => new ObjectId(id)) }
    }).toArray();

    if (dbItems.length !== uniqueItemIds.length) {
      return res.status(400).json({ error: 'One or more menu items not found in database.' });
    }

    const verifiedItems = [];
    let calculatedTotal = 0;

    for (const dbItem of dbItems) {
      const stringId = dbItem._id.toString();
      const qty = itemMap[stringId];
      const previousItem = order.items.find(i => String(i.id || i._id || '') === stringId);

      // Gating Rules for Unavailable/Deleted Items
      if (dbItem.available === false || dbItem.deleted === true) {
        if (!previousItem) {
          return res.status(400).json({ error: `Cannot add new unavailable item: ${dbItem.name}` });
        }
        if (qty > previousItem.quantity) {
          return res.status(400).json({ error: `Cannot increase quantity of unavailable item: ${dbItem.name}` });
        }
      }

      const verifiedPrice = Number(dbItem.price);
      calculatedTotal += verifiedPrice * qty;

      verifiedItems.push({
        id: dbItem._id,
        name: dbItem.name,
        price: verifiedPrice,
        quantity: qty
      });
    }

    // 6. Reject no-op amendments
    const tableIdMatches = String(targetTableId || '') === String(order.tableId || '');
    const locationIdMatches = String(targetLocationId || '') === String(order.locationId || '');
    const itemsMatches = order.items.length === verifiedItems.length &&
      order.items.every(oldItem => {
        const newItem = verifiedItems.find(n => String(n.id) === String(oldItem.id));
        return newItem && newItem.quantity === oldItem.quantity;
      });

    if (tableIdMatches && locationIdMatches && itemsMatches && targetTableName === order.table && targetLocationName === order.location) {
      return res.status(400).json({ error: 'No changes detected. The amendment matches the current order state.' });
    }

    // 7. Calculate structured diff (added, removed, modified) preserving item detail info
    const added = [];
    const removed = [];
    const modified = [];

    for (const newItem of verifiedItems) {
      const oldItem = order.items.find(i => String(i.id) === String(newItem.id));
      if (!oldItem) {
        added.push({ id: newItem.id, name: newItem.name, price: newItem.price, quantity: newItem.quantity });
      } else if (newItem.quantity !== oldItem.quantity) {
        modified.push({
          id: newItem.id,
          name: newItem.name,
          price: newItem.price,
          prevQuantity: oldItem.quantity,
          newQuantity: newItem.quantity
        });
      }
    }

    for (const oldItem of order.items) {
      const newItem = verifiedItems.find(n => String(n.id) === String(oldItem.id));
      if (!newItem) {
        removed.push({ id: oldItem.id, name: oldItem.name, price: oldItem.price, quantity: oldItem.quantity });
      }
    }

    const diff = { added, removed, modified };

    // Recalculate convenience fee config
    const feeConfigs = await db.collection('configs').find({
      key: { $in: ['convenience_fee_enabled', 'convenience_fee_amount'] }
    }).toArray();

    let feeEnabled = false;
    let feeAmount = 0;
    let feeAmountValid = false;

    feeConfigs.forEach(c => {
      if (c.key === 'convenience_fee_enabled') {
        feeEnabled = typeof c.value === 'boolean' ? c.value : c.value === 'true';
      }
      if (c.key === 'convenience_fee_amount') {
        const val = Number(c.value);
        if (Number.isFinite(val) && val >= 0 && val <= 20) {
          feeAmount = val;
          feeAmountValid = true;
        }
      }
    });

    if (feeEnabled && !feeAmountValid) {
      feeEnabled = false;
      feeAmount = 0;
    }

    const convenienceFee = feeEnabled ? feeAmount : 0;
    const totalPayable = Number((calculatedTotal + convenienceFee).toFixed(2));

    // 8. Version updates & fallback recovery
    const newVersion = dbVersion + 1;
    const actor = {
      userId: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role || 'ADMIN'
    };

    const newOrderState = {
      table: targetTableName,
      location: targetLocationName,
      tableId: targetTableId,
      locationId: targetLocationId,
      items: verifiedItems,
      total: Number(calculatedTotal.toFixed(2)),
      convenienceFee: Number(convenienceFee),
      totalPayable: Number(totalPayable),
      version: newVersion,
      isUpdated: true,
      updatedAt: new Date(),
      lastAmendedBy: actor
    };

    const revisionDoc = {
      _id: new ObjectId(),
      orderId: order._id,
      newVersion,
      prevVersion: dbVersion,
      actor,
      reason: normalizedReason,
      diff,
      snapshot: newOrderState,
      status: 'PENDING',
      timestamp: new Date()
    };

    // Insert pending revision
    await db.collection('order_revisions').insertOne(revisionDoc);

    // Optimistic Concurrency Update filter matching legacyness
    const updateFilter = dbVersion === 1 ? {
      _id: order._id,
      $or: [
        { version: 1 },
        { version: { $exists: false } }
      ]
    } : {
      _id: order._id,
      version: dbVersion
    };

    const updateResult = await db.collection('orders').updateOne(
      updateFilter,
      {
        $set: {
          table: newOrderState.table,
          location: newOrderState.location,
          tableId: newOrderState.tableId,
          locationId: newOrderState.locationId,
          items: newOrderState.items,
          total: newOrderState.total,
          convenienceFee: newOrderState.convenienceFee,
          totalPayable: newOrderState.totalPayable,
          version: newVersion,
          isUpdated: true,
          updatedAt: newOrderState.updatedAt,
          lastAmendedBy: newOrderState.lastAmendedBy
        }
      }
    );

    if (updateResult.modifiedCount === 1) {
      // Commit the revision status
      await db.collection('order_revisions').updateOne(
        { _id: revisionDoc._id },
        { $set: { status: 'COMMITTED' } }
      );

      const completeOrderDoc = {
        ...order,
        ...newOrderState
      };
      const responseDto = getAllowlistedResponse(completeOrderDoc);

      // WebSocket broadcast - standardized type schema
      broadcast('ORDER_UPDATED', {
        type: 'ORDER_UPDATED',
        orderId: order._id.toString(),
        version: newVersion,
        order: responseDto
      });

      // Employee audit trail - single emission post-persistence
      await recordEmployeeActivity(
        actor,
        'ORDER_AMENDED',
        {
          type: 'ORDER',
          id: order._id.toString(),
          displayLabel: `Order amended for Table ${completeOrderDoc.table} (v${newVersion})`
        },
        {
          reason: normalizedReason,
          prevVersion: dbVersion,
          newVersion
        }
      );

      return res.json(responseDto);
    } else {
      // Rollback revision record
      await db.collection('order_revisions').updateOne(
        { _id: revisionDoc._id },
        { $set: { status: 'FAILED' } }
      );
      return res.status(409).json({ error: 'Concurrency conflict: The order was updated by another terminal. Please reload.' });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Concurrency conflict: The order was updated by another terminal. Please reload.' });
    }
    console.error('Failed to amend order:', error);
    res.status(500).json({ error: 'Failed to amend order.' });
  }
});

// Fetch paginated revision history for an order
router.get('/:id/revisions', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Valid order ID is required.' });
    }

    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page <= 0) page = 1;
    if (isNaN(limit) || limit <= 0) limit = 10;
    if (limit > 100) limit = 100;

    const skip = (page - 1) * limit;

    const query = {
      orderId: new ObjectId(id),
      status: 'COMMITTED'
    };

    const total = await db.collection('order_revisions').countDocuments(query);
    const revisions = await db.collection('order_revisions')
      .find(query)
      .project({ status: 0 }) // Exclude internal status field
      .sort({ newVersion: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      revisions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Failed to fetch revisions:', error);
    res.status(500).json({ error: 'Failed to fetch revisions.' });
  }
});

export default router;
