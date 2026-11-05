import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Iconmaschine",
  description:
    "Build custom browser images for third-party Maschine kits, plugins and Kontakt libraries.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * `suppressHydrationWarning` is shallow - it only covers attributes React
   * finds on these two elements, not their children. Browser extensions
   * routinely inject attributes onto <html> and <body> before React hydrates
   * (e.g. data-xt-extension-active), which React would otherwise report as a
   * hydration mismatch the app can do nothing about.
   */
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
