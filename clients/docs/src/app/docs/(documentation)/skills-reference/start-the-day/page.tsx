import { SkillsReferenceStartTheDayContent } from "@/app/docs/_components/skills-reference-start-the-day-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Start the Day - ANU Docs",
  description:
    "Start the Day skill for ANU — get a personalized daily briefing with weather, news, and tasks.",
  path: "/docs/skills-reference/start-the-day",
});

export default function SkillsReferenceStartTheDayPage() {
  return <SkillsReferenceStartTheDayContent />;
}
