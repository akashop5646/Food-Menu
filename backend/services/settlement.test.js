import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'crypto';
import { setMockDB } from '../db.js';

// Setup Mock DB
class MockCollection {
  constructor() {
    this.docs = [];
  }
  async findOne(query) {
    const doc = this.docs.find(d => this._match(d, query));
    return doc ? structuredClone(doc) : null;
  }
  find(query) {
    const matched = this.docs.filter(d => this._match(d, query));
    const cursor = {
      matched: matched.map(d => structuredClone(d)),
      limit: (n) => {
        cursor.matched = cursor.matched.slice(0, n);
        return cursor;
      },
      toArray: async () => cursor.matched
    };
    return cursor;
  }
  async insertOne(doc) {
    this.docs.push(structuredClone(doc));
    return { insertedId: doc._id };
  }
  _getNested(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }
  async updateOne(query, update) {
    const doc = this.docs.find(d => this._match(d, query));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };

    let modified = false;
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        const oldVal = this._getNested(doc, k);
        if (JSON.stringify(oldVal) !== JSON.stringify(v)) {
          this._setNested(doc, k, v);
          modified = true;
        }
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        const oldVal = this._getNested(doc, k) || 0;
        this._setNested(doc, k, oldVal + v);
        modified = true;
      }
    }
    return { matchedCount: 1, modifiedCount: modified ? 1 : 0 };
  }
  async findOneAndUpdate(query, update, options) {
    const doc = this.docs.find(d => this._match(d, query));
    if (!doc) return null;
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        this._setNested(doc, k, v);
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        const oldVal = this._getNested(doc, k) || 0;
        this._setNested(doc, k, oldVal + v);
      }
    }
    return structuredClone(doc);
  }
  async dropIndex() {
    return {};
  }
  _match(doc, query) {
    for (const [k, v] of Object.entries(query)) {
      if (k === '_id') {
        if (String(doc._id) !== String(v)) return false;
      } else if (k === 'splitSettlement.recipients.transferId') {
        const found = doc.splitSettlement?.recipients?.some(r => r.transferId === v);
        if (!found) return false;
      } else if (k === 'splitSettlement.status') {
        if (v && v.$in) {
          if (!v.$in.includes(doc.splitSettlement?.status)) return false;
        } else if (doc.splitSettlement?.status !== v) {
          return false;
        }
      } else if (k === 'paymentStatus') {
        if (doc.paymentStatus !== v) return false;
      } else if (k === 'splitSettlement.processingClaimToken') {
        if (doc.splitSettlement?.processingClaimToken !== v) return false;
      } else if (k === 'splitSettlement.revision') {
        if (v && typeof v === 'object' && '$exists' in v) {
          const exists = doc.splitSettlement && 'revision' in doc.splitSettlement;
          if (v.$exists !== exists) return false;
        } else {
          if (doc.splitSettlement?.revision !== v) return false;
        }
      } else if (k === '$or') {
        const matchedOr = v.some(subQuery => this._match(doc, subQuery));
        if (!matchedOr) return false;
      } else if (k === 'splitSettlement.processingLeaseUntil') {
        const val = doc.splitSettlement?.processingLeaseUntil;
        if (v === null) {
          if (val !== null && val !== undefined) return false;
        } else if (v && v.$lte) {
          if (!val || new Date(val).getTime() > new Date(v.$lte).getTime()) return false;
        }
      }
    }
    return true;
  }
  _setNested(obj, path, val) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = structuredClone(val);
  }
}

const mockOrders = new MockCollection();
const mockConfigs = new MockCollection();
const mockDb = {
  collection: (name) => {
    if (name === 'orders') return mockOrders;
    if (name === 'settlement_configs') return mockConfigs;
    if (name === 'checkout_codes') return new MockCollection();
    return new MockCollection();
  }
};

// Set mock database immediately before importing any router modules to prevent real DB connection attempts
setMockDB(mockDb);

// Dynamically import routes and controllers
const { allocateExternalAmounts, buildSettlementSnapshot, deriveOverallStatus, syncRouteTransferStatus, initializeAndProcessSettlementForPaidOrder } = await import('./settlement.js');
const paymentsRouter = (await import('../routes/payments.js')).default;
const internalRouter = (await import('../routes/internal.js')).default;

// Mock fetch for Razorpay APIs
let mockFetchResponses = {};
globalThis.fetch = async (url, options) => {
  const method = options?.method || 'GET';
  const key = `${method}:${url}`;
  if (mockFetchResponses[key]) {
    return mockFetchResponses[key]();
  }
  if (url.endsWith('/transfers') && method === 'GET') {
    return { ok: true, json: async () => ({ items: [] }) };
  }
  return { ok: true, json: async () => ({}) };
};

// Helper to generate mock req and res
function mockResponse() {
  const res = {
    status: (code) => { res.statusCode = code; return res; },
    send: (body) => { res.body = body; return res; },
    json: (json) => { res.body = json; return res; },
    statusCode: 200,
    body: null
  };
  return res;
}

const recipients = (allocations) => allocations.map(([id, allocationBasisPoints]) => ({
  id,
  label: id,
  linkedAccountId: `acc_${id}xyz`,
  allocationBasisPoints,
  enabled: true,
}));

const getFreshOrder = () => ({
  _id: 'order123',
  paymentStatus: 'PAID',
  paymentType: 'RAZORPAY',
  razorpayPaymentId: 'pay_123',
  total: '10',
  splitSettlement: {
    razorpayPaymentId: 'pay_123',
    status: 'PROCESSING',
    updatedAt: new Date(1000),
    recipients: [{
      recipientId: 'rec_1',
      linkedAccountId: 'acc_1',
      amountPaise: 500,
      status: 'PROCESSING',
      transferId: 'trf_123'
    }]
  }
});

// Original Phase 1 Allocation Tests (Tests 1-4)
test('allocates external Route amounts deterministically and retains the remainder', () => {
  const allocation = allocateExternalAmounts(100100, recipients([['restaurant', 9500], ['partner', 200]]));
  assert.equal(allocation.targetExternalAmountPaise, 97097);
  assert.equal(allocation.platformRetainedAmountPaise, 3003);
  assert.equal(allocation.allocations.reduce((sum, recipient) => sum + recipient.amountPaise, 0), 97097);
  assert.equal(allocation.targetExternalAmountPaise + allocation.platformRetainedAmountPaise, 100100);
});

test('uses stable recipient IDs to break rounding ties', () => {
  const allocation = allocateExternalAmounts(1001, recipients([['b', 3333], ['a', 3333], ['c', 3334]]));
  const amounts = Object.fromEntries(allocation.allocations.map((recipient) => [recipient.id, recipient.amountPaise]));
  assert.deepEqual(amounts, { b: 333, a: 334, c: 334 });
  assert.equal(allocation.targetExternalAmountPaise, 1001);
});

test('snapshots zero-value recipients without creating a transfer candidate', () => {
  const snapshot = buildSettlementSnapshot(
    { total: 1, razorpayPaymentId: 'pay_test' },
    { version: 1, recipients: recipients([['restaurant', 9500], ['partner', 200]]) }
  );
  assert.equal(snapshot.sourceAmountPaise, 100);
  assert.equal(snapshot.externalTransferAmountPaise + snapshot.platformRetainedAmountPaise, 100);
  assert.equal(snapshot.recipients.find((recipient) => recipient.recipientId === 'partner').status, 'SKIPPED_MINIMUM_AMOUNT');
});

test('keeps the active configuration recipient data immutable after snapshot creation', () => {
  const configuration = { version: 4, recipients: recipients([['restaurant', 9500]]) };
  const snapshot = buildSettlementSnapshot({ total: 100, razorpayPaymentId: 'pay_test' }, configuration);
  configuration.recipients[0].label = 'Changed later';
  configuration.recipients[0].linkedAccountId = 'acc_changed';
  assert.equal(snapshot.configurationVersion, 4);
  assert.equal(snapshot.recipients[0].label, 'restaurant');
  assert.equal(snapshot.recipients[0].linkedAccountId, 'acc_restaurantxyz');
});

// Parent status derivation tests (Tests 5-11)
test('Parent PROCESSED derivation', () => {
  assert.equal(deriveOverallStatus([{ status: 'PROCESSED' }]), 'PROCESSED');
});

test('Parent PARTIALLY_PROCESSED derivation for processed + skipped', () => {
  assert.equal(deriveOverallStatus([{ status: 'PROCESSED' }, { status: 'SKIPPED_ZERO_AMOUNT' }]), 'PARTIALLY_PROCESSED');
});

test('Parent PARTIALLY_PROCESSED derivation for processed + failed', () => {
  assert.equal(deriveOverallStatus([{ status: 'PROCESSED' }, { status: 'FAILED' }]), 'PARTIALLY_PROCESSED');
});

test('Parent SKIPPED derivation', () => {
  assert.equal(deriveOverallStatus([{ status: 'SKIPPED_ZERO_AMOUNT' }]), 'SKIPPED');
});

test('Parent RECONCILIATION_REQUIRED precedence', () => {
  assert.equal(deriveOverallStatus([{ status: 'PROCESSED' }, { status: 'RECONCILIATION_REQUIRED' }]), 'RECONCILIATION_REQUIRED');
});

test('Parent PROCESSING precedence', () => {
  assert.equal(deriveOverallStatus([{ status: 'PENDING' }]), 'PROCESSING');
  assert.equal(deriveOverallStatus([{ status: 'PROCESSING' }]), 'PROCESSING');
});

test('Parent RETRY_PENDING behavior', () => {
  assert.equal(deriveOverallStatus([{ status: 'RETRY_PENDING' }]), 'RETRY_PENDING');
});

// Webhook Sync Tests (Tests 12-25)
test('Valid transfer.processed updates the exact recipient', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, true);
  assert.equal(res.status, 'PROCESSED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'PROCESSED');
});

test('Valid transfer.failed updates the exact recipient safely', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'failed',
    error: { code: 'FAIL_CODE', description: 'Some failure' }
  });
  assert.equal(res.success, true);
  assert.equal(res.status, 'FAILED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'FAILED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].failureCode, 'FAIL_CODE');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].failureDescription, 'Some failure');
});

test('Duplicate processed event is idempotent', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.recipients[0].status = 'PROCESSED';
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, true);
  assert.equal(res.changed, false);
});

test('Duplicate failed event is idempotent', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.recipients[0].status = 'FAILED';
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'failed'
  });
  assert.equal(res.success, true);
  assert.equal(res.changed, false);
});

test('Unknown transfer ID returns false without mutation', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_wrong',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'TRANSFER_NOT_FOUND');
});

test('Matching transfer ID with incorrect amount causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 999,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'AMOUNT_MISMATCH');
});

test('Matching transfer ID with incorrect account causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_wrong',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'ACCOUNT_MISMATCH');
});

test('Matching transfer ID with incorrect currency causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'USD',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'CURRENCY_MISMATCH');
});

test('Incorrect order correlation note causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order_wrong',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'ORDER_NOTE_MISMATCH');
});

test('Incorrect recipient correlation note causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_wrong',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'RECIPIENT_NOTE_MISMATCH');
});

test('Incorrect source payment causes no update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_wrong',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'SOURCE_PAYMENT_MISMATCH');
});

test('PROCESSED followed by transfer.failed shifts status to RECONCILIATION_REQUIRED', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.recipients[0].status = 'PROCESSED';
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'failed',
    error: { code: 'STALE_FAIL', description: 'Stale webhook delivery' }
  });
  assert.equal(res.success, true);
  assert.equal(res.status, 'RECONCILIATION_REQUIRED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'RECONCILIATION_REQUIRED');
});

test('FAILED followed by transfer.processed upgrades to PROCESSED', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.recipients[0].status = 'FAILED';
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });
  assert.equal(res.success, true);
  assert.equal(res.status, 'PROCESSED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'PROCESSED');
});

test('Webhook updates preserve claims, leases, and snapshot values', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.processingClaimToken = 'worker_token';
  mockOrders.docs[0].splitSettlement.processingLeaseUntil = new Date(5000);
  mockOrders.docs[0].splitSettlement.configurationVersion = 99;
  mockOrders.docs[0].splitSettlement.sourceAmountPaise = 1000;

  await syncRouteTransferStatus({
    transferId: 'trf_123',
    recipientAccountId: 'acc_1',
    amount: 500,
    currency: 'INR',
    sourcePaymentId: 'pay_123',
    orderNote: 'order123',
    recipientNote: 'rec_1',
    status: 'processed'
  });

  const ss = mockOrders.docs[0].splitSettlement;
  assert.equal(ss.processingClaimToken, 'worker_token');
  assert.equal(new Date(ss.processingLeaseUntil).getTime(), 5000);
  assert.equal(ss.configurationVersion, 99);
  assert.equal(ss.sourceAmountPaise, 1000);
});

// Route-Level Webhook Tests (Tests 26-30)
test('Webhook raw buffer and signature validation', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
  const paymentsHandler = paymentsRouter.stack.find(layer => layer.route && layer.route.path === '/razorpay/webhook').route.stack[1].handle;

  // 1. Missing signature header
  const req1 = { headers: {}, body: Buffer.from('{}') };
  const res1 = mockResponse();
  await paymentsHandler(req1, res1);
  assert.equal(res1.statusCode, 400);

  // 2. Invalid signature header
  const req2 = { headers: { 'x-razorpay-signature': 'invalid' }, body: Buffer.from('{}') };
  const res2 = mockResponse();
  await paymentsHandler(req2, res2);
  assert.equal(res2.statusCode, 401);
});

test('Webhook handles unsupported event type gracefully', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
  const paymentsHandler = paymentsRouter.stack.find(layer => layer.route && layer.route.path === '/razorpay/webhook').route.stack[1].handle;

  const payload = { event: 'payment.disputed' };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', 'webhook_secret').update(rawBody).digest('hex');

  const req = { headers: { 'x-razorpay-signature': signature }, body: rawBody };
  const res = mockResponse();
  await paymentsHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'OK');
});

test('Webhook handles malformed body gracefully', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
  const paymentsHandler = paymentsRouter.stack.find(layer => layer.route && layer.route.path === '/razorpay/webhook').route.stack[1].handle;

  const rawBody = Buffer.from('malformed json here');
  const signature = crypto.createHmac('sha256', 'webhook_secret').update(rawBody).digest('hex');

  const req = { headers: { 'x-razorpay-signature': signature }, body: rawBody };
  const res = mockResponse();
  await paymentsHandler(req, res);
  assert.equal(res.statusCode, 400);
});

// Recovery worker / Router Tests (Tests 31-41)
test('Recovery endpoint missing configuration fails-closed', async () => {
  delete process.env.SETTLEMENT_RECOVERY_SECRET;
  const internalHandler = internalRouter.stack.find(layer => layer.route && layer.route.path === '/settlements/recover').route.stack[0].handle;

  const req = { headers: { authorization: 'Bearer ' } };
  const res = mockResponse();
  await internalHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('Recovery endpoint rejects empty Bearer token', async () => {
  process.env.SETTLEMENT_RECOVERY_SECRET = 'valid_secret';
  const internalHandler = internalRouter.stack.find(layer => layer.route && layer.route.path === '/settlements/recover').route.stack[0].handle;

  const req = { headers: { authorization: 'Bearer ' } };
  const res = mockResponse();
  await internalHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('Recovery endpoint rejects invalid Bearer token', async () => {
  process.env.SETTLEMENT_RECOVERY_SECRET = 'valid_secret';
  const internalHandler = internalRouter.stack.find(layer => layer.route && layer.route.path === '/settlements/recover').route.stack[0].handle;

  const req = { headers: { authorization: 'Bearer wrong_secret' } };
  const res = mockResponse();
  await internalHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('Recovery endpoint accepts valid Bearer token and returns aggregate count metadata only', async () => {
  process.env.SETTLEMENT_RECOVERY_SECRET = 'valid_secret';
  const internalHandler = internalRouter.stack.find(layer => layer.route && layer.route.path === '/settlements/recover').route.stack[0].handle;

  mockOrders.docs = [];

  const req = { headers: { authorization: 'Bearer valid_secret' } };
  const res = mockResponse();
  await internalHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { matched: 0, processed: 0, deferred: 0, failed: 0 });
});

test('Recovery reconciles existing PROCESSING recipient and prevents double execution', async () => {
  process.env.RAZORPAY_ROUTE_TRANSFERS_ENABLED = 'true';
  process.env.RAZORPAY_KEY_ID = 'key_id';
  process.env.RAZORPAY_KEY_SECRET = 'key_secret';

  mockOrders.docs = [{
    _id: 'order_rec_99',
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY',
    razorpayPaymentId: 'pay_99',
    total: '10',
    splitSettlement: {
      razorpayPaymentId: 'pay_99',
      status: 'PROCESSING',
      processingLeaseUntil: new Date(Date.now() - 1000), // expired
      recipients: [{
        recipientId: 'rec_1',
        linkedAccountId: 'acc_1',
        amountPaise: 500,
        status: 'PROCESSING',
        transferId: 'trf_99'
      }]
    }
  }];

  mockFetchResponses['GET:https://api.razorpay.com/v1/payments/pay_99/transfers'] = () => ({
    ok: true,
    json: async () => ({
      items: [{
        id: 'trf_99',
        recipient: 'acc_1',
        amount: 500,
        status: 'processed',
        transfer_status: 'processed'
      }]
    })
  });

  const res = await initializeAndProcessSettlementForPaidOrder('order_rec_99');
  assert.equal(res.processed, true);
  assert.equal(res.status, 'PROCESSED');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'PROCESSED');
});

test('Recovery does not recreate transfer if transferId is present', async () => {
  process.env.RAZORPAY_ROUTE_TRANSFERS_ENABLED = 'true';
  mockOrders.docs = [{
    _id: 'order_rec_98',
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY',
    razorpayPaymentId: 'pay_98',
    total: '10',
    splitSettlement: {
      razorpayPaymentId: 'pay_98',
      status: 'PROCESSING',
      processingLeaseUntil: new Date(Date.now() - 1000),
      recipients: [{
        recipientId: 'rec_1',
        linkedAccountId: 'acc_1',
        amountPaise: 500,
        status: 'PROCESSING',
        transferId: 'trf_98'
      }]
    }
  }];

  // Remote transfers returns empty list (representing remote lookup failure or ambiguous state)
  mockFetchResponses['GET:https://api.razorpay.com/v1/payments/pay_98/transfers'] = () => ({
    ok: true,
    json: async () => ({ items: [] })
  });

  // Reconcile must skip creating new transfers since transferId is present
  await initializeAndProcessSettlementForPaidOrder('order_rec_98');
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].transferId, 'trf_98'); // preserved
  assert.equal(mockOrders.docs[0].splitSettlement.recipients[0].status, 'PROCESSING'); // not re-created or changed to RETRY_PENDING
});

test('Payment status remains PAID after synchronization or recovery execution', async () => {
  mockOrders.docs = [{
    _id: 'order_pay_paid',
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY',
    razorpayPaymentId: 'pay_paid',
    total: '10',
    splitSettlement: {
      status: 'PENDING',
      recipients: [{
        recipientId: 'rec_1',
        linkedAccountId: 'acc_1',
        amountPaise: 500,
        status: 'PENDING'
      }]
    }
  }];

  // Force remote fetch failure
  mockFetchResponses['GET:https://api.razorpay.com/v1/payments/pay_paid/transfers'] = () => ({
    ok: false,
    status: 500
  });

  try {
    await initializeAndProcessSettlementForPaidOrder('order_pay_paid');
  } catch (err) {
    // Ignore error
  }

  assert.equal(mockOrders.docs[0].paymentStatus, 'PAID'); // remains PAID
});

// Part 4 & 5 Regression Tests
test('transfer.processed with actual Razorpay linked-account field recipient', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1', // actual Razorpay linked-account field
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'PROCESSED');
  const recipient = mockOrders.docs[0].splitSettlement.recipients[0];
  assert.equal(recipient.status, 'PROCESSED');
  assert.equal(recipient.transferStatus, 'processed');
  assert.ok(recipient.processedAt instanceof Date);
  assert.equal(mockOrders.docs[0].splitSettlement.status, 'PROCESSED');
});

test('transfer.failed with actual linked-account field correctly', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'failed',
    error: { code: 'FAIL_TEST_2', description: 'Actual fail description' }
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'FAILED');
  const recipient = mockOrders.docs[0].splitSettlement.recipients[0];
  assert.equal(recipient.status, 'FAILED');
  assert.equal(recipient.transferStatus, 'failed');
  assert.equal(recipient.failureCode, 'FAIL_TEST_2');
  assert.equal(recipient.failureDescription, 'Actual fail description');
});

test('Legacy transfer response shape account is supported', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      account: 'acc_1', // legacy field
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'PROCESSED');
});

test('Missing linked-account fields is rejected safely', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'MISSING_ACCOUNT');
});

test('Incorrect linked-account ID is rejected', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_wrong',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'ACCOUNT_MISMATCH');
});

test('Conflicting linked-account fields is rejected safely', async () => {
  mockOrders.docs = [getFreshOrder()];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      account: 'acc_2', // conflict
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'RECONCILIATION_REQUIRED');
});

test('Express trust proxy configuration is set correctly', async () => {
  process.env.VERCEL = 'true';
  const serverModule = await import('../server.js');
  const app = serverModule.default;
  assert.ok(app.get('trust proxy'));
});

// CAS & Revision Regression Tests
test('matchedCount: 1, modifiedCount: 1 -> success on normal update', async () => {
  mockOrders.docs = [getFreshOrder()];
  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });
  assert.equal(res.success, true);
  assert.equal(res.changed, true);
});

test('matchedCount: 1, modifiedCount: 0 with intended final state already present -> idempotent success', async () => {
  mockOrders.docs = [getFreshOrder()];
  mockOrders.docs[0].splitSettlement.recipients[0].status = 'PROCESSED';

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });
  assert.equal(res.success, true);
  assert.equal(res.changed, false);
});

test('first CAS fails (matchedCount: 0), second succeeds', async () => {
  mockOrders.docs = [getFreshOrder()];

  let callCount = 0;
  const originalUpdateOne = mockOrders.updateOne;
  mockOrders.updateOne = async function (query, update) {
    callCount++;
    if (callCount === 1) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    return originalUpdateOne.call(this, query, update);
  };

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  mockOrders.updateOne = originalUpdateOne;

  assert.equal(res.success, true);
  assert.equal(res.changed, true);
  assert.equal(callCount, 2);
});

test('three genuine CAS misses (matchedCount: 0) -> retryable CONCURRENT_UPDATE_CONFLICT', async () => {
  mockOrders.docs = [getFreshOrder()];

  const originalUpdateOne = mockOrders.updateOne;
  mockOrders.updateOne = async function () {
    return { matchedCount: 0, modifiedCount: 0 };
  };

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  mockOrders.updateOne = originalUpdateOne;

  assert.equal(res.success, false);
  assert.equal(res.retryable, true);
  assert.equal(res.reason, 'CONCURRENT_UPDATE_CONFLICT');
});

test('existing settlement without revision field can update and initializes revision to 1', async () => {
  const fresh = getFreshOrder();
  delete fresh.splitSettlement.revision;
  mockOrders.docs = [fresh];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, true);
  assert.equal(mockOrders.docs[0].splitSettlement.revision, 1);
});

test('settlement revision increments after successful mutation', async () => {
  const fresh = getFreshOrder();
  fresh.splitSettlement.revision = 5;
  mockOrders.docs = [fresh];

  const res = await syncRouteTransferStatus({
    transferId: 'trf_123',
    transfer: {
      id: 'trf_123',
      recipient: 'acc_1',
      amount: 500,
      currency: 'INR',
      source: 'pay_123',
      notes: {
        settlement_order_id: 'order123',
        settlement_recipient_id: 'rec_1'
      }
    },
    status: 'processed'
  });

  assert.equal(res.success, true);
  assert.equal(mockOrders.docs[0].splitSettlement.revision, 6);
});
