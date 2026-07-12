import { Router } from 'express';
import crypto from 'crypto';
import { getDB } from '../db.js';
import { initializeAndProcessSettlementForPaidOrder } from '../services/settlement.js';

const router = Router();

// Durably recover pending / processing / retry pending / reconciliation required settlements
router.post('/settlements/recover', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const expectedSecret = process.env.SETTLEMENT_RECOVERY_SECRET;

    // Fail-closed security rule: ensure secret is set and both have non-zero matching length
    if (
      !expectedSecret ||
      !token ||
      expectedSecret.trim() === '' ||
      token.trim() === '' ||
      Buffer.byteLength(token) !== Buffer.byteLength(expectedSecret)
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(token, 'utf8'),
      Buffer.from(expectedSecret, 'utf8')
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await getDB();
    const now = new Date();

    const unresolvedQuery = {
      paymentStatus: 'PAID',
      'splitSettlement.status': { $in: ['PENDING', 'PROCESSING', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED'] },
      $or: [
        { 'splitSettlement.processingLeaseUntil': null },
        { 'splitSettlement.processingLeaseUntil': { $lte: now } }
      ]
    };

    const orders = await db.collection('orders')
      .find(unresolvedQuery)
      .limit(20)
      .toArray();

    let processedCount = 0;
    let deferredCount = 0;
    let failedCount = 0;

    for (const order of orders) {
      try {
        const result = await initializeAndProcessSettlementForPaidOrder(order._id);
        if (result.processed) {
          if (result.status === 'PROCESSED' || result.status === 'PARTIALLY_PROCESSED' || result.status === 'SKIPPED') {
            processedCount++;
          } else if (result.status === 'FAILED') {
            failedCount++;
          } else {
            deferredCount++;
          }
        } else {
          deferredCount++;
        }
      } catch (err) {
        console.error(`Failed to process recovered settlement for order ${order._id}:`, err.message);
        failedCount++;
      }
    }

    return res.json({
      matched: orders.length,
      processed: processedCount,
      deferred: deferredCount,
      failed: failedCount
    });
  } catch (error) {
    console.error('Failed recovery execution:', error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
