'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'ภาพรวม', match: (p) => p === '/' },
  { href: '/slips', label: 'รายการสลิป', match: (p) => p.startsWith('/slips') },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(pathname) ? 'page' : undefined}>{l.label}</Link>
      ))}
    </nav>
  );
}
