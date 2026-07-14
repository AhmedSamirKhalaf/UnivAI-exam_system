/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      ort: 'onnxruntime-web',
    },
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.alias.ort = require.resolve('onnxruntime-web');
    return config;
  },
};

module.exports = nextConfig;
