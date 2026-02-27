import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zitata Transcription",
  description: "Recherche dans les transcriptions d'émissions TV",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-blue-600">
              Zitata Transcription
            </a>
            <div className="flex gap-4">
              <a href="/" className="text-gray-600 hover:text-blue-600">
                Recherche
              </a>
              <a href="/youtube" className="text-gray-600 hover:text-blue-600">
                Vidéos
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
