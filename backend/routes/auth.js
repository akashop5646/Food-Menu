import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getDB } from '../db.js';

const router = Router();
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Rate limiter for login endpoint (M1 fix)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 10, // Max 10 attempts per IP per window
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for Google auth
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

import { normalizeProfileImage } from '../utils/profileImage.js';
export { normalizeProfileImage };

function getSecret() {
  return process.env.JWT_SECRET;
}

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, name: user.name, role: user.role || 'ADMIN', picture: normalizeProfileImage(user.picture) },
    getSecret(),
    { expiresIn: '24h' } // M4 fix: reduced from 7d to 24h
  );
}

// ---------- Register (Email + Password) [DISABLED] ----------
router.post('/register', (req, res) => {
  res.status(403).json({ error: 'Public registration is disabled. Please contact an administrator.' });
});

// ---------- Login (Email + Password) ----------
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Input validation
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input.' });
    }
    if (email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Invalid input.' });
    }

    const db = await getDB();
    const admins = db.collection('admins');
    const user = await admins.findOne({ email: email.toLowerCase() });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ user: { id: user._id, name: user.name, email: user.email, picture: normalizeProfileImage(user.picture), role: user.role || 'ADMIN' } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ---------- Google Sign-In ----------
router.post('/google', googleLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required.' });
    }

    // Dynamically import to avoid issues if google-auth-library isn't configured
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const db = await getDB();
    const admins = db.collection('admins');

    // Check if user exists first
    const existingUser = await admins.findOne({ email: payload.email.toLowerCase() });
    if (!existingUser) {
      return res.status(403).json({ error: 'Account not authorized. Please contact an Admin.' });
    }

    // Update their info
    const incomingPicture = normalizeProfileImage(payload.picture);
    const existingPicture = normalizeProfileImage(existingUser?.picture);
    const pictureToStore = incomingPicture || existingPicture || null;

    const result = await admins.findOneAndUpdate(
      { email: payload.email.toLowerCase() },
      {
        $set: {
          name: payload.name,
          picture: pictureToStore,
          provider: 'google',
          lastLogin: new Date(),
        }
      },
      { returnDocument: 'after' }
    );

    const user = result;
    const token = signToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ user: { id: user._id, name: user.name, email: user.email, picture: normalizeProfileImage(user.picture), role: user.role || 'ADMIN' } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Invalid Google credential.' });
  }
});

// ---------- Get Current User ----------
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const decoded = jwt.verify(token, getSecret());
    res.json({ user: { id: decoded.id, name: decoded.name, email: decoded.email, role: decoded.role || 'ADMIN', picture: normalizeProfileImage(decoded.picture) } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// ---------- Get Client IP (Public) ----------
router.get('/ip', (req, res) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  res.json({ ip });
});

// ---------- Logout ----------
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ message: 'Logged out.' });
});

export default router;
