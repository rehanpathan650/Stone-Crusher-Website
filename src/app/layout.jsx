import { headers } from 'next/headers';
import '@fontsource-variable/inter';
import '../ui/styles.css';
import { Providers } from '../ui/Shells.jsx';

export const metadata = {
  title: 'Stone Crusher Manager',
  description: 'Dispatch, weighbridge, GST billing, stock, machinery, payroll and accounts for a stone crusher.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg' },
  referrer: 'same-origin',
  other: { 'mobile-web-app-capable': 'yes' },
};
export const viewport = {
  width: 'device-width', initialScale: 1, colorScheme: 'light dark',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f6f5f2' }, { media: '(prefers-color-scheme: dark)', color: '#11100e' }],
};

// Applies the saved light/dark choice before the first paint (no flash). Allowed by the per-request CSP nonce.
const THEME_SCRIPT = "try{var t=localStorage.getItem('scm.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default async function RootLayout({ children }) {
  const nonce = (await headers()).get('x-nonce') || undefined; // reading headers also keeps every page dynamic (needed for nonces)
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
