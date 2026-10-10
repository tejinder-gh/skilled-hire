import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skilled Hire | Home Services Booking | skilledhire.ca",
  description: "Request home services, review job details and manage appointments in one place. Technician eligibility and availability are confirmed for each booking.",
  metadataBase: new URL("https://skilledhire.ca"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Skilled Hire | Home Services Booking",
    description: "Request home services and manage service appointments on skilledhire.ca.",
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
