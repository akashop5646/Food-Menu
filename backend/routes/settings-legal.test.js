import assert from 'node:assert/strict';
import test from 'node:test';

// Pre-set environment secret before importing any auth/router
process.env.JWT_SECRET = 'test_secret';

import { setMockDB } from '../db.js';

class MockConfigsCollection {
  constructor() {
    this.docs = [];
  }
  async findOne(query) {
    const doc = this.docs.find(d => d.key === query.key);
    return doc ? structuredClone(doc) : null;
  }
  find(query) {
    let matched = this.docs;
    if (query && query.key && query.key.$in) {
      matched = this.docs.filter(d => query.key.$in.includes(d.key));
    }
    const cursor = {
      toArray: async () => matched.map(d => structuredClone(d))
    };
    return cursor;
  }
  async updateOne(filter, update, options) {
    let doc = this.docs.find(d => d.key === filter.key);
    if (!doc) {
      doc = { key: filter.key };
      this.docs.push(doc);
    }
    if (update.$set) {
      doc.value = update.$set.value;
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

class MockEventsCollection {
  constructor() {
    this.inserted = [];
  }
  async insertOne(doc) {
    this.inserted.push(doc);
    return { insertedId: 'mock_event_id' };
  }
}

const mockConfigs = new MockConfigsCollection();
const mockEvents = new MockEventsCollection();
const mockDb = {
  collection: (name) => {
    if (name === 'configs') return mockConfigs;
    if (name === 'employee_activity_events') return mockEvents;
    return {
      insertOne: async () => ({ insertedId: 'mock' })
    };
  }
};

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

// Simulates Express route execution chain
async function simulateRequest(path, method, req) {
  const routeLayer = settingsRouter.stack.find(layer => 
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

test('Legal Settings Authorization & Schema Tests', async (t) => {
  const jwt = await import('jsonwebtoken');
  const masterAdminToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
    'test_secret'
  );
  const adminToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
    'test_secret'
  );
  const staffToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a3', name: 'Staff', email: 'staff@test.com', role: 'STAFF' },
    'test_secret'
  );

  await t.test('GET /legal: returns default values when empty', async () => {
    mockConfigs.docs = [];
    const req = { cookies: {} };
    const res = await simulateRequest('/legal', 'GET', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.effectiveDate, '');
    assert.equal(res.body.grievanceOfficerName, '');
    assert.equal(res.body.grievanceOfficerEmail, '');
    assert.equal(res.body.dataHostingLocation, 'India');
    assert.equal(res.body.grievanceResponseDays, '');
    assert.equal(res.body.policyVersion, 1);
  });

  await t.test('POST /legal: MASTER_ADMIN can update with valid payload, version increments', async () => {
    mockConfigs.docs = [
      { key: 'legal_policy_version', value: '1' }
    ];
    mockEvents.inserted = [];

    const payload = {
      effectiveDate: '2026-07-16',
      grievanceOfficerName: 'Raman Dev',
      grievanceOfficerEmail: 'raman@aurum.com',
      dataHostingLocation: 'India',
      grievanceResponseDays: 30
    };

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: payload
    };

    const res = await simulateRequest('/legal', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.legal.policyVersion, 2);
    assert.equal(res.body.legal.effectiveDate, '2026-07-16');

    // Confirm DB updates
    assert.equal(mockConfigs.docs.find(d => d.key === 'legal_effective_date').value, '2026-07-16');
    assert.equal(mockConfigs.docs.find(d => d.key === 'legal_grievance_officer_name').value, 'Raman Dev');
    assert.equal(mockConfigs.docs.find(d => d.key === 'legal_policy_version').value, '2');

    // Verify audit logs
    assert.equal(mockEvents.inserted.length, 1);
    assert.equal(mockEvents.inserted[0].action, 'LEGAL_SETTINGS_UPDATED');
    assert.equal(mockEvents.inserted[0].context.grievanceOfficerName, 'Raman Dev');
    assert.equal(mockEvents.inserted[0].context.grievanceResponseDays, 30);
  });

  await t.test('POST /legal: rejects request from regular ADMIN or STAFF (403 Forbidden)', async () => {
    const payload = {
      effectiveDate: '2026-07-16',
      grievanceOfficerName: 'Raman Dev',
      grievanceOfficerEmail: 'raman@aurum.com',
      dataHostingLocation: 'India',
      grievanceResponseDays: 30
    };

    const adminReq = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: payload
    };
    const adminRes = await simulateRequest('/legal', 'POST', adminReq);
    assert.equal(adminRes.statusCode, 403);

    const staffReq = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a3', name: 'Staff', email: 'staff@test.com', role: 'STAFF' },
      cookies: { token: staffToken },
      body: payload
    };
    const staffRes = await simulateRequest('/legal', 'POST', staffReq);
    assert.equal(staffRes.statusCode, 403);
  });

  await t.test('POST /legal: rejects invalid effective date formats', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { effectiveDate: 'invalid-date' }
    };
    const res = await simulateRequest('/legal', 'POST', req);
    assert.equal(res.statusCode, 400);
  });

  await t.test('POST /legal: rejects invalid email formats', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { grievanceOfficerEmail: 'invalidemail' }
    };
    const res = await simulateRequest('/legal', 'POST', req);
    assert.equal(res.statusCode, 400);
  });

  await t.test('POST /legal: rejects out-of-range grievance response days', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { grievanceResponseDays: 99 } // max 90
    };
    const res = await simulateRequest('/legal', 'POST', req);
    assert.equal(res.statusCode, 400);

    const reqNegative = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { grievanceResponseDays: -1 }
    };
    const resNegative = await simulateRequest('/legal', 'POST', reqNegative);
    assert.equal(resNegative.statusCode, 400);
  });

  await t.test('POST /legal: rejects when Grievance Officer Name is missing but other fields are provided', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { grievanceOfficerEmail: 'test@aurum.com' } // no name
    };
    const res = await simulateRequest('/legal', 'POST', req);
    assert.equal(res.statusCode, 400);
  });
});
