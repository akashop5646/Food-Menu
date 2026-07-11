import jwt from 'jsonwebtoken';

const getSecret = () => process.env.JWT_SECRET;

const ROLES = Object.freeze({
  MASTER_ADMIN: 'MASTER_ADMIN',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF'
});

export const requireAdmin = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const decoded = jwt.verify(token, getSecret());
    if (decoded.role !== ROLES.ADMIN && decoded.role !== ROLES.MASTER_ADMIN) {
      return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

export const requireMasterAdmin = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const decoded = jwt.verify(token, getSecret());
    if (decoded.role !== ROLES.MASTER_ADMIN) {
      return res.status(403).json({ error: 'Forbidden: Master Admin access required.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

export const requireAuth = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const decoded = jwt.verify(token, getSecret());
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};
