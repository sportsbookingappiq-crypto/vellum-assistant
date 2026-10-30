import { SkillsAndToolsConceptsContent } from "@/app/docs/_components/skills-and-tools-concepts-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Tools & Skills - ANU Docs",
  description:
    "Skills vs. tools in ANU — atomic actions, capability bundles, built-in skills, and creating custom skills.",
  path: "/docs/key-concepts/skills-and-tools",
});

export default function SkillsAndToolsPage() {
  return <SkillsAndToolsConceptsContent />;
}
