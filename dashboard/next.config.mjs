const API_URL = process.env.API_URL || 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // เบราว์เซอร์เรียก /backend/... แล้ว Next ส่งต่อให้ API ของ bot ซึ่งฟังเฉพาะในเครื่อง
  async rewrites() {
    return [{ source: '/backend/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
