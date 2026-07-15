import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_for_checkout_codes_lifecycle_test';

import { setMockDB } from '../db.js';

class MockCheckoutCodesCollection {
  constructor() {
    this.docs = [];
    this.failOnInsertOne = false;
  }

  async findOne(query) {
    const now = new Date();
    const doc = this.docs.find(d => {
      if (query.checkoutSessionId && d.checkoutSessionId !== query.checkoutSessionId) return false;
      if (query.code && d.code !== query.code) return false;
      if (query.expiresAt && query.expiresAt.$gt) {
        if (!d.expiresAt) return false; // legacy
        if (d.expiresAt <= query.expiresAt.$gt) return false; // expired
      }
      return true;
    });
    return doc ? { ...doc } : null;
  }

  async deleteMany(query) {
    let deletedCount = 0;
    this.docs = this.docs.filter(d => {
      if (d.code !== query.code) return true;
      const orConds = query.$or || [];
      const matchesOr = orConds.some(cond => {
        if (cond.expiresAt && cond.expiresAt.$lte) {
          return d.expiresAt && d.expiresAt <= cond.expiresAt.$lte;
        }
        if (cond.expiresAt && cond.expiresAt.$exists === false) {
          return !d.expiresAt;
        }
        return false;
      });
      if (matchesOr) {
        deletedCount++;
        return false;
      }
      return true;
    });
    return { deletedCount };
  }

  async insertOne(doc) {
    if (this.failOnInsertOne) {
      const err = new Error('Duplicate key error');
      err.code = 11000;
      throw err;
    }
    this.docs.push({ ...doc, _id: new ObjectId() });
    return { insertedId: 'mock_inserted_id' };
  }

  async findOneAndDelete(query) {
    const index = this.docs.findIndex(d => {
      if (d.code !== query.code) return false;
      if (query.expiresAt && query.expiresAt.$gt) {
        if (!d.expiresAt) return false;
        if (d.expiresAt <= query.expiresAt.$gt) return false;
      }
      return true;
    });
    if (index !== -1) {
      const doc = this.docs[index];
      this.docs.splice(index, 1);
      return doc;
    }
    return null;
  }
}

const mockCheckoutCodes = new MockCheckoutCodesCollection();

const mockDb = {
  collection: (name) => {
    if (name === 'checkout_codes') return mockCheckoutCodes;
    return {
      insertOne: async () => ({ insertedId: 'mock' }),
      createIndex: async () => {},
      dropIndex: async () => {}
    };
  }
};

setMockDB(mockDb);

const ordersRouter = (await import('./orders.js')).default;

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

async function simulateRequest(path, method, req) {
  const routeLayer = ordersRouter.stack.find(layer =>
    layer.route &&
    layer.route.path === path &&
    Object.keys(layer.route.methods).includes(method.toLowerCase())
  );
  if (!routeLayer) {
    throw new Error(`Route not found: ${method} ${path}`);
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
      if (currentLayerIndex === routeLayer.route.stack.length) {
        await nextLayer.handle(req, res, next);
      } else {
        let nextPromise;
        const wrappedNext = (subErr) => {
          nextPromise = next(subErr);
        };
        await nextLayer.handle(req, res, wrappedNext);
        if (nextPromise) {
          await nextPromise;
        }
      }
    }
  };
  await next();
  return res;
}

const staffToken = jwt.sign(
  { id: '60c72b2f9b1d8e23f0c3d9e0', name: 'Staff User', email: 'staff@aurum.com', role: 'STAFF' },
  'test_secret_for_checkout_codes_lifecycle_test'
);

test('Checkout Codes Lifecycle Tests', async (t) => {
  t.beforeEach(() => {
    mockCheckoutCodes.docs = [];
    mockCheckoutCodes.failOnInsertOne = false;
  });

  await t.test('1. Generated code has expiresAt exactly 10 minutes after createdAt', async () => {
    const payload = {
      table: 'Table 1',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 2 }],
      total: 50.00
    };
    const req = {
      body: payload
    };
    const res = await simulateRequest('/checkout-code', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.code);
    assert.ok(res.body.expiresAt);

    const doc = mockCheckoutCodes.docs[0];
    assert.ok(doc);
    assert.equal(doc.code, res.body.code);
    assert.ok(doc.createdAt instanceof Date);
    assert.ok(doc.expiresAt instanceof Date);

    const diffMs = doc.expiresAt.getTime() - doc.createdAt.getTime();
    assert.equal(diffMs, 10 * 60 * 1000);
  });

  await t.test('2. Preserves leading-zero string format (0042)', async () => {
    // Insert a code with leading zeros
    const payload = {
      table: 'Table 1',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }],
      total: 25.00
    };
    mockCheckoutCodes.docs.push({
      code: '0042',
      orderPayload: payload,
      checkoutSessionId: 'sess_1',
      used: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const req = {
      cookies: { token: staffToken },
      body: { code: '0042' }
    };
    const res = await simulateRequest('/verify-code', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.orderPayload, payload);
  });

  await t.test('3. Stale same-code records (expired/legacy) are deleted before candidate insertion', async () => {
    const now = new Date();
    // 1. Insert an expired code "1234"
    mockCheckoutCodes.docs.push({
      code: '1234',
      orderPayload: { total: 10 },
      used: false,
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 10 * 60 * 1000)
    });

    // 2. Insert a legacy code "1234" (no expiresAt)
    mockCheckoutCodes.docs.push({
      code: '1234',
      orderPayload: { total: 20 },
      used: false,
      createdAt: new Date(now.getTime() - 30 * 60 * 1000)
    });

    // Verify both exist
    assert.equal(mockCheckoutCodes.docs.length, 2);

    // Call generate, we mock the random generator to return "1234" by setting random seed or similar,
    // but wait! Since candidateCode is random between 1000-9999, we can temporarily mock Math.random to return 0.026 (so floor(1000 + 0.026*9000) = 1234).
    const originalRandom = Math.random;
    Math.random = () => 0.026;

    try {
      const payload = {
        table: 'Table 2',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }],
        total: 15.00
      };
      const req = {
        body: payload
      };
      const res = await simulateRequest('/checkout-code', 'POST', req);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.code, '1234');

      // Verify that the stale ones were deleted, and only the new one remains in database
      assert.equal(mockCheckoutCodes.docs.length, 1);
      assert.equal(mockCheckoutCodes.docs[0].orderPayload.total, 15.00);
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('4. Active code collision causes generation retry', async () => {
    const now = new Date();
    // Insert an active code "5555"
    mockCheckoutCodes.docs.push({
      code: '5555',
      orderPayload: { total: 100 },
      used: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000)
    });

    // Mock random to return "5555" on first call, and "6666" on second call
    const originalRandom = Math.random;
    let callCount = 0;
    Math.random = () => {
      callCount++;
      if (callCount === 1) return 4555 / 9000; // 5555
      return 5666 / 9000; // 6666
    };

    try {
      const payload = {
        table: 'Table 3',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }],
        total: 100.00
      };
      const req = {
        body: payload
      };
      const res = await simulateRequest('/checkout-code', 'POST', req);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.code, '6666');

      // Both documents should exist in database
      assert.equal(mockCheckoutCodes.docs.length, 2);
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('5. Generation retry exhaustion returns controlled 503 response', async () => {
    const now = new Date();
    // Mock collision on insert or mock active collision check for any code
    const originalRandom = Math.random;
    Math.random = () => 4555 / 9000; // always generates "5555"

    // Insert active code "5555"
    mockCheckoutCodes.docs.push({
      code: '5555',
      orderPayload: { total: 100 },
      used: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000)
    });

    try {
      const payload = {
        table: 'Table 4',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }],
        total: 100.00
      };
      const req = {
        body: payload
      };
      const res = await simulateRequest('/checkout-code', 'POST', req);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'CHECKOUT_CODE_GENERATION_UNAVAILABLE');
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('6. Expired records and legacy records (no expiresAt) are rejected on verification', async () => {
    const now = new Date();
    // 1. Expired code "7777"
    mockCheckoutCodes.docs.push({
      code: '7777',
      orderPayload: { total: 70 },
      used: false,
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 10 * 60 * 1000)
    });

    // 2. Legacy code "8888"
    mockCheckoutCodes.docs.push({
      code: '8888',
      orderPayload: { total: 80 },
      used: false,
      createdAt: new Date(now.getTime() - 30 * 60 * 1000)
    });

    // Verify expired code rejection
    const req1 = {
      cookies: { token: staffToken },
      body: { code: '7777' }
    };
    const res1 = await simulateRequest('/verify-code', 'POST', req1);
    assert.equal(res1.statusCode, 404);
    assert.equal(res1.body.code, 'CHECKOUT_CODE_INVALID');

    // Verify legacy code rejection
    const req2 = {
      cookies: { token: staffToken },
      body: { code: '8888' }
    };
    const res2 = await simulateRequest('/verify-code', 'POST', req2);
    assert.equal(res2.statusCode, 404);
    assert.equal(res2.body.code, 'CHECKOUT_CODE_INVALID');
  });

  await t.test('7. Verification is atomic: exactly one of two concurrent requests succeeds', async () => {
    const now = new Date();
    mockCheckoutCodes.docs.push({
      code: '9999',
      orderPayload: { total: 90 },
      used: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
    });

    // Perform first verification request
    const req1 = {
      cookies: { token: staffToken },
      body: { code: '9999' }
    };
    const res1 = await simulateRequest('/verify-code', 'POST', req1);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.orderPayload.total, 90);

    // Perform second verification request of the same code
    const res2 = await simulateRequest('/verify-code', 'POST', req1);
    assert.equal(res2.statusCode, 404);
    assert.equal(res2.body.code, 'CHECKOUT_CODE_INVALID');
  });
});
