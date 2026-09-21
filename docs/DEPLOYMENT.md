# TechOffice Deployment Guide

## 1. Overview

TechOffice is built on Next.js 16 with Turbopack and is optimized for deployment on **Vercel** paired with **Supabase PostgreSQL**.

---

## 2. Environment Variables Checklist

Ensure the following variables are configured in your Vercel Project Settings under **Settings > Environment Variables**:

| Variable | Description | Required Environment | Example / Format |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Supabase Session Pooler connection string (Port 6543) | Production, Preview | `postgresql://postgres.[REF]:[PASS]@aws-1-[REG].pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Direct PostgreSQL connection string (Port 5432) | Production, Preview | `postgresql://postgres.[REF]:[PASS]@aws-1-[REG].pooler.supabase.com:5432/postgres` |
| `NEXTAUTH_URL` | Canonical application URL | Production, Preview | `https://your-app.vercel.app` (or `https://$VERCEL_URL`) |
| `NEXTAUTH_SECRET` | 32-character random secret key | Production, Preview | Generated with `openssl rand -base64 32` |
| `DEMO_MODE` | Bypass strict login checks for sandbox viewing | Preview only | `"true"` or `"false"` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase REST URL | Production, Preview | `https://[REF].supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Supabase public client anonymous key | Production, Preview | `ey...` |

---

## 3. Vercel Deployment

### 3.1 Automatic Git Deployments
1. Connect your GitHub repository (`OmarSeif8/TechOfficeTest`) on the [Vercel Dashboard](https://vercel.com).
2. **Production Branch**: Pushes to `main` deploy directly to your production URL.
3. **Preview Branches**: Pushes to any other branch (such as `debug/investigation`) automatically trigger an isolated **Preview Deployment** with a unique staging URL.

### 3.2 Build Settings
Vercel automatically detects Next.js. The standard configuration:
* **Framework Preset**: Next.js
* **Build Command**: `next build`
* **Output Directory**: `.next`
* **Install Command**: `npm install` (or `bun install`)

### 3.3 Deploying via Vercel CLI
To deploy directly from your local terminal:
```powershell
# Authenticate
npx vercel login

# Deploy a Preview instance
npx vercel

# Promote to Production
npx vercel --prod
```

---

## 4. Post-Deployment Database Initialization

When pointing to a fresh database:
1. **Push Schema**:
   ```bash
   npx prisma db push
   ```
2. **Seed Master Reference Data**:
   ```bash
   npx tsx prisma/seed.ts
   ```
   This populates units, categories, item library records, and calculation templates.
