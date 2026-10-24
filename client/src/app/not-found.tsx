import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0F1923] text-white flex flex-col items-center justify-center p-4 font-mono text-center">
      <h2 className="text-2xl font-bold text-[#FF4655] mb-2">404 — SECTOR NOT FOUND</h2>
      <p className="text-neutral-400 text-xs mb-4">The tactical coordinates you requested could not be located.</p>
      <Link
        href="/"
        className="px-4 py-2 rounded-xl bg-[#293440] hover:bg-[#3B4652] text-xs font-bold text-white uppercase border border-[#3B4652] transition-colors"
      >
        Return to Command
      </Link>
    </div>
  );
}
