import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skilled Hire | Platform Administration & Trust Governance (skilledhire.ca)",
  description: "Platform policy configuration, statutory trade compliance registry, and audit logging for Skilled Hire on skilledhire.ca.",
  metadataBase: new URL("https://skilledhire.ca"),
  alternates: {
    canonical: "/admin",
  },
  openGraph: {
    title: "Skilled Hire | Platform Administration & Trust Governance",
    description: "Policy configuration and statutory compliance governance on skilledhire.ca.",
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
