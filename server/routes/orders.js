import { Router } from 'express';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDB } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';

const router = Router();

// Check if table has an active verified order (Public endpoint)
router.get('/active', async (req, res) => {
  try {
    const { table, deviceId, checkoutSessionId } = req.query;
    if (!table) return res.status(400).json({ error: 'Table is required.' });

    const db = await getDB();
    const query = {
      table: table,
      status: { $in: ['NEW', 'PREPARING', 'READY'] }
    };
    if (deviceId) {
      query.deviceId = deviceId;
    }

    // Fetch all active orders sorted by newest first
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

    const newOrder = {
      table,
      location: location || null,
      tableId: tableId || null,
      locationId: locationId || null,
      items: items.map(item => ({
        id: item.id || item._id,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity)
      })),
      total: Number(total),
      paymentType: normalizedPaymentType,
      paymentStatus,
      source: source || 'QR',
      status: 'NEW',
      confirmedBy: req.user.name || req.user.email,
      createdAt: new Date(),
      deviceId: deviceId || null,
      customerIp: customerIp || null,
      checkoutSessionId: checkoutSessionId || null
    };

    const db = await getDB();
    const result = await db.collection('orders').insertOne(newOrder);
    newOrder._id = result.insertedId;

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
      { $set: { status } }
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
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { paymentStatus: 'PAID' } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Broadcast payment update
    broadcast('PAYMENT_UPDATED', { id, paymentStatus: 'PAID' });

    res.json({ success: true, id, paymentStatus: 'PAID' });
  } catch (error) {
    console.error('Failed to update payment status:', error);
    res.status(500).json({ error: 'Failed to update payment status.' });
  }
});

// Create a Razorpay Order (Public/Customer endpoint)
router.post('/razorpay-order', async (req, res) => {
  try {
    const { amount, orderId } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
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
        receipt: orderId ? `ord_${orderId}` : `rcpt_${Date.now()}`
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.description || 'Razorpay order creation failed' });
    }

    res.json(data);
  } catch (error) {
    console.error('Failed to create Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// Verify payment signature and update order (Public/Customer endpoint)
router.post('/:id/verify-payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ error: 'Razorpay secret key not configured' });
    }

    // Verify signature using crypto
    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const db = await getDB();
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          paymentStatus: 'PAID',
          paymentType: 'RAZORPAY',
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Broadcast payment status change to waiter and KDS
    broadcast('PAYMENT_UPDATED', { id, paymentStatus: 'PAID' });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to verify payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

export default router;
