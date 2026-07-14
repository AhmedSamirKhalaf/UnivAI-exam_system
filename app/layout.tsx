import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Exam Monitoring System',
  description: 'AI-powered exam proctoring — all processing is local.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
