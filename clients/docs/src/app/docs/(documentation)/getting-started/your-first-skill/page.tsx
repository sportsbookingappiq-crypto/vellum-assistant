import { YourFirstSkillContent } from "@/app/docs/_components/your-first-skill-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Your First Skill - ANU Docs",
  description:
    "Use and create your first ANU skill — discover built-in skills, install new ones, and build custom skills.",
  path: "/docs/getting-started/your-first-skill",
});

export default function YourFirstSkillPage() {
  return <YourFirstSkillContent />;
}
