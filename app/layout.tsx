import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifePilot",
  description: "Your AI life-admin assistant. Say what needs doing; LifePilot plans, reminds and follows up.",
  appleWebApp: { capable: true, title: "LifePilot", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F5F2EC" }, { media: "(prefers-color-scheme: dark)", color: "#0C101C" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
