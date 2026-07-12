import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { normalizeProfileImage } from '../utils/profileImage.js';

const router = Router();

const ALLOWED_ROLES = ['MASTER_ADMIN', 'ADMIN', 'STAFF'];
const ALLOWED_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'];

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

// 2. GET / (list, search, sorting, pagination)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const { page: pageStr, limit: limitStr, search, role, sort } = req.query;

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

// 3. GET /:employeeId
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
