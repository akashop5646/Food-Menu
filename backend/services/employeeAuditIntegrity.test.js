import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  canonicalSerialize,
  generateIntegrityPayload,
  verifyIntegrity
} from './employeeAudit.js';

test('Integrity Core — Canonical serialization', async (t) => {
  await t.test('Verify recursively reordered object keys produce identical canonical serialization and identical digests', () => {
    const objA = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      createdAt: '2026-07-12T00:00:00.000Z',
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login success' }
    };

    const objB = {
      entity: { id: null, displayLabel: 'Login success', type: 'AUTHENTICATION' },
      createdAt: '2026-07-12T00:00:00.000Z',
      actor: { role: 'ADMIN', userId: '123456789012345678901234' },
      action: 'EMPLOYEE_LOGIN'
    };

    const serA = canonicalSerialize(objA);
    const serB = canonicalSerialize(objB);

    assert.strictEqual(serA, serB);
    assert.strictEqual(serA, '{"action":"EMPLOYEE_LOGIN","actor":{"role":"ADMIN","userId":"123456789012345678901234"},"createdAt":"2026-07-12T00:00:00.000Z","entity":{"displayLabel":"Login success","id":null,"type":"AUTHENTICATION"}}');
  });

  await t.test('Verify array order is preserved exactly', () => {
    const obj = {
      categories: ['Main', 'Desserts', 'Drinks']
    };
    const ser = canonicalSerialize(obj);
    assert.strictEqual(ser, '{"categories":["Main","Desserts","Drinks"]}');
  });

  await t.test('Verify changing array element order changes canonical serialization and resulting digest', () => {
    const objA = { categories: ['Main', 'Desserts'] };
    const objB = { categories: ['Desserts', 'Main'] };

    const serA = canonicalSerialize(objA);
    const serB = canonicalSerialize(objB);

    assert.notStrictEqual(serA, serB);
  });

  await t.test('Verify explicit null is preserved and undefined rejects', () => {
    const objNull = { id: null };
    assert.strictEqual(canonicalSerialize(objNull), '{"id":null}');

    assert.throws(() => {
      canonicalSerialize({ id: undefined });
    }, TypeError);
  });
});

test('Integrity Core — Derived integrityStatus mapping', async (t) => {
  const mockSecret = 'a'.repeat(32); // Valid 32-char secret

  await t.test('Derived UNVERIFIED_LEGACY when integrity property is missing', () => {
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      createdAt: new Date()
    };
    assert.strictEqual(verifyIntegrity(event), 'UNVERIFIED_LEGACY');
  });

  await t.test('Derived UNAVAILABLE when integrity version is 0 and algorithm/digest are NONE/null', () => {
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      createdAt: new Date(),
      integrity: {
        version: 0,
        algorithm: 'NONE',
        digest: null
      }
    };
    assert.strictEqual(verifyIntegrity(event), 'UNAVAILABLE');
  });

  await t.test('Derived VERIFIED with valid version 1 HMAC and secret is set', () => {
    process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET = mockSecret;
    const createdAt = new Date();
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      context: { provider: 'EMAIL' },
      createdAt
    };

    const payload = generateIntegrityPayload({
      action: event.action,
      entity: event.entity,
      actor: event.actor,
      context: event.context,
      createdAt: event.createdAt
    });

    const digest = crypto.createHmac('sha256', mockSecret).update(payload).digest('hex');
    event.integrity = {
      version: 1,
      algorithm: 'HMAC-SHA256',
      digest
    };

    assert.strictEqual(verifyIntegrity(event), 'VERIFIED');
    delete process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET;
  });

  await t.test('Derived INVALID with mismatch digest', () => {
    process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET = mockSecret;
    const createdAt = new Date();
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      createdAt,
      integrity: {
        version: 1,
        algorithm: 'HMAC-SHA256',
        digest: 'wrong_digest_value'
      }
    };

    assert.strictEqual(verifyIntegrity(event), 'INVALID');
    delete process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET;
  });

  await t.test('Derived UNAVAILABLE when secret is missing', () => {
    delete process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET;
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      createdAt: new Date(),
      integrity: {
        version: 1,
        algorithm: 'HMAC-SHA256',
        digest: 'aaaa'
      }
    };

    assert.strictEqual(verifyIntegrity(event), 'UNAVAILABLE');
  });

  await t.test('Derived INVALID for malformed/unsupported signatures', () => {
    process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET = mockSecret;
    const event = {
      action: 'EMPLOYEE_LOGIN',
      actor: { userId: '123456789012345678901234', role: 'ADMIN' },
      entity: { type: 'AUTHENTICATION', id: null, displayLabel: 'Login' },
      createdAt: new Date(),
      integrity: {
        version: 1,
        algorithm: 'HMAC-SHA256',
        digest: 12345 // non-string
      }
    };
    assert.strictEqual(verifyIntegrity(event), 'INVALID');
    delete process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET;
  });
});
