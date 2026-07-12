import { getDB } from '../db.js';

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
    amount: (v) => typeof v === 'number' && v >= 0 && v <= 20,
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

export async function recordEmployeeActivity(actor, action, entity, context) {
  try {
    // 1. Normalize
    const normalizedContext = normalizeContext(action, context);

    // 2. Validate
    validateAuditEvent(actor, action, entity, normalizedContext);

    // 3. Save
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
      createdAt: new Date(),
    };

    await db.collection('employee_activity_events').insertOne(eventDoc);
    return true;
  } catch (err) {
    console.error('AUDIT_LOG_ERROR:', err.message || err);
    return false;
  }
}
