import { HostingOptionsContent } from "@/app/docs/_components/hosting-options-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Hosting options - ANU Docs",
  description:
    "Choose where your assistant runs: ANU Cloud (recommended), local on your Mac or Windows PC, or self-hosted on your own infrastructure.",
  path: "/docs/hosting-options",
});

export default function HostingOptionsPage() {
  return <HostingOptionsContent />;
}
