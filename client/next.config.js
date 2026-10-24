/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendHost = process.env.BACKEND_HOST || 'http://localhost:4000';
    return [
      {
        source: '/socket.io/:path*',
        destination: `${backendHost}/socket.io/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${backendHost}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendHost}/uploads/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
