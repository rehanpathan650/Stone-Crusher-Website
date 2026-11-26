'use client';
/**
 * Small adapter so the screens keep the familiar router API on top of Next.js navigation:
 * useNavigate, useParams, useSearchParams ([params, setParams]), useLocation, Link (to=…) and NavLink (active state).
 */
import { useCallback, useMemo } from 'react';
import NextLink from 'next/link';
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';

export function useNavigate() {
  const router = useRouter();
  return useCallback((to, opts = {}) => (opts.replace ? router.replace(to) : router.push(to)), [router]);
}

export const useParams = () => useNextParams() || {};

export function useLocation() {
  return { pathname: usePathname() || '/' };
}

/** Returns [URLSearchParams, setParams(objectOrParams, { replace })] like react-router. */
export function useSearchParams() {
  const params = useNextSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const current = useMemo(() => new URLSearchParams(params?.toString() || ''), [params]);
  const setParams = useCallback((next, opts = {}) => {
    const qs = new URLSearchParams(next instanceof URLSearchParams ? next : Object.entries(next || {})).toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (opts.replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }, [pathname, router]);
  return [current, setParams];
}

export function Link({ to, href, ...rest }) {
  return <NextLink href={to ?? href} {...rest} />;
}

/** Link that knows whether it points at the current page; children may be a function of { isActive }. */
export function NavLink({ to, end, className, children, ...rest }) {
  const pathname = usePathname() || '/';
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const cls = [typeof className === 'function' ? className({ isActive }) : className, isActive ? 'active' : ''].filter(Boolean).join(' ');
  return (
    <NextLink href={to} className={cls || undefined} aria-current={isActive ? 'page' : undefined} {...rest}>
      {typeof children === 'function' ? children({ isActive }) : children}
    </NextLink>
  );
}
