import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../websocket.js';

const router = Router();

// Check if table has an active verified order (Public endpoint)
router.get('/active', async (req, res) => {
  try {
    const { table, deviceId } = req.query;
    if (!table) return res.status(400).json({ error: 'Table is required.' });

    const db = await getDB();
    const query = {
      table: table,
      status: { $in: ['NEW', 'PREPARING', 'READY'] }
    };
    if (deviceId) {
      query.deviceId = deviceId;
    }
    const activeOrder = await db.collection('orders').findOne(query);

    res.json({ verified: !!activeOrder, order: activeOrder });
  } catch (error) {
    console.error('Failed to check active order:', error);
    res.status(500).json({ error: 'Failed to check active order.' });
  }
});

// Create a verified order (called by Waiter scanning page)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { table, items, total, paymentType, paymentStatus, deviceId, customerIp } = req.body;

    // Validation checks
    if (!table) return res.status(400).json({ error: 'Table is required.' });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items must be a non-empty array.' });
    }
    if (total === undefined || total === null) {
      return res.status(400).json({ error: 'Total amount is required.' });
    }
    if (paymentType !== 'NOW' && paymentType !== 'LATER') {
      return res.status(400).json({ error: 'Invalid payment type (NOW or LATER required).' });
    }
    if (paymentStatus !== 'PAID' && paymentStatus !== 'PENDING') {
      return res.status(400).json({ error: 'Invalid payment status (PAID or PENDING required).' });
    }

    const newOrder = {
      table,
      items: items.map(item => ({
        id: item.id || item._id,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity)
      })),
      total: Number(total),
      paymentType,
      paymentStatus,
      status: 'NEW',
      confirmedBy: req.user.name || req.user.email,
      createdAt: new Date(),
      deviceId: deviceId || null,
      customerIp: customerIp || null
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

export default router;
