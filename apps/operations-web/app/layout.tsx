import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skilled Hire | Operations & Dispatch Console (skilledhire.ca)",
  description: "Operations qualification, candidate ranking, quote audit, and technician dispatch for Skilled Hire on skilledhire.ca.",
  metadataBase: new URL("https://skilledhire.ca"),
  alternates: {
    canonical: "/operations",
  },
  openGraph: {
    title: "Skilled Hire | Operations & Dispatch Console",
    description: "Operations qualification and technician dispatch on skilledhire.ca.",
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
