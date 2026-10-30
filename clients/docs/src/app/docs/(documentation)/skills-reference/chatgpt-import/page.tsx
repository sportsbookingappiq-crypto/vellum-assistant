import { SkillsReferenceChatGPTImportContent } from "@/app/docs/_components/skills-reference-chat-gpt-import-content";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "ChatGPT Import - ANU Docs",
  description:
    "ChatGPT Import skill for ANU — imports your conversation history from ChatGPT into ANU.",
  path: "/docs/skills-reference/chatgpt-import",
});

export default function SkillsReferenceChatGPTImportPage() {
  return <SkillsReferenceChatGPTImportContent />;
}
