import { SkillsReferencePlaybooksContent } from "@/app/docs/_components/skills-reference-playbooks-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Playbooks - ANU Docs",
  description:
    "Playbooks skill for ANU — trigger-action automation rules for handling incoming messages.",
  path: "/docs/skills-reference/playbooks",
});

export default function SkillsReferencePlaybooksPage() {
  return <SkillsReferencePlaybooksContent />;
}
