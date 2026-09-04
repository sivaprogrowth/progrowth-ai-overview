import type { Metadata } from "next";
import localFont from "next/font/local";
import InternalChrome from "@/components/InternalChrome";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "ProGrowth AI Overview",
  description: "Analyze website visibility across AI chatbots",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Floating client switcher — hidden when only the default client
            exists, so single-tenant usage stays unchanged. Also hidden
            entirely on /grader/* — see components/InternalChrome.tsx. */}
        <InternalChrome />
        {children}
      </body>
    </html>
  );
}
