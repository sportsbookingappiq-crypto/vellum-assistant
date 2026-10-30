import { SkillsReferenceDoorDashContent } from "@/app/docs/_components/skills-reference-door-dash-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "DoorDash - ANU Docs",
  description:
    "DoorDash skill for ANU — order food, groceries, and convenience items through your assistant.",
  path: "/docs/skills-reference/doordash",
});

export default function SkillsReferenceDoorDashPage() {
  return <SkillsReferenceDoorDashContent />;
}
