import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeSync } from "@/components/cloner/theme-toggle";
import { Toaster } from "@/components/ui/toast";
import { THEME_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SiteCloner",
  description: "Clone a website from its URL, refine it with AI, export the code, and publish a link.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme script sets a class on <html> before React hydrates it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ThemeSync />
        <Toaster />
      </body>
    </html>
  );
}
