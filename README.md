# 🍽️ Food Menu & Real-Time Order Management System

A modern, responsive, and real-time digital food menu and order management application. Customers can scan table-specific QR codes to view the menu and place orders. Staff and administrators can manage categories, menu items, table QR codes, and monitor incoming orders in real-time.

---

## 🏗️ Project Architecture

The project is structured as a **Monorepo** with decoupled frontend and backend applications to allow independent scaling, development, and deployment:

```
├── backend/                # Express API & WebSocket Server
│   ├── routes/             # REST API endpoints
│   ├── middleware/         # Auth and error middleware
│   ├── db.js               # MongoDB connection
│   ├── server.js           # Server startup script
│   └── websocket.js        # WebSocket server for real-time notifications
│
├── frontend/               # Vite + React + Tailwind CSS Client
│   ├── src/
│   │   ├── pages/          # Admin Dashboard, Menu Manager, Order Scanner, Settings, etc.
│   │   ├── config.js       # Dynamic API & WS endpoint resolver
│   │   └── main.jsx        # App entry point
│   └── vercel.json         # Vercel routing & Content Security Policy (CSP) config
│
├── package.json            # Root configuration and utility scripts
└── README.md               # Main project documentation
```

* **Frontend**: React Single Page Application (SPA) built with Vite, styled with Tailwind CSS, and animated with Framer Motion. Deployed on **Vercel**.
* **Backend**: Node.js / Express application with WebSocket (`ws`) support. Stores data in **MongoDB** and handles file uploads via **Cloudinary**, authentication via **Google OAuth / custom JWTs**, and payments via **Razorpay**. Deployed on **Render**.

---

## ⚙️ Environment Configuration

Before running the application, you must configure environment variables for both the frontend and backend.

### 1. Backend Environment Setup (`backend/.env`)

Copy `backend/.env.example` to `backend/.env`:
```bash
cp backend/.env.example backend/.env
```

Define the following variables inside `backend/.env`:

| Key | Description | Example Value |
| :--- | :--- | :--- |
| `PORT` | Local port for the backend server | `5000` |
| `MONGODB_URI` | Connection string for MongoDB database | `mongodb+srv://...` or `mongodb://localhost:27017/foodmenu` |
| `MONGODB_DB` | MongoDB Database Name | `food-menu` |
| `JWT_SECRET` | Secret key used for signing JWT cookies | `super-secret-jwt-key` |
| `FRONTEND_URL` | Deployed Frontend URL (for production CORS) | `https://your-app.vercel.app` |
| `RAZORPAY_KEY_ID` | Razorpay API Public Key | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | Razorpay API Secret Key | `secret_...` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Storage Name (for images) | `cloud-name` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | `api-key` |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret Key | `api-secret` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID (backend verification) | `...apps.googleusercontent.com` |

---

### 2. Frontend Environment Setup (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env`:
```bash
cp frontend/.env.example frontend/.env
```

Define the following variables inside `frontend/.env`:

| Key | Description | Example Value |
| :--- | :--- | :--- |
| `VITE_API_URL` | Base API URL of your backend. Leave blank/omit in local development to route to relative proxied path `/api`. | `https://your-backend.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | Google Sign-in client credentials | `...apps.googleusercontent.com` |

---

## 🚀 Local Installation & Run Guide

### Prerequisite Tools
* **Node.js** (v18 or higher recommended)
* **npm** (v9 or higher)

### 1. Install Dependencies
Run the installation script from the **root directory** to fetch dependencies for both frontend and backend subdirectories:
```bash
npm run install:all
```
This automatically executes `npm install` inside the `frontend/` and `backend/` directories.

### 2. Run Locally in Development Mode
You can run the frontend and backend servers separately or using the root scripts:

#### Run Frontend Client
```bash
npm run dev:frontend
```
* Runs the Vite dev server at http://localhost:3000

#### Run Backend API Server
```bash
npm run dev:backend
```
* Runs the Express API server with hot-reload watch at http://localhost:5000

---

## 💻 GitHub Version Control Guide

Make sure your configuration files, secrets, and dependencies are not committed to GitHub. The project includes `.gitignore` files configured to ignore:
* `node_modules/`
* `dist/`
* `.env` files
* System log files (`*.log`)

To push your project to a new repository on GitHub:

1. **Initialize Git** (if not already done):
   ```bash
   git init
   ```
2. **Stage and Commit Files**:
   ```bash
   git add .
   git commit -m "Initial commit: separate frontend & backend monorepo structure"
   ```
3. **Add Remote Origin & Push**:
   ```bash
   git remote add origin https://github.com/your-username/your-repo-name.git
   git branch -M main
   git push -u origin main
   ```

---

## 🌐 Production Deployment Guides

### 1. Backend Deployment (Render)

Render is ideal for hosting Express and WebSocket servers.

1. Create a new **Web Service** on Render and link it to your GitHub repository.
2. Configure the following settings:
   * **Root Directory**: `backend`
   * **Runtime**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `node server.js` (or `npm start`)
3. Add the **Environment Variables** matching your `backend/.env` file in the Render dashboard:
   * `MONGODB_URI`
   * `MONGODB_DB`
   * `JWT_SECRET`
   * `FRONTEND_URL` (Set this to your Vercel deployment URL)
   * `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`
   * `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, & `CLOUDINARY_API_SECRET`
   * `GOOGLE_CLIENT_ID`

---

### 2. Frontend Deployment (Vercel)

Vercel is ideal for hosting static React apps built with Vite.

1. Import your repository into Vercel.
2. Configure the following settings during import:
   * **Root Directory**: `frontend`
   * **Framework Preset**: `Vite`
   * **Build Command**: `npm run build` (resolves to `vite build`)
   * **Output Directory**: `dist`
3. Add the **Environment Variables** in the Vercel dashboard:
   * `VITE_API_URL` (Set this to your Render service URL, e.g., `https://your-backend.onrender.com`)
   * `VITE_GOOGLE_CLIENT_ID`
4. Deploy the application. Vercel will automatically read `frontend/vercel.json` to configure:
   * Routes rewrite for Single Page App (`index.html`) routing.
   * Content Security Policies (CSP) and CORS headers to allow communication with Render APIs/WebSockets and Razorpay CDN scripts.

---

## 🛡️ CORS & Security Configuration

To ensure secure communication across domains in production, we have implemented the following policies:
* **CORS**: The backend (`backend/server.js`) restricts incoming cross-origin cookie-sharing requests. Whitelisted origins include `localhost:3000` and the URL defined in `FRONTEND_URL`.
* **Content Security Policy (CSP)**: Configure `frontend/vercel.json` and backend `helmet` headers to whitelist external CDNs used by the project:
  * Script sources: `https://checkout.razorpay.com`, `https://accounts.google.com`
  * Connection sources: `wss://your-backend.onrender.com` (WebSocket), `https://your-backend.onrender.com` (API REST)
