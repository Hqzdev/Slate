import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  },
  title: "Slate",
  description: "A realtime workspace for shipping software together."
};

const themeScript = `
try {
  var key = "slate-workspace-theme";
  var storedTheme = window.localStorage.getItem(key);
  var theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
} catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-theme="light" lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Inter+Tight:wght@400;500&family=Newsreader:opsz,wght@6..72,400&display=swap"
        />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
