import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Operations",
  description: "Steps, tips, videos and knowledge for every operation.",
  applicationName: "Operations",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "Operations", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#F1F1EF", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* The theme chosen on this device, before anything paints. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("op-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`,
          }}
        />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
