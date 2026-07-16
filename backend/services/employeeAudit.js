import { getDB } from '../db.js';
import crypto from 'node:crypto';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ACTION_TAXONOMY = [
  'EMPLOYEE_LOGIN',
  'ORDER_CREATED',
  'ORDER_STATUS_CHANGED',
  'ORDER_PAYMENT_VERIFIED',
  'MENU_ITEM_CREATED',
  'MENU_ITEM_UPDATED',
  'MENU_ITEM_AVAILABILITY_CHANGED',
  'MENU_BULK_AVAILABILITY_CHANGED',
  'STAFF_ACCOUNT_CREATED',
  'STAFF_ROLE_CHANGED',
  'STAFF_ACCOUNT_DELETED',
  'SETTLEMENT_CONFIGURATION_UPDATED',
  'CONVENIENCE_FEE_UPDATED',
  'LEGAL_SETTINGS_UPDATED',
];

const ENTITY_TAXONOMY = [
  'AUTHENTICATION',
  'ORDER',
  'MENU_ITEM',
  'STAFF',
  'SETTLEMENT_CONFIG',
  'CONFIGURATION',
];

const CONTEXT_SCHEMAS = {
  EMPLOYEE_LOGIN: {
    provider: (v) => v === 'EMAIL' || v === 'GOOGLE',
  },
  ORDER_CREATED: {
    total: (v) => typeof v === 'number' && v >= 0,
    itemsCount: (v) => Number.isInteger(v) && v >= 0,
  },
  ORDER_STATUS_CHANGED: {
    toStatus: (v) => ['NEW', 'PREPARING', 'READY', 'COMPLETED'].includes(v),
  },
  ORDER_PAYMENT_VERIFIED: {
    paymentStatus: (v) => v === 'PAID',
  },
  MENU_ITEM_CREATED: {
    price: (v) => typeof v === 'number' && v >= 0,
    categories: (v) => {
      if (!Array.isArray(v)) return false;
      if (v.length > 20) return false;
      return v.every(c => typeof c === 'string' && c.length > 0 && c.length <= 100);
    },
  },
  MENU_ITEM_UPDATED: {
    updatedFields: (v) => {
      if (!Array.isArray(v)) return false;
      if (v.length > 20) return false;
      const allowedFields = ['name', 'categories', 'price', 'description', 'chefPick', 'available', 'image'];
      return v.every(f => typeof f === 'string' && allowedFields.includes(f));
    },
    availableTransition: (v) => v === null || typeof v === 'boolean',
  },
  MENU_ITEM_AVAILABILITY_CHANGED: {
    available: (v) => typeof v === 'boolean',
  },
  MENU_BULK_AVAILABILITY_CHANGED: {
    requestedCount: (v) => Number.isInteger(v) && v >= 0,
    matchedCount: (v) => Number.isInteger(v) && v >= 0,
    modifiedCount: (v) => Number.isInteger(v) && v >= 0,
    available: (v) => typeof v === 'boolean',
  },
  STAFF_ACCOUNT_CREATED: {
    name: (v) => typeof v === 'string' && v.length <= 200,
    provider: (v) => v === 'EMAIL' || v === 'GOOGLE',
  },
  STAFF_ROLE_CHANGED: {
    fromRole: (v) => ['ADMIN', 'STAFF', 'MASTER_ADMIN'].includes(v),
    toRole: (v) => ['ADMIN', 'STAFF', 'MASTER_ADMIN'].includes(v),
  },
  STAFF_ACCOUNT_DELETED: {
    name: (v) => typeof v === 'string' && v.length <= 200,
  },
  SETTLEMENT_CONFIGURATION_UPDATED: {
    action: (v) => ['DRAFT_SAVED', 'ACTIVATED', 'DISABLED'].includes(v),
    version: (v) => v === undefined || (Number.isInteger(v) && v >= 0),
    totalBasisPoints: (v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 10000),
  },
  CONVENIENCE_FEE_UPDATED: {
    enabled: (v) => typeof v === 'boolean',
    type: (v) => v === undefined || ['PERCENTAGE', 'FIXED'].includes(v),
    percentage: (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 20),
    amount: (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 20),
  },
  LEGAL_SETTINGS_UPDATED: {
    effectiveDate: (v) => typeof v === 'string',
    grievanceOfficerName: (v) => typeof v === 'string',
    grievanceOfficerEmail: (v) => typeof v === 'string',
    dataHostingLocation: (v) => typeof v === 'string',
    grievanceResponseDays: (v) => typeof v === 'number',
  },
};

export function validateAuditEvent(actor, action, entity, context) {
  // Validate actor
  if (!actor || typeof actor !== 'object') {
    throw new ValidationError('Actor must be an object.');
  }
  const { userId, name, email, role } = actor;
  if (typeof userId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(userId)) {
    throw new ValidationError('Actor userId must be a valid 24-character hex ObjectId string.');
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('Actor name must be a non-empty string.');
  }
  if (typeof email !== 'string' || email.trim() === '') {
    throw new ValidationError('Actor email must be a non-empty string.');
  }
  if (!['MASTER_ADMIN', 'ADMIN', 'STAFF'].includes(role)) {
    throw new ValidationError('Actor role must be MASTER_ADMIN, ADMIN, or STAFF.');
  }

  // Validate action
  if (!ACTION_TAXONOMY.includes(action)) {
    throw new ValidationError(`Invalid action: ${action}`);
  }

  // Validate entity
  if (!entity || typeof entity !== 'object') {
    throw new ValidationError('Entity must be an object.');
  }
  const { type, id, displayLabel } = entity;
  if (!ENTITY_TAXONOMY.includes(type)) {
    throw new ValidationError(`Invalid entity type: ${type}`);
  }
  if (id !== null && typeof id !== 'string') {
    throw new ValidationError('Entity id must be null or a string.');
  }
  if (typeof displayLabel !== 'string' || displayLabel.length > 200) {
    throw new ValidationError('Entity displayLabel must be a string up to 200 characters.');
  }

  // Validate context
  if (!context || typeof context !== 'object') {
    throw new ValidationError('Context must be an object.');
  }
  const schema = CONTEXT_SCHEMAS[action];
  if (!schema) {
    throw new ValidationError(`No context schema defined for action: ${action}`);
  }

  // Check for unknown keys or nested objects in context
  for (const key of Object.keys(context)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      throw new ValidationError(`Unknown context key for action ${action}: ${key}`);
    }
    const val = context[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      throw new ValidationError(`Context value for ${key} cannot be a nested object.`);
    }
    if (typeof val === 'string' && val.length > 1000) {
      throw new ValidationError(`Context string value for ${key} exceeds 1000 characters.`);
    }
  }

  // Check defined validation rules
  for (const key of Object.keys(schema)) {
    const validator = schema[key];
    const val = context[key];
    // Allow optional keys if undefined (unless key is required)
    if (val === undefined && key !== 'provider' && key !== 'available' && key !== 'paymentStatus' && key !== 'toStatus' && key !== 'price' && key !== 'fromRole' && key !== 'toRole' && key !== 'action' && key !== 'enabled' && key !== 'amount') {
      continue;
    }
    if (!validator(val)) {
      throw new ValidationError(`Invalid context value for key: ${key}`);
    }
  }
}

export function normalizeContext(action, context) {
  if (!context || typeof context !== 'object') return context;
  const normalized = { ...context };

  // normalize categories
  if (normalized.categories !== undefined) {
    if (Array.isArray(normalized.categories)) {
      const trimmed = normalized.categories.map(c => typeof c === 'string' ? c.trim() : c);
      const unique = [];
      for (const val of trimmed) {
        if (!unique.includes(val)) {
          unique.push(val);
        }
      }
      normalized.categories = unique;
    }
  }

  // normalize updatedFields
  if (normalized.updatedFields !== undefined) {
    if (Array.isArray(normalized.updatedFields)) {
      const unique = [];
      for (const val of normalized.updatedFields) {
        if (!unique.includes(val)) {
          unique.push(val);
        }
      }
      normalized.updatedFields = unique;
    }
  }

  return normalized;
}

// --- Phase 3 Integrity Core ---

let hasWarnedIntegrity = false;

export function getIntegritySecret() {
  const secret = process.env.EMPLOYEE_AUDIT_INTEGRITY_SECRET;
  if (!secret || secret.length < 32) {
    if (!hasWarnedIntegrity) {
      hasWarnedIntegrity = true;
      console.warn('AUDIT_INTEGRITY_WARNING: Integrity signing is unavailable (secret is missing or holds insufficient entropy).');
    }
    return null;
  }
  return secret;
}

export function canonicalSerialize(obj) {
  if (obj === null) return 'null';
  if (obj === undefined) {
    throw new TypeError('Unsupported value type: undefined');
  }
  if (typeof obj === 'function' || typeof obj === 'symbol') {
    throw new TypeError(`Unsupported value type: ${typeof obj}`);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalSerialize(item)).join(',') + ']';
  }
  if (obj instanceof Date) {
    return `"${obj.toISOString()}"`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => {
      const val = obj[k];
      if (val === undefined) {
        throw new TypeError('Unsupported value type: undefined');
      }
      return `"${k}":${canonicalSerialize(val)}`;
    });
    return '{' + parts.join(',') + '}';
  }
  if (typeof obj === 'string') {
    return `"${obj}"`;
  }
  return String(obj);
}

export function generateIntegrityPayload({ action, entity, actor, context, createdAt }) {
  const dateStr = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();

  // Explicitly map exactly the Phase 2 schema properties
  const payloadObj = {
    version: 1,
    action,
    entity: {
      type: entity.type,
      id: entity.id,
      displayLabel: entity.displayLabel
    },
    actor: {
      userId: actor.userId,
      role: actor.role
    },
    context: context || {},
    createdAt: dateStr
  };

  return canonicalSerialize(payloadObj);
}

export function verifyIntegrity(event) {
  if (!event.integrity) {
    return 'UNVERIFIED_LEGACY';
  }

  const { version, algorithm, digest } = event.integrity;

  // Unknown future version
  if (version !== 0 && version !== 1) {
    return 'UNAVAILABLE';
  }

  // Version 0 metadata -> UNAVAILABLE
  if (version === 0) {
    if (algorithm === 'NONE' && digest === null) {
      return 'UNAVAILABLE';
    }
    return 'INVALID'; // Malformed version 0
  }

  // Version 1 metadata checks
  if (version === 1) {
    if (algorithm !== 'HMAC-SHA256' || typeof digest !== 'string') {
      return 'INVALID'; // Malformed version 1
    }

    const secret = getIntegritySecret();
    if (!secret) {
      return 'UNAVAILABLE';
    }

    try {
      const payload = generateIntegrityPayload({
        action: event.action,
        entity: event.entity,
        actor: event.actor,
        context: event.context,
        createdAt: event.createdAt
      });

      const expectedDigest = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const bufExpected = Buffer.from(expectedDigest, 'hex');
      let bufActual;
      try {
        bufActual = Buffer.from(digest, 'hex');
      } catch (e) {
        return 'INVALID'; // Non-hex digest
      }

      if (bufExpected.length !== bufActual.length) {
        return 'INVALID';
      }

      const isValid = crypto.timingSafeEqual(bufExpected, bufActual);
      return isValid ? 'VERIFIED' : 'INVALID';
    } catch (err) {
      return 'INVALID';
    }
  }

  return 'INVALID';
}

// Outage-safe failures logger
async function logAuditFailure({ action, actor, entityType, category, message }) {
  try {
    const db = await getDB();
    const failureDoc = {
      failureId: crypto.randomUUID(),
      action: action || 'UNKNOWN',
      actor: {
        userId: actor?.userId || 'UNKNOWN',
        role: actor?.role || 'UNKNOWN'
      },
      entityType: entityType || 'UNKNOWN',
      failureCategory: category || 'UNKNOWN_INTERNAL_FAILURE',
      sanitizedMessage: message || 'An unexpected internal error occurred.',
      occurredAt: new Date(),
      resolvedAt: null
    };
    await db.collection('employee_audit_failures').insertOne(failureDoc);
  } catch (failErr) {
    console.error(
      'AUDIT_FAILURE_LOG_ERROR: Failed to save audit failure record. Same-database failure diagnostics are unavailable during storage outages.',
      failErr.message || failErr
    );
  }
}

export async function recordEmployeeActivity(actor, action, entity, context) {
  const createdAt = new Date();
  try {
    // 1. Normalize
    const normalizedContext = normalizeContext(action, context);

    // 2. Validate
    validateAuditEvent(actor, action, entity, normalizedContext);

    // 3. Integrity Sign
    const secret = getIntegritySecret();
    let integrity;
    if (secret) {
      try {
        const payload = generateIntegrityPayload({
          action,
          entity,
          actor,
          context: normalizedContext,
          createdAt
        });
        const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        integrity = {
          version: 1,
          algorithm: 'HMAC-SHA256',
          digest
        };
      } catch (signErr) {
        integrity = {
          version: 0,
          algorithm: 'NONE',
          digest: null
        };
        await logAuditFailure({
          action,
          actor,
          entityType: entity?.type,
          category: 'INTEGRITY_SIGNING_UNAVAILABLE',
          message: 'Integrity signature could not be generated.'
        });
      }
    } else {
      integrity = {
        version: 0,
        algorithm: 'NONE',
        digest: null
      };
    }

    // 4. Save
    const db = await getDB();
    const eventDoc = {
      actor: {
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        role: actor.role,
      },
      action,
      entity: {
        type: entity.type,
        id: entity.id,
        displayLabel: entity.displayLabel,
      },
      context: normalizedContext,
      createdAt,
      integrity
    };

    await db.collection('employee_activity_events').insertOne(eventDoc);
    return true;
  } catch (err) {
    console.error('AUDIT_LOG_ERROR:', err.message || err);
    const category = err.name === 'ValidationError' ? 'VALIDATION_FAILED' : 'DATABASE_WRITE_FAILED';
    const message = err.name === 'ValidationError' ? 'Audit event validation failed.' : 'Audit event could not be persisted.';

    await logAuditFailure({
      action,
      actor,
      entityType: entity?.type,
      category,
      message
    });

    return false;
  }
}
