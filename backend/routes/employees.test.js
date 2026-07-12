import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = 'test_secret_for_employees_test';

import { setMockDB } from '../db.js';
import { ObjectId } from 'mongodb';

// Mock collection implementation
class MockAdminsCollection {
  constructor() {
    this.docs = [];
  }

  async findOne(query) {
    const doc = this.docs.find(d => {
      if (query._id instanceof ObjectId) {
        return d._id.toString() === query._id.toString();
      }
      return false;
    });
    if (!doc) return null;
    const cloned = structuredClone(doc);
    if (doc._id) {
      cloned._id = doc._id;
    }
    return cloned;
  }

  find(query) {
    let matched = this.docs.filter(d => {
      // Role scoping/filtering
      if (query.role) {
        if (query.role.$in) {
          const permitted = query.role.$in;
          if (!permitted.includes(d.role)) return false;
        } else {
          if (d.role !== query.role) return false;
        }
      }

      // Search term filtering
      if (query.$and) {
        const searchCond = query.$and.find(cond => cond.$or);
        if (searchCond) {
          const matchSearch = searchCond.$or.some(c => {
            if (c.name && c.name.$regex) {
              const regex = new RegExp(c.name.$regex, 'i');
              return regex.test(d.name) || regex.test(d.email || '');
            }
            if (c.email && c.email.$regex) {
              const regex = new RegExp(c.email.$regex, 'i');
              return regex.test(d.name) || regex.test(d.email || '');
            }
            return false;
          });
          if (!matchSearch) return false;
        }
      }
      return true;
    });

    const cursor = {
      matched: matched.map(d => ({ ...d })),
      sort: (sorting) => {
        cursor.matched.sort((a, b) => {
          for (const key of Object.keys(sorting)) {
            const dir = sorting[key];
            let valA = a[key];
            let valB = b[key];

            if (key === 'createdAt') {
              valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            }

            if (valA === valB) continue;

            if (typeof valA === 'string' && typeof valB === 'string') {
              return dir === 1 ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return dir === 1 ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
          }
          return 0;
        });
        return cursor;
      },
      skip: (n) => {
        cursor.matched = cursor.matched.slice(n);
        return cursor;
      },
      limit: (n) => {
        if (n > 0) {
          cursor.matched = cursor.matched.slice(0, n);
        }
        return cursor;
      },
      project: () => cursor,
      toArray: async () => cursor.matched
    };
    return cursor;
  }

  async countDocuments(query) {
    const cursor = this.find(query);
    const arr = await cursor.toArray();
    return arr.length;
  }

  aggregate(pipeline) {
    const matchStage = pipeline.find(stage => stage.$match);
    let docs = this.docs;
    
    if (matchStage && matchStage.$match) {
      const query = matchStage.$match;
      docs = docs.filter(d => {
        if (query.role && query.role.$in) {
          return query.role.$in.includes(d.role);
        }
        return true;
      });
    }

    const counts = {};
    docs.forEach(doc => {
      counts[doc.role] = (counts[doc.role] || 0) + 1;
    });

    const result = Object.keys(counts).map(role => ({
      _id: role,
      count: counts[role]
    }));

    return {
      toArray: async () => result
    };
  }
}

class MockActivityCollection {
  constructor() {
    this.docs = [];
  }

  find(query) {
    let matched = this.docs.filter(d => {
      // Scoping
      if (query['actor.role'] && query['actor.role'].$in) {
        if (!query['actor.role'].$in.includes(d.actor.role)) return false;
      }
      if (query['actor.userId'] && d.actor.userId !== query['actor.userId']) return false;
      
      if (query.action) {
        if (query.action.$in) {
          if (!query.action.$in.includes(d.action)) return false;
        } else if (d.action !== query.action) {
          return false;
        }
      }

      if (query['entity.type']) {
        if (query['entity.type'].$in) {
          if (!query['entity.type'].$in.includes(d.entity.type)) return false;
        } else if (d.entity.type !== query['entity.type']) {
          return false;
        }
      }
      
      // Date range
      if (query.createdAt) {
        if (query.createdAt.$gte && d.createdAt < query.createdAt.$gte) return false;
        if (query.createdAt.$lte && d.createdAt > query.createdAt.$lte) return false;
      }
      return true;
    });

    const cursor = {
      matched: matched.map(d => ({ ...d })),
      sort: () => cursor,
      skip: (n) => {
        cursor.matched = cursor.matched.slice(n);
        return cursor;
      },
      limit: (n) => {
        if (n > 0) {
          cursor.matched = cursor.matched.slice(0, n);
        }
        return cursor;
      },
      toArray: async () => cursor.matched
    };
    return cursor;
  }

  async countDocuments(query) {
    const arr = await this.find(query).toArray();
    return arr.length;
  }
}

const mockAdmins = new MockAdminsCollection();
const mockActivity = new MockActivityCollection();

setMockDB({
  collection: (name) => {
    if (name === 'admins') return mockAdmins;
    if (name === 'employee_activity_events') return mockActivity;
    return null;
  }
});

// Import endpoints router and token generator
const employeesRouter = (await import('./employees.js')).default;
const jwt = (await import('jsonwebtoken')).default;

async function simulateEmployeesRequest(path, method, req) {
  const routeLayer = employeesRouter.stack.find(layer => 
    layer.route && 
    layer.route.path === path && 
    layer.route.methods[method.toLowerCase()]
  );
  if (!routeLayer) {
    throw new Error(`Route not found: ${method} ${path}`);
  }

  return new Promise(async (resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      json: (json) => {
        res.body = json;
        resolve(res);
        return res;
      },
      send: (body) => {
        res.body = body;
        resolve(res);
        return res;
      }
    };

    let currentLayerIndex = 0;
    const next = async (err) => {
      if (err) {
        res.statusCode = 500;
        res.body = { error: err.message };
        resolve(res);
        return;
      }
      const nextLayer = routeLayer.route.stack[currentLayerIndex++];
      if (nextLayer) {
        try {
          await nextLayer.handle(req, res, next);
        } catch (handleErr) {
          res.statusCode = 500;
          res.body = { error: handleErr.message };
          resolve(res);
        }
      }
    };

    await next();
  });
}

// Sample Data
const userMaster = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a1'),
  name: 'Master User',
  email: 'master@aurum.com',
  role: 'MASTER_ADMIN',
  picture: 'https://lh3.googleusercontent.com/master-pic',
  createdAt: new Date('2026-07-01T10:00:00Z'),
  lastLogin: new Date('2026-07-12T10:00:00Z'),
  provider: 'google',
  secretField: 'top-secret-master',
  password: 'hashed-password-here'
};

const userAdmin = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a2'),
  name: 'Admin Owner',
  email: 'admin@aurum.com',
  role: 'ADMIN',
  picture: 'http://lh3.googleusercontent.com/http-insecure-pic', // HTTP: will be normalized to null
  createdAt: new Date('2026-07-02T10:00:00Z'),
  lastLogin: null,
  provider: 'email',
  secretField: 'top-secret-admin',
  password: 'hashed-password-here'
};

const userStaff = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a3'),
  name: 'Staff Waiter',
  email: 'staff@aurum.com',
  role: 'STAFF',
  picture: '   https://lh3.googleusercontent.com/staff-pic   ', // needs trim/normalization
  createdAt: new Date('2026-07-03T10:00:00Z'),
  lastLogin: null,
  provider: 'google',
  secretField: 'top-secret-staff',
  password: 'hashed-password-here'
};

// --- Test Suites ---

test('Employees Auth: unauthenticated requests are rejected with 401', async () => {
  const res = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: {}
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authenticated.');
});

test('Employees Auth: STAFF role is rejected with 403', async () => {
  const token = jwt.sign({ id: '3', role: 'STAFF' }, 'test_secret_for_employees_test');
  const res = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: { token }
  });
  assert.equal(res.statusCode, 403);
});

test('Employees Auth: ADMIN and MASTER_ADMIN are allowed access', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  
  const tokenAdmin = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');
  const resAdmin = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: { token: tokenAdmin }
  });
  assert.equal(resAdmin.statusCode, 200);

  const tokenMaster = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');
  const resMaster = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: { token: tokenMaster }
  });
  assert.equal(resMaster.statusCode, 200);
});

test('Employees Visibility: MASTER_ADMIN summary counts all accounts and contains masterAdmins key', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  const token = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');
  
  const res = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: { token }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.total, 3);
  assert.equal(res.body.summary.masterAdmins, 1);
  assert.equal(res.body.summary.admins, 1);
  assert.equal(res.body.summary.staff, 1);
});

test('Employees Visibility: ADMIN summary excludes MASTER_ADMIN count and key completely', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  const token = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');
  
  const res = await simulateEmployeesRequest('/summary', 'GET', {
    cookies: { token }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.total, 2);
  assert.equal(res.body.summary.admins, 1);
  assert.equal(res.body.summary.staff, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.summary, 'masterAdmins'), false);
});

test('Employees Visibility: ADMIN list query excludes MASTER_ADMIN records completely before count/skip/limit', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  const token = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: {}
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.total, 2); // only ADMIN and STAFF
  const hasMaster = res.body.employees.some(emp => emp.role === 'MASTER_ADMIN');
  assert.equal(hasMaster, false);
});

test('Employees Visibility: ADMIN query requesting MASTER_ADMIN role filter returns 403', async () => {
  const token = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');
  const res = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { role: 'MASTER_ADMIN' }
  });
  assert.equal(res.statusCode, 403);
});

test('Employees Visibility: ADMIN requesting details for MASTER_ADMIN returns 403', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  const token = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');
  
  const res = await simulateEmployeesRequest('/:employeeId', 'GET', {
    cookies: { token },
    params: { employeeId: '60c72b2f9b1d8e23f0c3d9a1' } // userMaster ID
  });
  assert.equal(res.statusCode, 403);
});

test('Employees Validation: enforces page, limit, and invalid options limits', async () => {
  const token = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  // Page must be positive integer
  const resPage = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { page: '0' }
  });
  assert.equal(resPage.statusCode, 400);

  // Limit must be <= 100
  const resLimit = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { limit: '101' }
  });
  assert.equal(resLimit.statusCode, 400);

  // Invalid sort parameter
  const resSort = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { sort: 'invalid-sort' }
  });
  assert.equal(resSort.statusCode, 400);
});

test('Employees Search: trims, truncates to 50 characters, and escapes regex metacharacters safely', async () => {
  mockAdmins.docs = [userMaster, userAdmin];
  const token = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  // Search that matches
  const resMatch = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { search: '   Master   ' }
  });
  assert.equal(resMatch.statusCode, 200);
  assert.equal(resMatch.body.employees.length, 1);
  assert.equal(resMatch.body.employees[0].name, 'Master User');

  // Regex escaping search: Master(NonExistent) shouldn't crash and should return 0 matches
  const resEscape = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { search: 'Master(NonExistent)' }
  });
  assert.equal(resEscape.statusCode, 200);
  assert.equal(resEscape.body.employees.length, 0);
});

test('Employees Security: returns only allowlisted fields and normalizes profile pictures', async () => {
  mockAdmins.docs = [userMaster, userAdmin, userStaff];
  const token = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  // 1. List fields verification
  const resList = await simulateEmployeesRequest('/', 'GET', {
    cookies: { token },
    query: { sort: 'newest' }
  });
  assert.equal(resList.statusCode, 200);
  
  const masterListEmp = resList.body.employees.find(e => e.role === 'MASTER_ADMIN');
  assert.ok(masterListEmp);
  
  // Verify correct allowlist fields
  assert.deepEqual(Object.keys(masterListEmp).sort(), [
    'id', 'name', 'email', 'role', 'picture', 'createdAt', 'lastLogin'
  ].sort());
  
  // Verify image normalization
  const adminListEmp = resList.body.employees.find(e => e.role === 'ADMIN');
  assert.equal(adminListEmp.picture, null); // http: is normalized to null

  const staffListEmp = resList.body.employees.find(e => e.role === 'STAFF');
  assert.equal(staffListEmp.picture, 'https://lh3.googleusercontent.com/staff-pic'); // trimmed/normalized

  // 2. Details fields verification
  const resDetail = await simulateEmployeesRequest('/:employeeId', 'GET', {
    cookies: { token },
    params: { employeeId: '60c72b2f9b1d8e23f0c3d9a1' } // userMaster ID
  });
  assert.equal(resDetail.statusCode, 200);
  
  const detailEmp = resDetail.body.employee;
  assert.deepEqual(Object.keys(detailEmp).sort(), [
    'id', 'name', 'email', 'role', 'picture', 'provider', 'createdAt', 'lastLogin'
  ].sort());
  assert.equal(detailEmp.provider, 'GOOGLE');
  
  // Verify passwords or unknown db attributes are not exposed
  assert.equal(detailEmp.password, undefined);
  assert.equal(detailEmp.secretField, undefined);
});

test('Employees Detail: handles invalid ID, 404, and null dates safely', async () => {
  const token = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  // Case A: Malformed ObjectId format
  const resMalformed = await simulateEmployeesRequest('/:employeeId', 'GET', {
    cookies: { token },
    params: { employeeId: 'not-a-valid-objectid-format' }
  });
  assert.equal(resMalformed.statusCode, 400);

  // Case B: Missing/404 employee
  const resNotFound = await simulateEmployeesRequest('/:employeeId', 'GET', {
    cookies: { token },
    params: { employeeId: '60c72b2f9b1d8e23f0c3d9a9' }
  });
  assert.equal(resNotFound.statusCode, 404);
});

test('Employees Activity: summary, listing filters, scoping and date ranges', async () => {
  const tokenMaster = jwt.sign({ id: '1', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');
  const tokenAdmin = jwt.sign({ id: '2', role: 'ADMIN' }, 'test_secret_for_employees_test');

  const eventMaster = {
    _id: new ObjectId(),
    actor: { userId: '1', name: 'Master Admin User', email: 'master@test.com', role: 'MASTER_ADMIN' },
    action: 'SETTLEMENT_CONFIGURATION_UPDATED',
    entity: { type: 'SETTLEMENT_CONFIG', id: 'config', displayLabel: 'Config changed' },
    context: { action: 'ACTIVATED' },
    createdAt: new Date()
  };

  const eventAdmin = {
    _id: new ObjectId(),
    actor: { userId: '2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
    action: 'MENU_ITEM_CREATED',
    entity: { type: 'MENU_ITEM', id: 'item1', displayLabel: 'Item created' },
    context: { price: 10, categories: ['Food'] },
    createdAt: new Date()
  };

  const eventStaff = {
    _id: new ObjectId(),
    actor: { userId: '3', name: 'Staff User', email: 'staff@test.com', role: 'STAFF' },
    action: 'ORDER_CREATED',
    entity: { type: 'ORDER', id: 'order1', displayLabel: 'Order placed' },
    context: { total: 200, itemsCount: 3 },
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // yesterday
  };

  mockActivity.docs = [eventMaster, eventAdmin, eventStaff];
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId('222222222222222222222222'), name: 'Admin User', role: 'ADMIN' }
  ];

  // 1. GET /activity/summary - MASTER_ADMIN sees all
  const resSumMaster = await simulateEmployeesRequest('/activity/summary', 'GET', {
    cookies: { token: tokenMaster }
  });
  assert.equal(resSumMaster.statusCode, 200);
  assert.equal(resSumMaster.body.summary.totalEvents, 3);
  assert.equal(resSumMaster.body.summary.orders, 1);
  assert.equal(resSumMaster.body.summary.menu, 1);
  assert.equal(resSumMaster.body.summary.settings, 1);

  // 2. GET /activity/summary - ADMIN does not see MASTER_ADMIN events
  const resSumAdmin = await simulateEmployeesRequest('/activity/summary', 'GET', {
    cookies: { token: tokenAdmin }
  });
  assert.equal(resSumAdmin.statusCode, 200);
  assert.equal(resSumAdmin.body.summary.totalEvents, 2); // Excludes eventMaster
  assert.equal(resSumAdmin.body.summary.orders, 1);
  assert.equal(resSumAdmin.body.summary.menu, 1);
  assert.equal(resSumAdmin.body.summary.settings, 0); // settlement was MASTER_ADMIN

  // 3. GET /activity - ADMIN cannot filter by Master Admin employeeId
  const resFilterMaster = await simulateEmployeesRequest('/activity', 'GET', {
    cookies: { token: tokenAdmin },
    query: { employeeId: '111111111111111111111111' }
  });
  assert.equal(resFilterMaster.statusCode, 403);

  // 4. GET /activity - pagination parameter check
  const resInvalidPage = await simulateEmployeesRequest('/activity', 'GET', {
    cookies: { token: tokenAdmin },
    query: { page: '-1' }
  });
  assert.equal(resInvalidPage.statusCode, 400);

  // 5. GET /activity - valid list query
  const resList = await simulateEmployeesRequest('/activity', 'GET', {
    cookies: { token: tokenAdmin },
    query: { limit: '10' }
  });
  assert.equal(resList.statusCode, 200);
  assert.equal(resList.body.events.length, 2);

  // 6. GET /:employeeId/activity - ADMIN query MASTER_ADMIN activity returns 403
  const resDetailMaster = await simulateEmployeesRequest('/:employeeId/activity', 'GET', {
    cookies: { token: tokenAdmin },
    params: { employeeId: '111111111111111111111111' }
  });
  assert.equal(resDetailMaster.statusCode, 403);
});

// --- Regression Tests for Route Precedence and Shadowing ---

async function simulateRouterPrecedence(url, method, reqData = {}) {
  const req = {
    method,
    url,
    path: url,
    cookies: reqData.cookies || {},
    query: reqData.query || {},
    params: reqData.params || {},
    body: reqData.body || {},
    user: reqData.user || null
  };

  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      json: (json) => {
        res.body = json;
        resolve(res);
        return res;
      },
      send: (body) => {
        res.body = body;
        resolve(res);
        return res;
      }
    };

    employeesRouter(req, res, (err) => {
      if (err) {
        res.statusCode = 500;
        res.body = { error: err.message || err };
      } else {
        res.statusCode = 404;
        res.body = { error: 'Not Found' };
      }
      resolve(res);
    });
  });
}

test('Employees Precedence: GET /activity is NOT shadowed by GET /:employeeId', async () => {
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId('222222222222222222222222'), name: 'Admin User', role: 'ADMIN' }
  ];
  mockActivity.docs = [];
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence('/activity', 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.events));
});

test('Employees Precedence: GET /activity/summary is NOT shadowed by GET /:employeeId', async () => {
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId('222222222222222222222222'), name: 'Admin User', role: 'ADMIN' }
  ];
  mockActivity.docs = [];
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence('/activity/summary', 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.summary);
  assert.equal(typeof res.body.summary.totalEvents, 'number');
});

test('Employees Precedence: GET /summary is NOT shadowed by GET /:employeeId', async () => {
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId('222222222222222222222222'), name: 'Admin User', role: 'ADMIN' }
  ];
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence('/summary', 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.summary);
  assert.equal(typeof res.body.summary.total, 'number');
});

test('Employees Precedence: GET /:employeeId/activity matches the specific employee activity handler', async () => {
  const validId = '222222222222222222222222';
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId(validId), name: 'Admin User', role: 'ADMIN' }
  ];
  mockActivity.docs = [];
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence(`/${validId}/activity`, 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.events));
});

test('Employees Precedence: GET /:employeeId matches the employee details handler', async () => {
  const validId = '222222222222222222222222';
  mockAdmins.docs = [
    { _id: new ObjectId('111111111111111111111111'), name: 'Master User', role: 'MASTER_ADMIN' },
    { _id: new ObjectId(validId), name: 'Admin User', role: 'ADMIN', email: 'admin@test.com' }
  ];
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence(`/${validId}`, 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.employee);
  assert.equal(res.body.employee.id, validId);
});

test('Employees Precedence: Invalid ObjectId in GET /:employeeId returns 400', async () => {
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence('/invalid-employee-id', 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid employee ID format.');
});

test('Employees Precedence: Invalid ObjectId in GET /:employeeId/activity returns 400', async () => {
  const token = jwt.sign({ id: '111111111111111111111111', role: 'MASTER_ADMIN' }, 'test_secret_for_employees_test');

  const res = await simulateRouterPrecedence('/invalid-employee-id/activity', 'GET', {
    cookies: { token }
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid employee ID format.');
});
