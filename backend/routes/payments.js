import express, { Router } from 'express';
import crypto from 'crypto';
import { reconcileSuccessfulRazorpayPayment } from './orders.js';
import { syncRouteTransferStatus } from '../services/settlement.js';

const router = Router();

// Handle Razorpay payment webhook (Public endpoint, called by Razorpay servers)
router.post(
  '/razorpay/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    try {
      const receivedSignature = req.headers['x-razorpay-signature'];
      if (!receivedSignature) {
        console.warn('⚠️ Razorpay webhook received: Missing signature header');
        return res.status(400).send('Bad Request: Missing signature');
      }

      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error('❌ Razorpay webhook error: RAZORPAY_WEBHOOK_SECRET is not configured');
        return res.status(500).send('Internal Server Error: Webhook secret not configured');
      }

      // req.body must be a Buffer parsed by express.raw()
      if (!Buffer.isBuffer(req.body)) {
        console.error('❌ Razorpay webhook error: Request body is not parsed as a raw Buffer');
        return res.status(500).send('Internal Server Error: Invalid body parser configuration');
      }

      // Verify signature using timing-safe comparison
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(req.body);
      const expectedSignature = hmac.digest('hex');

      const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

      const isValid = receivedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

      if (!isValid) {
        console.warn('⚠️ Razorpay webhook received: Invalid signature');
        return res.status(401).send('Unauthorized: Invalid signature');
      }

      // Parse JSON payload from raw body Buffer
      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch (err) {
        console.error('❌ Razorpay webhook error: Failed to parse raw body as JSON:', err.message);
        return res.status(400).send('Bad Request: Invalid JSON');
      }

      const event = payload.event;
      console.log(`🔌 Razorpay webhook received event: ${event}`);

      // Reconcile if the event is payment.captured
      if (event === 'payment.captured') {
        const payment = payload.payload?.payment?.entity;
        if (!payment) {
          console.warn('⚠️ Razorpay webhook received: Missing payment entity in payload');
          return res.status(400).send('Bad Request: Missing payment entity');
        }

        const razorpayOrderId = payment.order_id;
        const razorpayPaymentId = payment.id;
        const amount = payment.amount; // in paise
        const currency = payment.currency;
        const paidAt = payment.created_at ? new Date(payment.created_at * 1000) : new Date();

        if (!razorpayOrderId || !razorpayPaymentId) {
          console.warn('⚠️ Razorpay webhook received: Missing order/payment IDs in payment entity');
          return res.status(400).send('Bad Request: Missing transaction identifiers');
        }

        // Reconcile payment via shared helper
        const result = await reconcileSuccessfulRazorpayPayment({
          razorpayOrderId,
          razorpayPaymentId,
          amount,
          currency,
          paidAt,
          source: 'WEBHOOK'
        });

        if (!result.success) {
          console.error(`❌ Razorpay webhook reconciliation failed: ${result.reason} for razorpayOrderId=${razorpayOrderId}`);
          // Return 200/400 to control webhook retry behavior
          if (result.reason === 'ORDER_NOT_FOUND') {
            return res.status(200).send(`OK: Order not found for razorpayOrderId=${razorpayOrderId}`);
          }
          if (result.reason === 'AMOUNT_MISMATCH' || result.reason === 'CURRENCY_MISMATCH') {
            return res.status(200).send(`OK: Payment details mismatch ignored`);
          }
          return res.status(400).send(`Bad Request: Reconciliation failed - ${result.reason}`);
        }

        if (result.changed) {
          console.log(`✅ Razorpay webhook reconciled payment successfully: localOrderId=${result.order._id}`);
        } else {
          console.log(`ℹ️ Razorpay webhook ignored duplicate payment confirmation: razorpayOrderId=${razorpayOrderId}`);
        }
      } else if (event === 'transfer.processed' || event === 'transfer.failed') {
        const transfer = payload.payload?.transfer?.entity;
        if (!transfer) {
          console.warn(`⚠️ Razorpay webhook received: Missing transfer entity in ${event} payload`);
          return res.status(400).send('Bad Request: Missing transfer entity');
        }

        const transferId = transfer.id;
        if (!transferId) {
          console.warn(`⚠️ Razorpay webhook received: Missing transfer ID in ${event} payload`);
          return res.status(400).send('Bad Request: Missing transfer ID');
        }

        const recipientAccountId = transfer.account;
        const amount = transfer.amount;
        const currency = transfer.currency;
        const sourcePaymentId = transfer.source;
        const orderNote = transfer.notes?.settlement_order_id;
        const recipientNote = transfer.notes?.settlement_recipient_id;

        const syncResult = await syncRouteTransferStatus({
          transferId,
          recipientAccountId,
          amount,
          currency,
          sourcePaymentId,
          orderNote,
          recipientNote,
          status: event === 'transfer.processed' ? 'processed' : 'failed',
          error: transfer.error
        });

        if (!syncResult.success) {
          if (syncResult.retryable) {
            console.warn(`⚠️ Webhook transfer sync retryable error: ${syncResult.reason}. Responding with 503.`);
            return res.status(503).send('Service Unavailable: Temporary synchronization error');
          }
          console.warn(`⚠️ Webhook transfer sync ignored/failed: ${syncResult.reason}`);
          return res.status(200).send(`OK: ${syncResult.reason}`);
        }

        console.log(`✅ Webhook transfer status synced successfully: transferId=${transferId}, status=${syncResult.status}`);
      }

      return res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Razorpay webhook internal handler error:', error);
      return res.status(500).send('Internal Server Error');
    }
  }
);

export default router;
