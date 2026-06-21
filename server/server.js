import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import locationsRoutes from './routes/locations.js';
import menuRoutes from './routes/menu.js';
import uploadRoutes from './routes/upload.js';
import categoriesRoutes from './routes/categories.js';
import settingsRoutes from './routes/settings.js';
import ordersRoutes from './routes/orders.js';
import { initWebSocket } from './websocket.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Allowed origins for CORS — add your production domain here
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  process.env.FRONTEND_URL, // Set this in .env for production
].filter(Boolean);

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://checkout.razorpay.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https://accounts.google.com", "https://api.razorpay.com"],
      frameSrc: ["'self'", "https://accounts.google.com", "https://checkout.razorpay.com", "https://api.razorpay.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Additional custom security headers (Permissions-Policy)
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), interest-cohort=()");
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    
    const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isVercel = origin.endsWith('.vercel.app');
    
    if (isLocal || isVercel || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Body parsing with size limits (M5 fix)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/orders', ordersRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start
async function start() {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
  initWebSocket(server);
}

if (!process.env.VERCEL) {
  start().catch(console.error);
}

export default app;
