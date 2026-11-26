/**
 * Role-based access control. The server enforces these on every route; the client
 * receives the same map (via /api/auth/me) only to hide buttons it cannot use.
 */
export const ROLES = ['admin', 'manager', 'accountant', 'operator'];
export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', accountant: 'Accountant', operator: 'Operator' };

const ALL = ROLES;
const FIN = ['admin', 'manager', 'accountant'];
const MGR = ['admin', 'manager'];
const OPS = ['admin', 'manager', 'operator'];

export const PERMISSIONS = {
  materials: { read: ALL, write: MGR, remove: MGR },
  parties: { read: ALL, write: ALL, remove: MGR },
  vehicles: { read: ALL, write: OPS, remove: MGR },
  employees: { read: [...MGR, 'accountant'], write: MGR, remove: MGR },
  sales: { read: ALL, write: ALL, remove: MGR },
  credit_notes: { read: FIN, write: FIN, remove: MGR },
  weighments: { read: ALL, write: ALL, remove: MGR },
  royalty_permits: { read: FIN, write: FIN, remove: MGR },
  diesel_logs: { read: ALL, write: ALL, remove: MGR },
  maintenance: { read: ALL, write: ALL, remove: MGR },
  purchases: { read: FIN, write: FIN, remove: MGR },
  production: { read: ALL, write: OPS, remove: MGR },
  expenses: { read: FIN, write: FIN, remove: MGR },
  payments: { read: FIN, write: FIN, remove: MGR },
  stock: { read: ALL },
  ledger: { read: FIN },
  finance: { read: FIN }, // money figures on dashboard, reports
  attendance: { read: OPS, write: OPS },
  payroll: { read: FIN },
  payroll_adjustments: { read: FIN, write: FIN, remove: FIN },
  settings: { read: ALL, write: ['admin'] },
  users: { read: ['admin'], write: ['admin'] },
  audit: { read: ['admin'] },
  backup: { read: ['admin'], write: ['admin'] },
};

export const can = (role, area, action = 'read') => Boolean(PERMISSIONS[area]?.[action]?.includes(role));

export function permissionsFor(role) {
  const out = {};
  for (const [area, acts] of Object.entries(PERMISSIONS)) {
    out[area] = Object.fromEntries(Object.keys(acts).map(a => [a, acts[a].includes(role)]));
  }
  return out;
}
