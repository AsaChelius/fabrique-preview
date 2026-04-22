import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RouteNav } from "@/components/ui/route-nav";
import { SmoothScroll } from "@/components/ui/smooth-scroll";
import { WarpOverlay } from "@/components/ui/warp-overlay";
import { VortexFadeOverlay } from "@/components/ui/vortex-fade-overlay";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FABRIQUE — Edouard & Asa",
  description:
    "A small studio building interactive, physics-driven sites and apps.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        {/* Persistent starfield backdrop — sits behind every route so the
            moment during route transitions when canvases unmount/mount
            never shows a black void. */}
        <div aria-hidden className="site-backdrop" />
        <SmoothScroll />
        <div className="brand">
          <strong>FABRIQUE</strong>
        </div>
        <RouteNav />
        {children}
        <WarpOverlay />
        <VortexFadeOverlay />
      </body>
    </html>
  );
}
