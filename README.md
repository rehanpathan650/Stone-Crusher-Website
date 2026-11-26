# Stone Crusher Business Manager

A full-stack web app for running a stone crusher business. It covers sales and dispatch, purchases, production, stock, expenses, payments, customer and supplier ledgers, attendance and payroll, and reports. It has user accounts, role-based access and an audit trail.

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, React Router. Plain CSS design system with no UI framework |
| API | Node.js 22, Express 5, Zod validation |
| Database | SQLite for a single machine or a quick start. PostgreSQL for production, chosen with one setting (`DATABASE_URL`). Knex query builder and migrations |
| Deployment | Docker, docker-compose (PostgreSQL + app + Caddy with automatic HTTPS) |

---

## 1. Run it on your computer (quick start)

Requirements: [Node.js 20 or newer](https://nodejs.org).

```powershell
cd "E:\Stone Crusher App"
npm run setup
```
This installs the dependencies once.

```powershell
npm run build
```
This builds the web interface.

```powershell
npm start
```
This starts the app at http://localhost:4000.

1. On the first start, the console prints a **setup code**:
   `>>> First-run setup code: Xyz123...`
2. Open http://localhost:4000, enter that code, and create the **admin** account.
3. Sign in. Then go to **Users & Access** and add accounts for your staff.

Data is stored in `server\data\app.db`. Back up that file, or use PostgreSQL (see below).

Optional demo data (45 days of sample sales, production and expenses, only into an empty database). Stop the server first:
```powershell
npm run seed:demo
```

### Development mode (live reload)
Run these in two terminals:
```powershell
npm run dev:api
```
```powershell
npm run dev:web
```
Then open http://localhost:5173. The web dev server sends `/api` requests to the API on port 4000.

---

## 2. Production deployment (server with a domain, HTTPS, PostgreSQL)

Requirements: a Linux server or PC with Docker, and a domain name pointing to it (ports 80 and 443 open).

```bash
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs app | grep "setup code"
```
In `.env`, set `DOMAIN` and a long `POSTGRES_PASSWORD`. The last command shows the first-run setup code.

Open `https://your-domain`. Caddy obtains and renews the HTTPS certificate automatically.

* **Backups:** the app writes a backup every day to the `appdata` volume (the newest 14 are kept). Admins can download one at any time, or restore one, under **Backup & Restore**. Copy a backup off the server regularly. For a database-level copy you can also run `docker compose exec db pg_dump -U crusher crusher > backup.sql`.
* **Updates:** run `git pull`, then `docker compose up -d --build`. Database migrations run automatically on start.
* **Reliability:** the app waits for the database at start-up, logs and restarts on unexpected crashes (Docker restart policy), shuts down gracefully, and Docker keeps at most 50 MB of logs per container.
* **Tests:** `cd server && npm test` starts a throwaway server and database and runs the integration suite (security, invoicing, weighbridge, machinery, payroll, reports and backup). Run it before every update.
* **Before going live:** delete `LOGINS.txt` once everyone has signed in and chosen their own password, keep `.env` private, and keep the project in version control (git) so every change can be reviewed and rolled back.
* **Scaling:** the app is stateless. Sessions are stored in PostgreSQL, so you can run several `app` containers behind the proxy. The rate limiter is per instance. Use a shared store such as Redis if you run many instances.

---

## 3. Security

| Area | What's in place |
|---|---|
| Passwords | Hashed with **scrypt** (memory-hard, with a random salt per password). At least 10 characters with letters and numbers; common passwords (e.g. `Password@2026`) and passwords built from the person's own name or email are refused |
| Admin-set passwords | New accounts and admin resets must be replaced by the person at their next sign-in; until then every other screen and API call is blocked, so the admin never keeps knowing a staff password |
| Sessions | A random 256-bit token in an **HttpOnly, SameSite=Lax, Secure** cookie (`__Host-` prefix over HTTPS). Only its SHA-256 hash is stored in the database. Sessions end after 12 h idle or 7 days, and on logout. Signing in again ends the browser's previous session, and a password change signs out every other device |
| CSRF | A per-session token is required in the `X-CSRF-Token` header on every change |
| Brute force | Each account locks for 15 min after 5 failed sign-ins. Sign-in attempts are rate-limited per IP. All API calls are rate-limited too. Response time doesn't reveal whether an account exists |
| Access control | 4 roles (**Admin, Manager, Accountant, Operator**), enforced **on the server** for every route. Operators don't get profit, balances, ledgers, expenses, payments or reports from the API |
| Input | Every request body is validated with Zod. Unknown fields are dropped. All SQL is parameterised. Sort and filter columns are whitelisted |
| Business rules | Totals, GST and balances are always **recalculated on the server**. Party, material and stock checks run inside database transactions |
| Headers | Helmet with a strict **Content-Security-Policy** (no inline scripts), X-Frame-Options, nosniff, HSTS over HTTPS, a Permissions-Policy that denies camera/microphone/location/payment, `no-store` on API responses |
| Containers | The app runs as a non-root user on a **read-only filesystem** (only its data folder and `/tmp` are writable), with all Linux capabilities dropped and `no-new-privileges`. The database is never published to the host; the app port only on `127.0.0.1` |
| Dependencies | `npm audit` reports 0 known vulnerabilities in server and client (check again with `npm audit` after updates) |
| Audit | Sign-ins, failed sign-ins, lockouts, and every create, update, delete and export are recorded with user, time, IP and the changed fields |
| Exports | CSV and Excel cells are escaped against spreadsheet formula injection. Every export is recorded in the audit log |
| Uploads | The logo must be a PNG, JPEG or WebP of 300 KB or less. The file's real content is checked, not just its name |
| Backup & restore | Admin only. A restore needs the word RESTORE typed to confirm. It only accepts a backup made by the same app version, checks every table and column, runs in one transaction (all or nothing) and signs everyone out. Backup files contain password hashes, so keep them private |
| Money fields | Operators never receive costs: diesel rate and cost, repair costs, payroll, credit notes, royalty, cash/bank books and finance reports are blocked on the server, and any cost an operator sends is ignored |
| First run | The admin can only be created with the one-time setup code from the server console |
| Errors | No stack traces or SQL are ever sent to the browser. Logs are structured JSON with no request bodies |
| Account recovery | An admin can reset passwords and unlock accounts. With access to the server, you can also run `npm run create-admin -- --email you@example.com` |

### Roles
| Role | Can do |
|---|---|
| Admin | Everything, including users, business settings, the audit log and backup/restore |
| Manager | All business data and reports. Can delete records |
| Accountant | Sales, credit notes, purchases, expenses, payments, ledgers, payroll, royalty, reports, GST |
| Operator | Dispatch entry (with weighbridge), production and downtime, attendance and overtime, stock, diesel litres and meter readings, breakdown reports. No money totals, costs, balances, ledgers, payroll or reports |

---

## 4. Features

**Sales & billing**
* **GST tax invoices** numbered per financial year (`INV/2026-27/0001`). CGST + SGST within your state, IGST for other states (taken from the customer's GSTIN, or their state). HSN codes and amount in words. A **Bill of Supply** is printed when there's no GST.
* **Delivery details** on every dispatch: driver, delivery site and status (on the way / delivered).
* **Customer credit limits:** a bill that takes a customer over their limit is stopped; managers, accountants and admins can approve it, operators can't.
* **Delivery challan** (quantities only) and **credit notes** for returns or rate corrections. Credit notes put stock back and reduce the customer's balance.
* **Print / Save as PDF** with your logo, bank details and terms. Share by **WhatsApp** or **email** in one click.

**Weighbridge**
* **Weighbridge register:** loaded, empty and re-weighments with automatic slip numbers (`WB/2026-27/0001`) and time. An empty weighment saves the vehicle's tare for later slips.
* **Printable weighment slip**, and **"Create bill from this slip"**: the bill takes its weights from the slip (they can't be changed on the bill), and each slip can be billed only once. The dashboard shows slips not billed yet.

**Dispatch, vehicles & royalty**
* **Weighbridge entry:** gross − tare = net weight. For materials sold by the ton, the net weight becomes the quantity. The tare is pre-filled from the vehicle.
* **Vehicle register** (own or hired, with owner and freight per trip). Freight for hired vehicles is added to the owner's balance and ledger.
* **Trips & freight report** per vehicle.
* **Royalty / e-Rawanna pass number** on every dispatch, a permit register, a live balance in tons, a low-balance alert, and a count of dispatches without a pass.

**Machinery**
* **Diesel log** with litres, rate and odometer or hour-meter reading. Shows **fuel efficiency** (km/L or L/hr) and flags **unusually high consumption**. A meter reading lower than the last one is rejected.
* **Maintenance log:** services, repairs, breakdowns, parts and labour cost, downtime, and the next service date or reading. **Service due** reminders.
* Diesel and maintenance costs automatically create the matching expense, so profit and loss stays correct.

**Labour & payroll**
* Daily attendance with **overtime hours**. Monthly payroll: basic pay for paid days + overtime + bonus − deductions.
* **Advances** carry forward until they're recovered. **Printable wage slip.** One-click salary or advance payment.

**Finance & reports**
* **Outstanding ageing** (0–30 / 31–60 / 61–90 / 90+ days) with WhatsApp payment reminders.
* **Cash book and bank book** with opening balance and **daily closing**.
* **GST returns summary** (GSTR-1 style): B2B by invoice, B2C by rate, HSN summary, credit notes, **input tax from purchase bills and net GST payable**. Exportable.
* **Purchases** record the supplier's bill number and GST; profit and loss counts purchases without the recoverable input GST.
* **Stock movement ledger** per material: every purchase, production, return, crushing use and dispatch with a running balance (click a material on the Stock page).
* Profit & loss (net of credit notes), cash flow, plant **yield %**, running vs **downtime hours** by reason, and **availability %**.
* **Excel (.xlsx) and CSV export** on every list and report. Quick periods for this month, last month, this financial year and last financial year.

**Platform**
* **Alerts bell:** low stock, service due, high diesel use, low royalty balance, overdue payments and large expenses. Each person only sees what their role allows.
* **Backup & restore** for admins, plus an automatic **daily backup** (newest 14 kept).
* **Business settings:** logo, GSTIN, state, bank and UPI details, invoice terms, numbering prefixes, opening cash and bank balances, and alert levels.
* **Passwords:** admins reset passwords and unlock accounts under Users & Access.

**Ease of use**
* **Ctrl+K** search to jump to any page or start a new entry.
* Searchable dropdowns for customers, materials and vehicles. **Enter** moves to the next field and **Ctrl+Enter** saves. Unsaved new entries are kept as a draft.
* Sortable columns, sticky table headers, totals, loading placeholders and empty states.
* **Dark mode** (or follow the system) from the user menu.
* On a phone: a bottom bar with a big **Dispatch** button, and large touch targets. The app can be added to the home screen.
* Motion is kept subtle and switches off if the phone or PC is set to reduce motion.

## 5. Project layout
```
client/            React app (src/pages, src/components, src/resources.jsx = module definitions)
server/
  src/app.js       Express setup, security middleware, error handling
  src/auth/        sessions, CSRF, role permissions
  src/routes/      auth, users, generic CRUD, business (dashboard, stock, attendance, settings…),
                   reports (ageing, cash book, GST), admin (backup/restore)
  src/services/    stock & balances, payroll, linked expenses, backups
  src/lib/gst.js   states, financial year, CGST/SGST/IGST split, document numbering
  src/lib/xlsx.js  dependency-free Excel writer
  src/resources.js validation schemas + business rules per module
  src/migrations/  database schema (one file per upgrade; never edit an old one)
  scripts/         seed-demo, create-admin
Dockerfile, docker-compose.yml, Caddyfile
```
