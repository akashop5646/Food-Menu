import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import locationsRoutes from './routes/locations.js';
import menuRoutes from './routes/menu.js';
import uploadRoutes from './routes/upload.js';
import categoriesRoutes from './routes/categories.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/categories', categoriesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  start().catch(console.error);
}

export default app;
