import assert from 'node:assert/strict';
import test from 'node:test';

// Pre-set environment secret before importing any auth/router
process.env.JWT_SECRET = 'test_secret';

import { setMockDB } from '../db.js';

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
      sort: (sorting) => {
        if (sorting && sorting['splitSettlement.createdAt']) {
          cursor.matched.sort((a, b) => {
            const aTime = new Date(a.splitSettlement?.createdAt || 0).getTime();
            const bTime = new Date(b.splitSettlement?.createdAt || 0).getTime();
            if (sorting['splitSettlement.createdAt'] === 1) return aTime - bTime;
            return bTime - aTime;
          });
        }
        return cursor;
      },
      skip: (n) => {
        cursor.matched = cursor.matched.slice(n);
        return cursor;
      },
      limit: (n) => {
        cursor.matched = cursor.matched.slice(0, n);
        return cursor;
      },
      toArray: async () => cursor.matched
    };
    return cursor;
  }
  async countDocuments(query) {
    return this.docs.filter(d => this._match(d, query)).length;
  }
  aggregate(pipeline) {
    const matchStage = pipeline.find(stage => stage.$match);
    const groupStage = pipeline.find(stage => stage.$group);
    let docs = this.docs;
    if (matchStage) {
      docs = docs.filter(d => this._match(d, matchStage.$match));
    }
    let res = [];
    if (groupStage && groupStage.$group._id === '$splitSettlement.status') {
      const counts = {};
      for (const doc of docs) {
        const status = doc.splitSettlement?.status || 'PENDING';
        counts[status] = (counts[status] || 0) + 1;
      }
      res = Object.entries(counts).map(([_id, count]) => ({ _id, count }));
    }
    return {
      toArray: async () => res
    };
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
  _match(doc, query) {
    for (const [k, v] of Object.entries(query)) {
      if (k === '_id') {
        if (String(doc._id) !== String(v)) return false;
      } else if (k === 'paymentStatus') {
        if (doc.paymentStatus !== v) return false;
      } else if (k === 'splitSettlement.status') {
        if (v && v.$exists !== undefined) {
          const exists = doc.splitSettlement && 'status' in doc.splitSettlement;
          if (v.$exists !== exists) return false;
        } else if (v && v.$in) {
          if (!v.$in.includes(doc.splitSettlement?.status)) return false;
        } else if (doc.splitSettlement?.status !== v) {
          return false;
        }
      } else if (k === 'splitSettlement.createdAt') {
        const val = doc.splitSettlement?.createdAt ? new Date(doc.splitSettlement.createdAt).getTime() : 0;
        if (v.$gte && val < new Date(v.$gte).getTime()) return false;
        if (v.$lte && val > new Date(v.$lte).getTime()) return false;
      } else if (k === '$or') {
        const matchedOr = v.some(subQuery => this._match(doc, subQuery));
        if (!matchedOr) return false;
      } else if (k === 'table') {
        if (v instanceof RegExp) {
          if (!v.test(doc.table)) return false;
        } else if (doc.table !== v) {
          return false;
        }
      } else if (k === 'location') {
        if (v instanceof RegExp) {
          if (!v.test(doc.location)) return false;
        } else if (doc.location !== v) {
          return false;
        }
      }
    }
    return true;
  }
}

const mockOrders = new MockCollection();
const mockDb = {
  collection: (name) => {
    if (name === 'orders') return mockOrders;
    return new MockCollection();
  }
};

// Set mock DB immediately
setMockDB(mockDb);

// Dynamically import router
const settingsRouter = (await import('./settings.js')).default;

// Mock Response Helper
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

// Simulates Express route execution chain (middleware + handler)
async function simulateRequest(path, req) {
  const routeLayer = settingsRouter.stack.find(layer => layer.route && layer.route.path === path);
  if (!routeLayer) {
    throw new Error(`Route not found: ${path}`);
  }
  const res = mockResponse();
  
  let currentLayerIndex = 0;
  const next = async (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const nextLayer = routeLayer.route.stack[currentLayerIndex++];
    if (nextLayer) {
      await nextLayer.handle(req, res, next);
    }
  };
  await next();
  return res;
}

// Authentication / Authorization Tests
test('Authorization: Unauthenticated request -> 401', async () => {
  const req = { cookies: {} };
  const res = await simulateRequest('/split-settlement/monitoring/summary', req);
  assert.equal(res.statusCode, 401);
});

test('Authorization: STAFF -> 403', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'STAFF' }, 'test_secret');
  const req = { cookies: { token } };
  const res = await simulateRequest('/split-settlement/monitoring/summary', req);
  assert.equal(res.statusCode, 403);
});

test('Authorization: ADMIN -> 403', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'ADMIN' }, 'test_secret');
  const req = { cookies: { token } };
  const res = await simulateRequest('/split-settlement/monitoring/summary', req);
  assert.equal(res.statusCode, 403);
});

test('Authorization: MASTER_ADMIN -> 200', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');
  const req = { cookies: { token } };
  mockOrders.docs = [];
  const res = await simulateRequest('/split-settlement/monitoring/summary', req);
  assert.equal(res.statusCode, 200);
});

// Response Security Tests
test('Response Security: Mapped fields only, no device/IP details or raw secrets', async () => {
  mockOrders.docs = [{
    _id: '60c72b2f9b1d8e23f0c3d9a1',
    table: 'Table 4',
    location: 'Main Hall',
    total: 25,
    paymentStatus: 'PAID',
    customerIp: '192.168.1.1',
    deviceId: 'dev_123',
    checkoutSessionId: 'sess_123',
    splitSettlement: {
      status: 'PROCESSED',
      createdAt: new Date(),
      externalTransferAmountPaise: 1250,
      platformRetainedAmountPaise: 1250,
      razorpayPaymentId: 'pay_ABC123XYZ',
      recipients: [{
        label: 'Vendor A',
        allocationBasisPoints: 5000,
        amountPaise: 1250,
        status: 'PROCESSED',
        linkedAccountId: 'acc_VEND123',
        transferId: 'trf_TRF987'
      }]
    }
  }];

  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');
  const req = { cookies: { token }, query: {} };
  const res = await simulateRequest('/split-settlement/monitoring/history', req);

  assert.equal(res.statusCode, 200);
  const row = res.body.orders[0];
  assert.ok(row.orderId);
  assert.ok(row.displayOrderId);
  assert.ok(row.table);
  // Security checks:
  assert.ok(!('customerIp' in row));
  assert.ok(!('deviceId' in row));
  assert.ok(!('checkoutSessionId' in row));
  assert.ok(!('razorpayPaymentId' in row));
});

test('Response Security: IDs are masked server-side', async () => {
  mockOrders.docs = [{
    _id: '60c72b2f9b1d8e23f0c3d9a1',
    table: 'Table 4',
    total: 25,
    paymentStatus: 'PAID',
    splitSettlement: {
      status: 'PROCESSED',
      createdAt: new Date(),
      razorpayPaymentId: 'pay_ABC123EwF',
      recipients: [{
        label: 'Vendor A',
        linkedAccountId: 'acc_VEND123VSFE',
        transferId: 'trf_TRF987McW'
      }]
    }
  }];

  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');
  const req = { cookies: { token }, params: { orderId: '60c72b2f9b1d8e23f0c3d9a1' } };
  const res = await simulateRequest('/split-settlement/monitoring/orders/:orderId', req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.settlement.razorpayPaymentId, 'pay_••••••••EwF');
  assert.equal(res.body.settlement.recipients[0].linkedAccountId, 'acc_••••••••VSFE');
  assert.equal(res.body.settlement.recipients[0].transferId, 'trf_••••••••McW');
});

// Pagination / Validation Tests
test('Pagination bounds validation', async () => {
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');

  // 1. Invalid values normalized
  const req1 = { cookies: { token }, query: { page: '-5', limit: '1000' } };
  const res1 = await simulateRequest('/split-settlement/monitoring/history', req1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.pagination.page, 1);
  assert.equal(res1.body.pagination.limit, 100); // clamped to max 100

  // 2. Invalid status filter rejected
  const req2 = { cookies: { token }, query: { status: 'INVALID_STATUS_VALUE' } };
  const res2 = await simulateRequest('/split-settlement/monitoring/history', req2);
  assert.equal(res2.statusCode, 400);

  // 3. Invalid date bounds
  const req3 = { cookies: { token }, query: { from: '2026-07-12', to: '2026-07-11' } };
  const res3 = await simulateRequest('/split-settlement/monitoring/history', req3);
  assert.equal(res3.statusCode, 400);
});

// Summary Aggregation Tests
test('Summary derived needsAttention and status mapping', async () => {
  mockOrders.docs = [
    { _id: 'o1', paymentStatus: 'PAID', splitSettlement: { status: 'PROCESSED' } },
    { _id: 'o2', paymentStatus: 'PAID', splitSettlement: { status: 'FAILED' } },
    { _id: 'o3', paymentStatus: 'PAID', splitSettlement: { status: 'RETRY_PENDING' } },
    { _id: 'o4', paymentStatus: 'PAID', splitSettlement: { status: 'RECONCILIATION_REQUIRED' } },
    { _id: 'o5', paymentStatus: 'PAID', splitSettlement: { status: 'PARTIALLY_PROCESSED' } },
    { _id: 'o6', paymentStatus: 'PAID', splitSettlement: { status: 'PROCESSING' } },
    { _id: 'o7', paymentStatus: 'PAID', splitSettlement: { status: 'SKIPPED' } }
  ];

  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');
  const req = { cookies: { token } };
  const res = await simulateRequest('/split-settlement/monitoring/summary', req);

  assert.equal(res.statusCode, 200);
  const sum = res.body.summary;
  assert.equal(sum.total, 7);
  assert.equal(sum.processed, 1);
  assert.equal(sum.processing, 1);
  assert.equal(sum.failed, 1);
  assert.equal(sum.needsAttention, 4); // failed + retryPending + reconciliationRequired + partiallyProcessed
});

test('History query with NEEDS_ATTENTION status filter maps to matching subset', async () => {
  mockOrders.docs = [
    { _id: 'o1', paymentStatus: 'PAID', splitSettlement: { status: 'PROCESSED' } },
    { _id: 'o2', paymentStatus: 'PAID', splitSettlement: { status: 'FAILED' } },
    { _id: 'o3', paymentStatus: 'PAID', splitSettlement: { status: 'RETRY_PENDING' } },
    { _id: 'o4', paymentStatus: 'PAID', splitSettlement: { status: 'RECONCILIATION_REQUIRED' } },
    { _id: 'o5', paymentStatus: 'PAID', splitSettlement: { status: 'PARTIALLY_PROCESSED' } },
    { _id: 'o6', paymentStatus: 'PAID', splitSettlement: { status: 'PROCESSING' } }
  ];

  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ role: 'MASTER_ADMIN' }, 'test_secret');
  const req = { cookies: { token }, query: { status: 'NEEDS_ATTENTION' } };
  const res = await simulateRequest('/split-settlement/monitoring/history', req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.orders.length, 4); // FAILED, RETRY_PENDING, RECONCILIATION_REQUIRED, PARTIALLY_PROCESSED
});
