import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  icons: {
    icon: "/favicon.ico"
  },
  title: "Slate",
  description: "A realtime workspace for shipping software together."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-theme="dark" lang="en">
      <body>{children}</body>
    </html>
  );
}
