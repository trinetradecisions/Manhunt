/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Only proxy if an external backend host is explicitly specified
    if (process.env.BACKEND_HOST) {
      return [
        {
          source: '/socket.io/:path*',
          destination: `${process.env.BACKEND_HOST}/socket.io/:path*`,
        },
        {
          source: '/uploads/:path*',
          destination: `${process.env.BACKEND_HOST}/uploads/:path*`,
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
