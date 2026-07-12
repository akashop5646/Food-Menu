import { getDB } from '../db.js';
import { randomUUID } from 'crypto';

const TOTAL_BASIS_POINTS = 10000;
const MINIMUM_TRANSFER_PAISE = 100;
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export function allocateExternalAmounts(sourceAmountPaise, recipients) {
  const enabled = recipients.filter((recipient) => recipient.enabled);
  const externalAllocationBasisPoints = enabled.reduce((total, recipient) => total + recipient.allocationBasisPoints, 0);
  const targetExternalAmountPaise = Math.floor((sourceAmountPaise * externalAllocationBasisPoints) / TOTAL_BASIS_POINTS);
  const allocations = enabled.map((recipient) => {
    const numerator = sourceAmountPaise * recipient.allocationBasisPoints;
    return { ...recipient, amountPaise: Math.floor(numerator / TOTAL_BASIS_POINTS), remainder: numerator % TOTAL_BASIS_POINTS };
  });
  let remainingPaise = targetExternalAmountPaise - allocations.reduce((total, recipient) => total + recipient.amountPaise, 0);
  [...allocations]
    .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))
    .forEach((recipient) => {
      if (remainingPaise > 0) {
        recipient.amountPaise += 1;
        remainingPaise -= 1;
      }
    });
  return {
    externalAllocationBasisPoints,
    targetExternalAmountPaise,
    platformRetainedBasisPoints: TOTAL_BASIS_POINTS - externalAllocationBasisPoints,
    platformRetainedAmountPaise: sourceAmountPaise - targetExternalAmountPaise,
    allocations,
  };
}

export function buildSettlementSnapshot(order, activeConfiguration) {
  const sourceAmountPaise = Math.round(Number(order.total) * 100);
  const allocation = allocateExternalAmounts(sourceAmountPaise, activeConfiguration.recipients);
  const now = new Date();
  return {
    provider: 'RAZORPAY_ROUTE',
    splitBase: 'FOOD_SUBTOTAL',
    configurationVersion: activeConfiguration.version,
    razorpayPaymentId: order.razorpayPaymentId,
    sourceAmountPaise,
    externalAllocationBasisPoints: allocation.externalAllocationBasisPoints,
    platformRetainedBasisPoints: allocation.platformRetainedBasisPoints,
    externalTransferAmountPaise: allocation.targetExternalAmountPaise,
    platformRetainedAmountPaise: allocation.platformRetainedAmountPaise,
    status: 'PENDING',
    recipients: allocation.allocations.map((recipient) => ({
      recipientId: recipient.id,
      label: recipient.label,
      linkedAccountId: recipient.linkedAccountId,
      allocationBasisPoints: recipient.allocationBasisPoints,
      amountPaise: recipient.amountPaise,
      status: recipient.amountPaise === 0 ? 'SKIPPED_ZERO_AMOUNT' : recipient.amountPaise < MINIMUM_TRANSFER_PAISE ? 'SKIPPED_MINIMUM_AMOUNT' : 'PENDING',
      transferId: null,
      transferStatus: null,
      attemptCount: 0,
      lastAttemptAt: null,
      processedAt: null,
      failureCode: recipient.amountPaise > 0 && recipient.amountPaise < MINIMUM_TRANSFER_PAISE ? 'MINIMUM_TRANSFER_AMOUNT' : null,
      failureDescription: recipient.amountPaise > 0 && recipient.amountPaise < MINIMUM_TRANSFER_PAISE ? 'Route transfers require at least 100 paise.' : null,
    })),
    processingStartedAt: null,
    processingLeaseUntil: null,
    processedAt: null,
    lastErrorAt: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function isEligibleOrder(order) {
  return order?.paymentStatus === 'PAID' && order.paymentType === 'RAZORPAY' && Boolean(order.razorpayPaymentId) && Number.isFinite(Number(order.total)) && Number(order.total) > 0;
}

export function deriveOverallStatus(recipients) {
  const actionable = recipients.filter((recipient) => !['SKIPPED_ZERO_AMOUNT', 'SKIPPED_MINIMUM_AMOUNT'].includes(recipient.status));
  const hasSkippedExternalAmount = actionable.length !== recipients.length;
  if (actionable.length === 0) return 'SKIPPED';
  if (actionable.every((recipient) => recipient.status === 'PROCESSED')) return hasSkippedExternalAmount ? 'PARTIALLY_PROCESSED' : 'PROCESSED';
  if (actionable.some((recipient) => recipient.status === 'RECONCILIATION_REQUIRED')) return 'RECONCILIATION_REQUIRED';
  if (actionable.some((recipient) => recipient.status === 'RETRY_PENDING')) return actionable.some((recipient) => recipient.status === 'PROCESSED') ? 'PARTIALLY_PROCESSED' : 'RETRY_PENDING';
  if (actionable.some((recipient) => recipient.status === 'FAILED')) return actionable.some((recipient) => recipient.status === 'PROCESSED') ? 'PARTIALLY_PROCESSED' : 'FAILED';
  return 'PROCESSING';
}

function basicAuthHeaders() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay credentials are not configured');
  return { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` };
}

async function fetchPaymentTransfers(paymentId) {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/transfers`, { headers: basicAuthHeaders() });
  if (!response.ok) throw new Error('Unable to reconcile Razorpay Route transfers');
  const body = await response.json();
  return Array.isArray(body.items) ? body.items : [];
}

async function createPaymentTransfer(paymentId, recipient, orderId) {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/transfers`, {
    method: 'POST',
    headers: { ...basicAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ transfers: [{
      account: recipient.linkedAccountId,
      amount: recipient.amountPaise,
      currency: 'INR',
      notes: { settlement_order_id: String(orderId), settlement_recipient_id: recipient.recipientId },
    }] }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body.error || {};
    return { ok: false, retryable: response.status === 429 || response.status >= 500, code: error.code || `HTTP_${response.status}`, description: 'Route transfer request failed' };
  }
  return { ok: true, transfer: body.items?.[0] };
}

function applyRemoteTransfer(recipient, transfer) {
  recipient.transferId = transfer.id;
  recipient.transferStatus = transfer.status || transfer.transfer_status || null;
  recipient.lastAttemptAt = new Date();
  if (recipient.transferStatus === 'processed') {
    recipient.status = 'PROCESSED';
    recipient.processedAt = new Date();
  } else if (recipient.transferStatus === 'failed') {
    recipient.status = 'FAILED';
    recipient.failureCode = transfer.error?.code || 'RAZORPAY_TRANSFER_FAILED';
    recipient.failureDescription = 'Razorpay Route transfer failed';
  } else {
    recipient.status = 'PROCESSING';
  }
}

async function persistClaimedSettlement(db, orderId, claimToken, settlement) {
  settlement.updatedAt = new Date();
  settlement.revision = (settlement.revision || 0) + 1;
  const result = await db.collection('orders').updateOne(
    { _id: orderId, 'splitSettlement.status': 'PROCESSING', 'splitSettlement.processingClaimToken': claimToken },
    { $set: { splitSettlement: settlement } }
  );
  if (result.matchedCount !== 1) throw new Error('Settlement claim was lost');
}

export async function initializeAndProcessSettlementForPaidOrder(orderId) {
  const db = await getDB();
  let order = await db.collection('orders').findOne({ _id: orderId });
  if (!isEligibleOrder(order)) return { initialized: false, reason: 'NOT_ELIGIBLE' };

  if (!order.splitSettlement) {
    const config = await db.collection('settlement_configs').findOne({ _id: 'razorpay_route_split_settlement' });
    const active = config?.activeStatus === 'ACTIVE' ? config.active : null;
    const snapshot = active?.recipients?.some((recipient) => recipient.enabled)
      ? buildSettlementSnapshot(order, active)
      : { status: 'SKIPPED', reason: active ? 'NO_ENABLED_EXTERNAL_RECIPIENTS' : config?.activeStatus === 'DISABLED' ? 'CONFIGURATION_DISABLED' : 'NO_ACTIVE_CONFIGURATION', revision: 0, createdAt: new Date(), updatedAt: new Date() };
    const result = await db.collection('orders').findOneAndUpdate(
      { _id: order._id, splitSettlement: { $exists: false } },
      { $set: { splitSettlement: snapshot } },
      { returnDocument: 'after' }
    );
    order = result || await db.collection('orders').findOne({ _id: order._id });
  }

  const eligibleStatuses = ['PENDING', 'PROCESSING', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED'];
  if (process.env.RAZORPAY_ROUTE_TRANSFERS_ENABLED !== 'true' || !eligibleStatuses.includes(order.splitSettlement.status)) return { initialized: true, processed: false, order };

  const now = new Date();
  const claimToken = randomUUID();
  const claimed = await db.collection('orders').findOneAndUpdate(
    { _id: order._id, $or: [
      { 'splitSettlement.status': { $in: ['PENDING', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED'] }, $or: [{ 'splitSettlement.processingLeaseUntil': null }, { 'splitSettlement.processingLeaseUntil': { $lte: now } }] },
      { 'splitSettlement.status': 'PROCESSING', 'splitSettlement.processingLeaseUntil': { $lte: now } },
    ] },
    {
      $set: {
        'splitSettlement.status': 'PROCESSING',
        'splitSettlement.processingStartedAt': now,
        'splitSettlement.processingLeaseUntil': new Date(now.getTime() + CLAIM_LEASE_MS),
        'splitSettlement.processingClaimToken': claimToken,
        'splitSettlement.updatedAt': now
      },
      $inc: {
        'splitSettlement.revision': 1
      }
    },
    { returnDocument: 'after' }
  );
  if (!claimed) return { initialized: true, processed: false, reason: 'CLAIM_NOT_ACQUIRED' };

  const settlement = claimed.splitSettlement;
  try {
    const remoteTransfers = await fetchPaymentTransfers(settlement.razorpayPaymentId);
    for (const recipient of settlement.recipients) {
      // 1. Skip terminal states immediately
      if (['PROCESSED', 'FAILED', 'SKIPPED_ZERO_AMOUNT', 'SKIPPED_MINIMUM_AMOUNT'].includes(recipient.status)) {
        continue;
      }

      // 2. If transferId is present, we reconcile by searching remoteTransfers
      if (recipient.transferId) {
        const existing = remoteTransfers.find((transfer) => transfer.id === recipient.transferId);
        if (existing) {
          applyRemoteTransfer(recipient, existing);
          await persistClaimedSettlement(db, order._id, claimToken, settlement);
        }
        continue;
      }

      // 3. If transferId is absent, check if a remote transfer matches to prevent duplicate creation
      const existing = remoteTransfers.find((transfer) =>
        transfer.recipient === recipient.linkedAccountId &&
        transfer.amount === recipient.amountPaise &&
        transfer.notes?.settlement_order_id === String(order._id) &&
        transfer.notes?.settlement_recipient_id === recipient.recipientId
      );
      if (existing) {
        applyRemoteTransfer(recipient, existing);
        await persistClaimedSettlement(db, order._id, claimToken, settlement);
        continue;
      }

      // 4. Only execute new transfer creation if all criteria are satisfied
      // Must be PENDING or RETRY_PENDING to initiate transfer creation
      if (!['PENDING', 'RETRY_PENDING'].includes(recipient.status)) {
        continue;
      }

      // Check feature flag
      if (process.env.RAZORPAY_ROUTE_TRANSFERS_ENABLED !== 'true') {
        continue;
      }

      recipient.attemptCount += 1;
      recipient.lastAttemptAt = new Date();
      recipient.status = 'PROCESSING';
      await persistClaimedSettlement(db, order._id, claimToken, settlement);
      const result = await createPaymentTransfer(settlement.razorpayPaymentId, recipient, order._id);
      if (result.ok && result.transfer) {
        applyRemoteTransfer(recipient, result.transfer);
        await persistClaimedSettlement(db, order._id, claimToken, settlement);
      }
      else if (result.ok) {
        recipient.status = 'RECONCILIATION_REQUIRED';
        recipient.failureCode = 'MISSING_TRANSFER_RESPONSE';
        recipient.failureDescription = 'Route response did not contain a transfer record.';
        await persistClaimedSettlement(db, order._id, claimToken, settlement);
      }
      else {
        recipient.status = result.retryable ? 'RETRY_PENDING' : 'FAILED';
        recipient.failureCode = result.code;
        recipient.failureDescription = result.description;
        await persistClaimedSettlement(db, order._id, claimToken, settlement);
      }
    }
  } catch {
    settlement.recipients.forEach((recipient) => {
      if (['PENDING', 'RETRY_PENDING', 'PROCESSING'].includes(recipient.status) && !recipient.transferId) {
        recipient.status = 'RECONCILIATION_REQUIRED';
        recipient.failureCode = 'RECONCILIATION_UNAVAILABLE';
        recipient.failureDescription = 'Transfer outcome could not be verified safely.';
      }
    });
    settlement.lastErrorAt = new Date();
  }
  settlement.status = deriveOverallStatus(settlement.recipients);
  settlement.processingLeaseUntil = null;
  settlement.processingClaimToken = null;
  settlement.updatedAt = new Date();
  if (settlement.status === 'PROCESSED') settlement.processedAt = new Date();
  await persistClaimedSettlement(db, order._id, claimToken, settlement);
  return { initialized: true, processed: true, status: settlement.status };
}

export function getTransferLinkedAccountId(transfer) {
  if (!transfer) return null;
  const recipient = transfer.recipient;
  const account = transfer.account;
  if (recipient && account && recipient !== account) {
    return { conflict: true };
  }
  const result = recipient || account || null;
  return typeof result === 'string' ? result : null;
}

export async function syncRouteTransferStatus({
  transferId,
  transfer,
  recipientAccountId,
  amount,
  currency,
  sourcePaymentId,
  orderNote,
  recipientNote,
  status,
  error
}) {
  const db = await getDB();
  const maxRetries = 3;
  let attempt = 0;

  // Backward compatibility: map flat parameters to a transfer entity if transfer is not provided
  const resolvedTransfer = transfer || {
    id: transferId,
    recipient: recipientAccountId,
    amount,
    currency,
    source: sourcePaymentId,
    notes: {
      settlement_order_id: orderNote,
      settlement_recipient_id: recipientNote
    }
  };

  while (attempt < maxRetries) {
    attempt++;
    const order = await db.collection('orders').findOne({ 'splitSettlement.recipients.transferId': transferId });
    if (!order) {
      return { success: false, retryable: false, reason: 'TRANSFER_NOT_FOUND' };
    }

    const settlement = order.splitSettlement;
    if (!settlement || !Array.isArray(settlement.recipients)) {
      return { success: false, retryable: false, reason: 'MALFORMED_SETTLEMENT_RECORD' };
    }

    const recipientIndex = settlement.recipients.findIndex((r) => r.transferId === transferId);
    if (recipientIndex === -1) {
      return { success: false, retryable: false, reason: 'RECIPIENT_NOT_FOUND' };
    }
    const recipient = settlement.recipients[recipientIndex];

    const now = new Date();
    let changed = false;

    // Validate account using the helper
    const recipientAccountId = getTransferLinkedAccountId(resolvedTransfer);

    if (recipientAccountId && recipientAccountId.conflict) {
      console.warn('⚠️ Transfer webhook validation failed: reason=CONFLICTING_ACCOUNT_FIELDS');
      return { success: false, retryable: false, reason: 'RECONCILIATION_REQUIRED' };
    }

    const amount = resolvedTransfer.amount;
    const currency = resolvedTransfer.currency;
    const sourcePaymentId = resolvedTransfer.source;
    const orderNote = resolvedTransfer.notes?.settlement_order_id;
    const recipientNote = resolvedTransfer.notes?.settlement_recipient_id;

    // Primary validation check for mismatch
    let validationError = null;

    if (!recipientAccountId) {
      validationError = 'MISSING_ACCOUNT';
    } else if (recipient.linkedAccountId !== recipientAccountId) {
      validationError = 'ACCOUNT_MISMATCH';
    } else if (Number(recipient.amountPaise) !== Number(amount)) {
      validationError = 'AMOUNT_MISMATCH';
    } else if (String(currency).toUpperCase() !== 'INR') {
      validationError = 'CURRENCY_MISMATCH';
    } else if (sourcePaymentId && settlement.razorpayPaymentId && sourcePaymentId !== settlement.razorpayPaymentId) {
      validationError = 'SOURCE_PAYMENT_MISMATCH';
    } else if (orderNote && String(orderNote) !== String(order._id)) {
      validationError = 'ORDER_NOTE_MISMATCH';
    } else if (recipientNote && String(recipientNote) !== String(recipient.recipientId)) {
      validationError = 'RECIPIENT_NOTE_MISMATCH';
    }

    if (validationError) {
      console.warn(`⚠️ Transfer webhook validation failed: reason=${validationError} recipientFieldPresent=${Boolean(resolvedTransfer.recipient)} accountFieldPresent=${Boolean(resolvedTransfer.account)} amountMatches=${Number(recipient.amountPaise) === Number(amount)} currencyMatches=${String(currency).toUpperCase() === 'INR'}`);
      return { success: false, retryable: false, reason: validationError };
    }

    // Idempotency & Out-of-order handling
    if (recipient.status === 'PROCESSED') {
      if (status === 'processed') {
        return { success: true, changed: false, status: 'PROCESSED' };
      }
      // Contradictory event: transition recipient to RECONCILIATION_REQUIRED
      recipient.status = 'RECONCILIATION_REQUIRED';
      recipient.failureCode = 'CONTRADICTORY_STATUS';
      recipient.failureDescription = 'Received failure status update for a transfer marked PROCESSED';
      recipient.lastAttemptAt = now;
      changed = true;
    } else if (recipient.status === 'FAILED') {
      if (status === 'failed') {
        return { success: true, changed: false, status: 'FAILED' };
      }
      // Upgrade from FAILED to PROCESSED
      recipient.status = 'PROCESSED';
      recipient.transferStatus = 'processed';
      recipient.processedAt = now;
      recipient.failureCode = null;
      recipient.failureDescription = null;
      recipient.lastAttemptAt = now;
      changed = true;
    } else {
      // Normal update
      if (status === 'processed') {
        recipient.status = 'PROCESSED';
        recipient.transferStatus = 'processed';
        recipient.processedAt = now;
        recipient.failureCode = null;
        recipient.failureDescription = null;
        recipient.lastAttemptAt = now;
        changed = true;
      } else {
        recipient.status = 'FAILED';
        recipient.transferStatus = 'failed';
        recipient.processedAt = null;
        recipient.failureCode = error?.code ? String(error.code).slice(0, 50) : 'RAZORPAY_TRANSFER_FAILED';
        recipient.failureDescription = error?.description ? String(error.description).slice(0, 200) : 'Razorpay Route transfer failed';
        recipient.lastAttemptAt = now;
        changed = true;
      }
    }

    if (changed) {
      settlement.status = deriveOverallStatus(settlement.recipients);
      if (settlement.status === 'PROCESSED') {
        settlement.processedAt = now;
      }
      settlement.updatedAt = now;

      // Smallest reliable optimistic concurrency guard
      const expectedRevision = settlement.revision || 0;
      settlement.revision = expectedRevision + 1;

      const query = { _id: order._id };
      if (expectedRevision === 0) {
        query.$or = [
          { 'splitSettlement.revision': 0 },
          { 'splitSettlement.revision': { $exists: false } }
        ];
      } else {
        query['splitSettlement.revision'] = expectedRevision;
      }

      // Smallest reliable optimistic concurrency guard
      const result = await db.collection('orders').updateOne(
        query,
        {
          $set: {
            splitSettlement: settlement
          }
        }
      );

      console.log(`settlement webhook CAS: attempt=${attempt} matched=${result.matchedCount} modified=${result.modifiedCount}`);

      if (result.matchedCount !== 1) {
        // CAS conflict. Loop and retry if attempts remain.
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
          continue;
        }
        return { success: false, retryable: true, reason: 'CONCURRENT_UPDATE_CONFLICT' };
      }
    }

    return { success: true, changed, status: recipient.status };
  }

  return { success: false, retryable: true, reason: 'MAX_RETRIES_EXCEEDED' };
}
