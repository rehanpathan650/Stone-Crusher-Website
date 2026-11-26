'use client';
import DataPage from './DataPage.jsx';
import { Empty } from './ui.jsx';
import { RESOURCES } from '../resources.jsx';

/** List pages that exist as routes; anything else is a friendly "page not found". */
export const DATA_PAGES = ['sales', 'credit_notes', 'purchases', 'production', 'expenses', 'payments', 'parties', 'materials', 'vehicles',
  'employees', 'royalty_permits', 'diesel_logs', 'maintenance', 'weighments'];

export default function DataRoute({ name }) {
  if (!DATA_PAGES.includes(name) || !RESOURCES[name]) return <div className="card"><Empty title="Page not found" icon="search" /></div>;
  return <DataPage key={name} name={name} />;
}
