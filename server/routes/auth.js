import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDB } from '../db.js';

const router = Router();
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function getSecret() {
  return process.env.JWT_SECRET;
}

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, name: user.name, role: user.role || 'ADMIN' },
    getSecret(),
    { expiresIn: '7d' }
  );
}

// ---------- Register (Email + Password) ----------
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const db = await getDB();
    const admins = db.collection('admins');

    const existing = await admins.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await admins.insertOne({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      provider: 'email',
      role: 'ADMIN', // First user via form is ADMIN, or restrict this entirely? The user already has one.
      createdAt: new Date(),
    });

    const user = { _id: result.insertedId, name, email: email.toLowerCase(), role: 'ADMIN' };
    const token = signToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// ---------- Login (Email + Password) ----------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
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
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role || 'ADMIN' } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ---------- Google Sign-In ----------
router.post('/google', async (req, res) => {
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
    const result = await admins.findOneAndUpdate(
      { email: payload.email.toLowerCase() },
      {
        $set: {
          name: payload.name,
          picture: payload.picture,
          provider: 'google',
          lastLogin: new Date(),
        }
      },
      { returnDocument: 'after' }
    );

    const user = result;
    const token = signToken(user);
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ user: { id: user._id, name: user.name, email: user.email, picture: user.picture, role: user.role || 'ADMIN' } });
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
    res.json({ user: { id: decoded.id, name: decoded.name, email: decoded.email, role: decoded.role || 'ADMIN' } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// ---------- Logout ----------
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ message: 'Logged out.' });
});

export default router;
