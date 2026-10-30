import { SkillsReferenceAmazonContent } from "@/app/docs/_components/skills-reference-amazon-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Amazon - ANU Docs",
  description:
    "Amazon skill for ANU — shop, track orders, and manage your Amazon account through your assistant.",
  path: "/docs/skills-reference/amazon",
});

export default function SkillsReferenceAmazonPage() {
  return <SkillsReferenceAmazonContent />;
}
