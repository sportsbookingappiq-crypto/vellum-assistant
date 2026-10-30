import { HomepageContent } from "@/app/docs/_components/homepage-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Homepage - ANU Docs",
  description:
    "ANU documentation — guides, tutorials, and references for building your personal AI assistant.",
  path: "/docs",
});

export default function DocsPage() {
  return <HomepageContent />;
}
