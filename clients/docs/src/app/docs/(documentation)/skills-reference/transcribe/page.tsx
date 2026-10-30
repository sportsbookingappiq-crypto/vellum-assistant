import { SkillsReferenceTranscribeContent } from "@/app/docs/_components/skills-reference-transcribe-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Transcribe - ANU Docs",
  description:
    "Transcribe skill for ANU — transcribes audio and video files using OpenAI Whisper or whisper.cpp.",
  path: "/docs/skills-reference/transcribe",
});

export default function SkillsReferenceTranscribePage() {
  return <SkillsReferenceTranscribeContent />;
}
