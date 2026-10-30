import { ConstitutionContent } from "@/app/docs/_components/constitution-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "ANU Constitution - ANU Docs",
  description:
    "The ANU Constitution — our purpose, worldview, principles, and the commitments that guide every product, design, and engineering decision we make.",
  path: "/docs/constitution",
});

export default function ConstitutionPage() {
  return <ConstitutionContent />;
}
