import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skilled Hire | Canada's Verified On-Demand Trade Services (skilledhire.ca)",
  description: "Book certified, licensed, and background-checked trade professionals across Canada with transparent pricing and milestone escrow protection.",
  metadataBase: new URL("https://skilledhire.ca"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Skilled Hire | Canada's Verified On-Demand Trade Services",
    description: "Book certified, licensed, and background-checked trade professionals across Canada on skilledhire.ca.",
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
