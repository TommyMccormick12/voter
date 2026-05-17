import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { ConsentBanner } from "@/components/ConsentBanner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ballotmatch.org",
  ),
  title: "Voter - Compare Your Candidates",
  description:
    "Compare candidates running in your district. See where they stand on the issues that matter most to you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Nav />
        {children}
        <footer className="max-w-5xl mx-auto px-4 py-6 mt-12 border-t border-gray-100 text-xs text-gray-500 flex flex-wrap gap-2 justify-center">
          <Link
            href="/privacy"
            className="hover:text-gray-900 inline-flex items-center min-h-[44px] px-3"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="hover:text-gray-900 inline-flex items-center min-h-[44px] px-3"
          >
            Terms
          </Link>
          <Link
            href="/data-rights"
            className="hover:text-gray-900 inline-flex items-center min-h-[44px] px-3"
          >
            Your data choices
          </Link>
        </footer>
        <ConsentBanner />
      </body>
    </html>
  );
}
