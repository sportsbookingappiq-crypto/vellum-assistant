import { WhatIsAnuContent } from "@/app/docs/_components/what-is-anu-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "What is ANU? - ANU Docs",
  description:
    "What is ANU? A personal AI assistant with tools, memory, identity, and a private cloud workspace, different from ChatGPT or Claude.",
  path: "/docs/getting-started/what-is-vellum",
});

export default function WhatIsAnuPage() {
  return <WhatIsAnuContent />;
}
