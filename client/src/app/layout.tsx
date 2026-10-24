import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Manhunt Web | Real-World GPS Pursuit Multiplayer',
  description: 'Real-world mobile GPS multiplayer pursuit and hide-and-seek web game.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-neutral-100 antialiased flex flex-col justify-between">
        {children}
      </body>
    </html>
  );
}
