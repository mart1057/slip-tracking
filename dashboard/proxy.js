// ถ้าตั้ง DASHBOARD_PASSWORD ไว้ ทุกหน้าจะถามรหัสผ่าน (ชื่อผู้ใช้ใส่อะไรก็ได้)
import { NextResponse } from 'next/server';

export function proxy(request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    if (decoded.slice(decoded.indexOf(':') + 1) === password) return NextResponse.next();
  }
  return new NextResponse('ต้องใส่รหัสผ่านเพื่อเปิด dashboard', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="slip-tracker", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
