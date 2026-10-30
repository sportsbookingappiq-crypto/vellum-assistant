import { TrustSecurityPrivacyDataContent } from "@/app/docs/_components/trust-security-privacy-data-content";
import { createMetadata } from "@/lib/metadata";
import { routes } from "@/lib/routes";

export const metadata = createMetadata({
  title: "Privacy & Data - ANU Docs",
  description:
    "ANU privacy and data — what stays local, what leaves your device, and what ANU never does.",
  path: routes.docs.legal.privacyAndData,
});

export default function TrustSecurityPrivacyDataPage() {
  return <TrustSecurityPrivacyDataContent />;
}
