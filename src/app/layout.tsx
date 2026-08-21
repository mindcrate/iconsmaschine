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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
