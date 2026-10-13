import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skilled Hire | Contractor & Trade Operations (skilledhire.ca)",
  description: "Dispatch management, active workboard, and statutory compliance verification for licensed trade contractors on skilledhire.ca.",
  metadataBase: new URL("https://skilledhire.ca"),
  alternates: {
    canonical: "/contractor",
  },
  openGraph: {
    title: "Skilled Hire | Contractor & Trade Operations",
    description: "Dispatch management and compliance verification on skilledhire.ca.",
    url: "https://skilledhire.ca",
    siteName: "Skilled Hire",
    locale: "en_CA",
    type: "website",
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f8fafc" }}>{children}</body>
    </html>
  );
}
