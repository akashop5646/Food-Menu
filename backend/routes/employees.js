import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { requireAdmin, requireMasterAdmin } from '../middleware/auth.js';
import { normalizeProfileImage } from '../utils/profileImage.js';
import { verifyIntegrity } from '../services/employeeAudit.js';

const router = Router();

const ALLOWED_ROLES = ['MASTER_ADMIN', 'ADMIN', 'STAFF'];
const ALLOWED_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'];

let hasWarnedRetention = false;

export function parseRetentionDays() {
  const val = process.env.EMPLOYEE_AUDIT_RETENTION_DAYS;
  if (val === undefined) {
    return 365;
  }
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 90 || parsed > 2555) {
    if (!hasWarnedRetention) {
      hasWarnedRetention = true;
      console.warn('AUDIT_RETENTION_WARNING: Configuration value is invalid. Falling back to default retention of 365 days.');
    }
    return 365;
  }
  return parsed;
}

function parseDateRange(fromStr, toStr) {
  let fromDate = null;
  let toDate = null;

  if (fromStr) {
    const matchesDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(fromStr);
    const isoStr = matchesDateOnly ? `${fromStr}T00:00:00.000Z` : fromStr;
    fromDate = new Date(isoStr);
    if (isNaN(fromDate.getTime())) {
      throw new Error('Invalid from date format.');
    }
  }

  if (toStr) {
    const matchesDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toStr);
    const isoStr = matchesDateOnly ? `${toStr}T23:59:59.999Z` : toStr;
    toDate = new Date(isoStr);
    if (isNaN(toDate.getTime())) {
      throw new Error('Invalid to date format.');
    }
  }

  return { fromDate, toDate };
}

function sanitizeCSVCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  const trimmed = str.trim();
  if (/^[=\+\-@]/.test(trimmed)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// 1. GET /summary
router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const db = await getDB();

    if (callerRole === 'ADMIN') {
      // ADMIN visibility: ADMIN and STAFF only
      const counts = await db.collection('admins').aggregate([
        { $match: { role: { $in: ['ADMIN', 'STAFF'] } } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]).toArray();

      const roles = { ADMIN: 0, STAFF: 0 };
      counts.forEach(c => {
        if (c._id in roles) roles[c._id] = c.count;
      });

      const total = roles.ADMIN + roles.STAFF;

      return res.json({
        summary: {
          total,
          admins: roles.ADMIN,
          staff: roles.STAFF
        }
      });
    } else if (callerRole === 'MASTER_ADMIN') {
      // MASTER_ADMIN visibility: all roles
      const counts = await db.collection('admins').aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]).toArray();

      const roles = { MASTER_ADMIN: 0, ADMIN: 0, STAFF: 0 };
      counts.forEach(c => {
        const roleKey = c._id || 'ADMIN';
        if (roleKey in roles) roles[roleKey] = c.count;
      });

      const total = roles.MASTER_ADMIN + roles.ADMIN + roles.STAFF;

      return res.json({
        summary: {
          total,
          masterAdmins: roles.MASTER_ADMIN,
          admins: roles.ADMIN,
          staff: roles.STAFF
        }
      });
    } else {
      return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch employee summary.' });
  }
});

// 2. GET /activity/summary
router.get('/activity/summary', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const db = await getDB();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const baseQuery = {};
    if (callerRole === 'ADMIN') {
      baseQuery['actor.role'] = { $in: ['ADMIN', 'STAFF'] };
    }

    const [totalEvents, todayCount, ordersCount, menuCount, staffCount, settingsCount] = await Promise.all([
      db.collection('employee_activity_events').countDocuments(baseQuery),
      db.collection('employee_activity_events').countDocuments({ ...baseQuery, createdAt: { $gte: startOfToday } }),
      db.collection('employee_activity_events').countDocuments({
        ...baseQuery,
        action: { $in: ['ORDER_CREATED', 'ORDER_STATUS_CHANGED', 'ORDER_PAYMENT_VERIFIED'] }
      }),
      db.collection('employee_activity_events').countDocuments({
        ...baseQuery,
        action: { $in: ['MENU_ITEM_CREATED', 'MENU_ITEM_UPDATED', 'MENU_ITEM_AVAILABILITY_CHANGED', 'MENU_BULK_AVAILABILITY_CHANGED'] }
      }),
      db.collection('employee_activity_events').countDocuments({
        ...baseQuery,
        action: { $in: ['STAFF_ACCOUNT_CREATED', 'STAFF_ROLE_CHANGED', 'STAFF_ACCOUNT_DELETED'] }
      }),
      db.collection('employee_activity_events').countDocuments({
        ...baseQuery,
        action: { $in: ['SETTLEMENT_CONFIGURATION_UPDATED', 'CONVENIENCE_FEE_UPDATED'] }
      })
    ]);

    res.json({
      summary: {
        totalEvents,
        today: todayCount,
        orders: ordersCount,
        menu: menuCount,
        staff: staffCount,
        settings: settingsCount
      }
    });
  } catch (error) {
    console.error('Activity summary error:', error);
    res.status(500).json({ error: 'Failed to fetch activity summary.' });
  }
});

// 3. GET /activity/health
router.get('/activity/health', requireMasterAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays();
  try {
    const db = await getDB();
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalEvents, eventsLast24Hours, latestEventArr, failedWritesLast24Hours, unresolvedFailures, oldestRetainedEventArr] = await Promise.all([
      db.collection('employee_activity_events').countDocuments({}),
      db.collection('employee_activity_events').countDocuments({ createdAt: { $gte: last24h } }),
      db.collection('employee_activity_events').find({}).sort({ createdAt: -1, _id: -1 }).limit(1).toArray(),
      db.collection('employee_audit_failures').countDocuments({ occurredAt: { $gte: last24h } }),
      db.collection('employee_audit_failures').countDocuments({ resolvedAt: null }),
      db.collection('employee_activity_events').find({}).sort({ createdAt: 1, _id: 1 }).limit(1).toArray()
    ]);

    const latestEventAt = latestEventArr.length > 0 ? latestEventArr[0].createdAt : null;
    const oldestRetainedEventAt = oldestRetainedEventArr.length > 0 ? oldestRetainedEventArr[0].createdAt : null;

    let status = 'HEALTHY';
    if (unresolvedFailures > 0 || failedWritesLast24Hours > 0) {
      status = 'DEGRADED';
    } else if (eventsLast24Hours === 0) {
      status = 'NO_RECENT_ACTIVITY';
    }

    res.json({
      health: {
        status,
        totalEvents,
        eventsLast24Hours,
        latestEventAt,
        failedWritesLast24Hours,
        unresolvedFailures,
        retentionDays,
        oldestRetainedEventAt
      }
    });
  } catch (err) {
    console.error('Health endpoint query failed:', err.message || err);
    res.status(503).json({
      health: {
        status: 'UNAVAILABLE',
        totalEvents: 0,
        eventsLast24Hours: 0,
        latestEventAt: null,
        failedWritesLast24Hours: 0,
        unresolvedFailures: 0,
        retentionDays,
        oldestRetainedEventAt: null
      }
    });
  }
});

// 4. GET /activity/failures
router.get('/activity/failures', requireMasterAdmin, async (req, res) => {
  try {
    const { page: pageStr, limit: limitStr, status, from, to } = req.query || {};

    let page = 1;
    let limit = 20;

    if (pageStr !== undefined) {
      page = Number(pageStr);
      if (isNaN(page) || page <= 0 || !Number.isInteger(page)) {
        return res.status(400).json({ error: 'Invalid page parameter.' });
      }
    }

    if (limitStr !== undefined) {
      limit = Number(limitStr);
      if (isNaN(limit) || limit <= 0 || limit > 100 || !Number.isInteger(limit)) {
        return res.status(400).json({ error: 'Invalid limit parameter.' });
      }
    }

    const query = {};

    if (status === 'UNRESOLVED') {
      query.resolvedAt = null;
    } else if (status === 'RESOLVED') {
      query.resolvedAt = { $ne: null };
    }

    let parsedDates;
    try {
      parsedDates = parseDateRange(from, to);
    } catch (dateErr) {
      return res.status(400).json({ error: dateErr.message });
    }

    const { fromDate, toDate } = parsedDates;
    if (fromDate || toDate) {
      query.occurredAt = {};
      if (fromDate) query.occurredAt.$gte = fromDate;
      if (toDate) query.occurredAt.$lte = toDate;
    }

    const db = await getDB();
    const total = await db.collection('employee_audit_failures').countDocuments(query);
    const pages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const failures = await db.collection('employee_audit_failures')
      .find(query)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({
        _id: 1,
        failureId: 1,
        action: 1,
        actor: 1,
        entityType: 1,
        failureCategory: 1,
        sanitizedMessage: 1,
        occurredAt: 1,
        resolvedAt: 1
      })
      .toArray();

    res.json({
      failures,
      pagination: {
        total,
        pages,
        page,
        limit
      }
    });
  } catch (err) {
    console.error('List audit failures error:', err);
    res.status(500).json({ error: 'Failed to fetch failure list.' });
  }
});

// 5. GET /activity/export
router.get('/activity/export', requireMasterAdmin, async (req, res) => {
  try {
    const { employeeId, action, entityType, from, to } = req.query || {};

    if (!from || !to) {
      return res.status(400).json({ error: 'Both from and to dates are required for CSV export.' });
    }

    // Validate max range 90 days before end-of-day expansion
    const startCal = new Date(from);
    const endCal = new Date(to);
    if (isNaN(startCal.getTime()) || isNaN(endCal.getTime())) {
      return res.status(400).json({ error: 'Invalid date range parameters.' });
    }
    const dayDiff = (endCal.getTime() - startCal.getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff < 0 || dayDiff > 90) {
      return res.status(400).json({ error: 'Export date range cannot exceed 90 days.' });
    }

    let parsedDates;
    try {
      parsedDates = parseDateRange(from, to);
    } catch (dateErr) {
      return res.status(400).json({ error: dateErr.message });
    }

    const { fromDate, toDate } = parsedDates;
    const query = {};

    if (employeeId) {
      if (!ObjectId.isValid(employeeId) || employeeId.length !== 24) {
        return res.status(400).json({ error: 'Invalid employee ID format.' });
      }
      query['actor.userId'] = employeeId;
    }

    if (action) {
      query.action = action;
    }

    if (entityType) {
      query['entity.type'] = entityType;
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    const db = await getDB();
    const count = await db.collection('employee_activity_events').countDocuments(query);
    if (count > 10000) {
      return res.status(400).json({
        error: 'Export size exceeds the limit of 10,000 events. Please narrow your date range or filters.'
      });
    }

    const events = await db.collection('employee_activity_events')
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const headers = [
      'Timestamp',
      'Employee Name',
      'Employee Email',
      'Employee Role',
      'Action',
      'Category',
      'Entity Type',
      'Entity Label',
      'Context Summary',
      'Integrity Status'
    ];

    const csvRows = [headers.join(',')];

    for (const event of events) {
      const contextSummary = Object.entries(event.context || {})
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' | ');

      const integrityStatus = verifyIntegrity(event);

      const row = [
        event.createdAt instanceof Date ? event.createdAt.toISOString() : new Date(event.createdAt).toISOString(),
        event.actor?.name || '',
        event.actor?.email || '',
        event.actor?.role || '',
        event.action || '',
        event.entity?.type || '',
        event.entity?.type || '',
        event.entity?.displayLabel || '',
        contextSummary,
        integrityStatus
      ];

      csvRows.push(row.map(val => sanitizeCSVCell(val)).join(','));
    }

    const csvString = csvRows.join('\r\n');
    const filename = `aurum-employee-audit-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

// 6. POST /activity/retention/preview
router.post('/activity/retention/preview', requireMasterAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays();
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const db = await getDB();
    const eligibleEventCount = await db.collection('employee_activity_events').countDocuments({
      createdAt: { $lt: cutoffDate }
    });

    res.json({
      preview: {
        retentionDays,
        cutoff: cutoffDate.toISOString(),
        eligibleEventCount
      }
    });
  } catch (err) {
    console.error('Retention preview calculation failed:', err);
    res.status(500).json({ error: 'Failed to calculate retention preview.' });
  }
});

// 7. GET /activity/events/:eventId
router.get('/activity/events/:eventId', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { eventId } = req.params;

    if (!eventId || !ObjectId.isValid(eventId) || eventId.length !== 24) {
      return res.status(400).json({ error: 'Invalid event ID format.' });
    }

    const db = await getDB();
    const event = await db.collection('employee_activity_events').findOne({
      _id: new ObjectId(eventId)
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    // Visibility scoping
    if (callerRole === 'ADMIN' && event.actor?.role === 'MASTER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Admin cannot view Master Admin activity details.' });
    }

    const integrityStatus = verifyIntegrity(event);

    const sanitizedEvent = {
      id: event._id.toString(),
      action: event.action,
      category: event.entity?.type || '',
      actor: {
        userId: event.actor?.userId || '',
        name: event.actor?.name || '',
        role: event.actor?.role || ''
      },
      entity: {
        type: event.entity?.type || '',
        id: event.entity?.id || null,
        displayLabel: event.entity?.displayLabel || ''
      },
      context: event.context || {},
      createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : new Date(event.createdAt).toISOString(),
      integrityStatus
    };

    res.json({ event: sanitizedEvent });
  } catch (err) {
    console.error('Get event details error:', err);
    res.status(500).json({ error: 'Failed to fetch event details.' });
  }
});

// 8. GET /activity (list with dropdown filters and date range)
router.get('/activity', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { page: pageStr, limit: limitStr, employeeId, action, entityType, from, to } = req.query || {};

    let page = 1;
    let limit = 20;

    if (pageStr !== undefined) {
      page = Number(pageStr);
      if (isNaN(page) || page <= 0 || !Number.isInteger(page)) {
        return res.status(400).json({ error: 'Invalid page parameter.' });
      }
    }

    if (limitStr !== undefined) {
      limit = Number(limitStr);
      if (isNaN(limit) || limit <= 0 || limit > 100 || !Number.isInteger(limit)) {
        return res.status(400).json({ error: 'Invalid limit parameter.' });
      }
    }

    const db = await getDB();
    const query = {};

    // Scoping for ADMIN
    if (callerRole === 'ADMIN') {
      query['actor.role'] = { $in: ['ADMIN', 'STAFF'] };
    }

    // Filter by target employeeId
    if (employeeId) {
      if (!ObjectId.isValid(employeeId) || employeeId.length !== 24) {
        return res.status(400).json({ error: 'Invalid employee ID format.' });
      }

      // Role boundary check for target employee
      const targetUser = await db.collection('admins').findOne({ _id: new ObjectId(employeeId) });
      if (targetUser && targetUser.role === 'MASTER_ADMIN' && callerRole === 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Admin cannot query Master Admin activity.' });
      }

      query['actor.userId'] = employeeId;
    }

    // Filter by action
    if (action) {
      const allowedActions = [
        'EMPLOYEE_LOGIN', 'ORDER_CREATED', 'ORDER_STATUS_CHANGED', 'ORDER_PAYMENT_VERIFIED',
        'MENU_ITEM_CREATED', 'MENU_ITEM_UPDATED', 'MENU_ITEM_AVAILABILITY_CHANGED', 'MENU_BULK_AVAILABILITY_CHANGED',
        'STAFF_ACCOUNT_CREATED', 'STAFF_ROLE_CHANGED', 'STAFF_ACCOUNT_DELETED',
        'SETTLEMENT_CONFIGURATION_UPDATED', 'CONVENIENCE_FEE_UPDATED'
      ];
      if (!allowedActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid action filter.' });
      }
      query.action = action;
    }

    // Filter by entityType
    if (entityType) {
      const allowedEntities = ['AUTHENTICATION', 'ORDER', 'MENU_ITEM', 'STAFF', 'SETTLEMENT_CONFIG', 'CONFIGURATION'];
      if (!allowedEntities.includes(entityType)) {
        return res.status(400).json({ error: 'Invalid entity type filter.' });
      }
      query['entity.type'] = entityType;
    }

    let parsedDates;
    try {
      parsedDates = parseDateRange(from, to);
    } catch (dateErr) {
      return res.status(400).json({ error: dateErr.message });
    }

    const { fromDate, toDate } = parsedDates;
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    const total = await db.collection('employee_activity_events').countDocuments(query);
    const pages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const events = await db.collection('employee_activity_events')
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      events: events.map(event => ({
        id: event._id.toString(),
        actor: event.actor,
        action: event.action,
        entity: event.entity,
        context: event.context,
        createdAt: event.createdAt,
        integrityStatus: verifyIntegrity(event)
      })),
      pagination: {
        total,
        pages,
        page,
        limit
      }
    });
  } catch (error) {
    console.error('List activity error:', error);
    res.status(500).json({ error: 'Failed to fetch activity list.' });
  }
});

// 9. GET / (list, search, sorting, pagination)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { page: pageStr, limit: limitStr, search, role, sort } = req.query || {};

    // Default pagination values
    let page = 1;
    let limit = 20;

    if (pageStr !== undefined) {
      page = Number(pageStr);
      if (isNaN(page) || page <= 0 || !Number.isInteger(page)) {
        return res.status(400).json({ error: 'Invalid page parameter.' });
      }
    }

    if (limitStr !== undefined) {
      limit = Number(limitStr);
      if (isNaN(limit) || limit <= 0 || limit > 100 || !Number.isInteger(limit)) {
        return res.status(400).json({ error: 'Invalid limit parameter.' });
      }
    }

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role filter.' });
    }

    if (sort && !ALLOWED_SORTS.includes(sort)) {
      return res.status(400).json({ error: 'Invalid sort parameter.' });
    }

    // Role Visibility Boundary Checks
    if (callerRole === 'ADMIN') {
      if (role === 'MASTER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Admin cannot filter by Master Admin role.' });
      }
    }

    // Base query setup
    let query = {};
    if (callerRole === 'ADMIN') {
      // ADMIN visibility: ADMIN and STAFF only
      query.role = { $in: ['ADMIN', 'STAFF'] };
    }

    // Filter by role if specified
    if (role) {
      query.role = role;
    }

    // Handle search query
    if (search !== undefined) {
      const trimmed = search.trim();
      const truncated = trimmed.substring(0, 50);
      const escaped = truncated.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
      if (escaped) {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } }
          ]
        });
      }
    }

    // Sorting
    let sortMap = { createdAt: -1, _id: -1 }; // newest is default
    if (sort === 'oldest') {
      sortMap = { createdAt: 1, _id: 1 };
    } else if (sort === 'name_asc') {
      sortMap = { name: 1, _id: 1 };
    } else if (sort === 'name_desc') {
      sortMap = { name: -1, _id: -1 };
    }

    const db = await getDB();
    const total = await db.collection('admins').countDocuments(query);
    const pages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const rawEmployees = await db.collection('admins')
      .find(query)
      .project({ name: 1, email: 1, role: 1, picture: 1, createdAt: 1, lastLogin: 1 })
      .sort(sortMap)
      .skip(skip)
      .limit(limit)
      .toArray();

    const employees = rawEmployees.map(emp => ({
      id: emp._id.toString(),
      name: emp.name || emp.email.split('@')[0],
      email: emp.email,
      role: emp.role || 'ADMIN',
      picture: normalizeProfileImage(emp.picture),
      createdAt: emp.createdAt || null,
      lastLogin: emp.lastLogin || null
    }));

    res.json({
      employees,
      pagination: {
        total,
        pages,
        page,
        limit
      }
    });
  } catch (error) {
    console.error('List employees error:', error);
    res.status(500).json({ error: 'Failed to fetch employees list.' });
  }
});

// 10. GET /:employeeId/activity (shortcut for specific employee history)
router.get('/:employeeId/activity', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { employeeId } = req.params;
    const { page: pageStr, limit: limitStr } = req.query || {};

    if (!employeeId || !ObjectId.isValid(employeeId) || employeeId.length !== 24) {
      return res.status(400).json({ error: 'Invalid employee ID format.' });
    }

    let page = 1;
    let limit = 20;

    if (pageStr !== undefined) {
      page = Number(pageStr);
      if (isNaN(page) || page <= 0 || !Number.isInteger(page)) {
        return res.status(400).json({ error: 'Invalid page parameter.' });
      }
    }

    if (limitStr !== undefined) {
      limit = Number(limitStr);
      if (isNaN(limit) || limit <= 0 || limit > 100 || !Number.isInteger(limit)) {
        return res.status(400).json({ error: 'Invalid limit parameter.' });
      }
    }

    const db = await getDB();

    // Role boundary check
    const targetUser = await db.collection('admins').findOne({ _id: new ObjectId(employeeId) });
    if (!targetUser) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (targetUser.role === 'MASTER_ADMIN' && callerRole === 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Admin cannot query Master Admin activity.' });
    }

    const query = { 'actor.userId': employeeId };
    // Scoping for ADMIN
    if (callerRole === 'ADMIN') {
      query['actor.role'] = { $in: ['ADMIN', 'STAFF'] };
    }

    const total = await db.collection('employee_activity_events').countDocuments(query);
    const pages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const events = await db.collection('employee_activity_events')
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      events: events.map(event => ({
        id: event._id.toString(),
        actor: event.actor,
        action: event.action,
        entity: event.entity,
        context: event.context,
        createdAt: event.createdAt,
        integrityStatus: verifyIntegrity(event)
      })),
      pagination: {
        total,
        pages,
        page,
        limit
      }
    });
  } catch (error) {
    console.error('Get employee activity error:', error);
    res.status(500).json({ error: 'Failed to fetch employee activity.' });
  }
});

// 11. GET /:employeeId
router.get('/:employeeId', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { employeeId } = req.params;

    if (!employeeId || !ObjectId.isValid(employeeId) || employeeId.length !== 24) {
      return res.status(400).json({ error: 'Invalid employee ID format.' });
    }

    const db = await getDB();
    const emp = await db.collection('admins').findOne(
      { _id: new ObjectId(employeeId) },
      { projection: { name: 1, email: 1, role: 1, picture: 1, provider: 1, createdAt: 1, lastLogin: 1 } }
    );

    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Role Visibility Boundary Checks
    if (callerRole === 'ADMIN') {
      if (emp.role === 'MASTER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Admin cannot access Master Admin details.' });
      }
    }

    // Normalize provider value
    let provider = 'UNKNOWN';
    if (emp.provider === 'google') {
      provider = 'GOOGLE';
    } else if (emp.provider === 'email') {
      provider = 'EMAIL';
    }

    const employee = {
      id: emp._id.toString(),
      name: emp.name || emp.email.split('@')[0],
      email: emp.email,
      role: emp.role || 'ADMIN',
      picture: normalizeProfileImage(emp.picture),
      provider,
      createdAt: emp.createdAt || null,
      lastLogin: emp.lastLogin || null
    };

    res.json({ employee });
  } catch (error) {
    console.error('Get employee detail error:', error);
    res.status(500).json({ error: 'Failed to fetch employee details.' });
  }
});

export default router;
