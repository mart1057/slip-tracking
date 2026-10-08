import '@fontsource-variable/anuphan';
import './globals.css';
import Link from 'next/link';
import Nav from './components/Nav';

export const metadata = {
  title: 'สมุดสลิป',
  description: 'ยอดรับโอนจากสลิป แยกตามธนาคาร เทียบเกณฑ์ส่งข้อมูลสรรพากร',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>
        <header className="topbar">
          <div className="wrap topbar-row">
            <Link href="/" className="brand">
              <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
                <rect width="32" height="32" rx="9" fill="var(--primary)" />
                <path d="M10 8.5h12a1.5 1.5 0 0 1 1.5 1.5v14l-3-2-2.5 2-2.5-2-2.5 2-3-2V10A1.5 1.5 0 0 1 10 8.5z" fill="#fff" />
                <path d="M12.5 13h7M12.5 16.5h4.5" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              สมุดสลิป
            </Link>
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
