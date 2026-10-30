import { permanentRedirect } from "next/navigation";

import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Key Concepts - ANU Docs (Moved)",
  description:
    "Core concepts for using ANU — workspace, skills, memory, channels, and assistant identity explained.",
  path: "/docs/getting-started/key-concepts",
});

export default function KeyConceptsPage() {
  permanentRedirect("/docs/key-concepts");
}
