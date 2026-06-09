# GeoAsset Cloud
## Field Asset Management System for Indian Discoms

A production-ready, cloud-deployed GIS field survey app for electricity distribution companies.

**Stack:** React 18 + Supabase (PostgreSQL + Auth) + Netlify

---

## 🚀 DEPLOY IN 20 MINUTES

### Step 1 — Supabase (Database + Auth)

1. Go to **supabase.com** → Create account → New project
2. Name it `geoasset`, set a strong DB password, choose region **South Asia (ap-south-1)**
3. Wait ~2 minutes for project to provision
4. Go to **SQL Editor** → click **New Query**
5. Open `sql/schema.sql` from this project → paste entire contents → click **Run**
6. You should see: `Success. No rows returned`
7. Go to **Project Settings → API**
8. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_ANON_KEY`

### Step 2 — GitHub

1. Create a new GitHub repository (public or private)
2. Upload all project files to it (drag and drop on GitHub.com works)

### Step 3 — Vercel (Frontend Hosting)

1. Go to **vercel.com** → Create account (use GitHub login)
2. Click **Add New → Project → Import Git Repository**
3. Select your repository
4. Build settings are auto-detected from `vercel.json` — no changes needed
5. Click **Environment Variables** → add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
6. Click **Deploy**
7. Wait ~1 minute → you get a URL like `https://geoasset.vercel.app`

### Step 4 — First Run Setup

1. Open your Netlify URL on any phone or browser
2. Click **"First time? Setup organisation"**
3. Fill in:
   - Organisation name (JVVNL / AVVNL / etc.)
   - Division name
   - City, State
   - Map centre coordinates (from Google Maps)
   - Subdivisions (code + name)
4. Create your admin account (email + password)
5. Click **Create & Start** → you'll be redirected to login
6. Login with your admin email and password
7. **GPS works immediately** — app is on HTTPS so browser GPS permission is granted

---

## ✨ FEATURES

- 📡 **Survey** — GPS capture (live accuracy bar), inline map picker, manual coords
- 🗺️ **Map** — All assets on Leaflet/OSM map, feeder filter, ₹ outstanding markers
- 🏗️ **Assets** — Search, filter by type/outstanding, flag, call consumer, WhatsApp notice
- ⚡ **Feeders** — Create/edit/delete feeders, live stats, load bar
- 🔧 **Work Orders** — Create with asset picker, sag calculator, WhatsApp share
- 📋 **Measurement Books** — Create, submit, approve, PDF download
- 👥 **Users** — Manage field staff (admin/sdo only), role-based access
- 💰 **Outstanding Groups** — Group high outstanding consumers, view on map, WhatsApp recovery notices
- 📊 **Recovery Import** — Upload CSV/JSON with K.No + outstanding → auto-matches to meters

---

## 👤 ROLE PERMISSIONS

| Role | Survey | Approve MB | Manage Users | Delete |
|------|--------|------------|--------------|--------|
| Feeder Incharge | ✅ | ❌ | ❌ | ❌ |
| JE | ✅ | ❌ | ❌ | ❌ |
| AO | ❌ | ✅ | ❌ | ❌ |
| SDO | ✅ | ✅ | ✅ | ❌ |
| Admin | ✅ | ✅ | ✅ | ✅ |

---

## 📱 MOBILE INSTALL (PWA)

On Android Chrome:
1. Open the Netlify URL
2. Chrome shows "Add to Home Screen" banner → tap it
3. App installs like a native app with icon

On iPhone Safari:
1. Open the URL in Safari
2. Tap Share → Add to Home Screen

---

## 📋 ASSET TYPES

| Type | Fields |
|------|--------|
| Pole | Number, Type (PCC/PSC/Wood), Height, Line type |
| DTR | Number, Capacity (kVA), Voltage, Make, Load%, Consumers |
| Meter | K.No., Consumer, Category, Make, Mobile, Outstanding ₹ |
| Line | From/To pole, Conductor, Span length |
| Pillar | Unit no., Type, Rating |
| Isolator | Number, Type (ABS/DOF/Gang), Voltage, Status |

---

## 📐 SAG CALCULATOR

Built into Work Order form for Cable Sag issues:
- Select From/To pole (auto-calculates span from GPS coordinates)
- Choose conductor: ACSR Weasel/Dog/Rabbit/Panther
- Enter pole height
- Calculates: sag (m), resultant sag, ground clearance
- IE Act verdict: ✅ OK / ⚠ Warning / 🔴 Critical

---

## 🔄 DATA RECOVERY IMPORT

Upload a JSON or CSV file with:
```json
[
  { "k_number": "K-00123456", "outstanding_amount": 4820, "mobile": "9414511001" },
  { "k_number": "K-00123789", "outstanding_amount": 28450, "last_payment_date": "2025-07-22" }
]
```
CSV columns: `k_number, outstanding_amount, mobile, consumer_name, last_payment_date`

The app matches by K.No. → updates outstanding + mobile on matched meter assets.

---

*GeoAsset Cloud v1.0 — Built for JVVNL Jhalawar Division, deployable for any Indian Discom*
