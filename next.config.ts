import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    // Windows TLS: next/font Google Fonts fetch fails without system certs
    turbopackUseSystemTlsCerts: true,
  },
  turbopack: {
    // Avoid picking C:\Users\User\package-lock.json as workspace root
    root: path.join(__dirname),
  },
};

export default nextConfig;
