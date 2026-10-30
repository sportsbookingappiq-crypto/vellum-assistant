import { GettingStartedContent } from "@/app/docs/_components/getting-started-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Installation - ANU Docs",
  description:
    "Get started with ANU: sign up for ANU Cloud, install the iOS or Android app, the macOS or Windows desktop app, or self-host. System requirements, setup, and permissions.",
  path: "/docs/getting-started/installation",
});

export default function InstallationPage() {
  return <GettingStartedContent />;
}
