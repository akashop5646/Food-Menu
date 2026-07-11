import { Router } from 'express';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDB } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';
import { initializeAndProcessSettlementForPaidOrder } from '../services/settlement.js';

const router = Router();

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
  try {
    const { table, location, tableId, locationId, items, total, paymentType, paymentStatus, source, deviceId, customerIp, checkoutSessionId } = req.body;

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

    // Verify items and calculate authoritative total from DB prices
    const verifiedItems = [];
    let calculatedTotal = 0;
    
    for (const item of items) {
      const id = item.id || item._id;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: `Invalid item ID: ${id}` });
      }
      const dbItem = await db.collection('menu_items').findOne({ _id: new ObjectId(id) });
      if (!dbItem) {
        return res.status(400).json({ error: `Menu item not found in database: ${item.name || id}` });
      }
      const quantity = Number(item.quantity);
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ error: `Invalid quantity for item: ${item.name || id}` });
      }
      const verifiedPrice = Number(dbItem.price);
      calculatedTotal += verifiedPrice * quantity;
      
      verifiedItems.push({
        id: dbItem._id,
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

    // Safely normalize malformed stored config to disabled/0
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
      checkoutSessionId: checkoutSessionId || null
    };

    const result = await db.collection('orders').insertOne(newOrder);

    // Clean up any remaining checkout codes for this checkoutSessionId so they don't pile up
    if (checkoutSessionId) {
      await db.collection('checkout_codes').deleteMany({ checkoutSessionId });
    }

    // Broadcast order creation event
    broadcast('ORDER_CREATED', newOrder);

    res.status(201).json(newOrder);
  } catch (error) {
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

export default router;
