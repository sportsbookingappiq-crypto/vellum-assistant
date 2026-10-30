# How apps let users create bots

## Research: how apps let users create custom bots (October 2026)

The user named two references specifically: **Grok Bot** (xAI) and **Cue** (Manus). Both are covered first.

**1. Grok Bot (xAI, beta August 2026)**
- Creation takes 3 taps: sidebar **+**, then **Create a Bot**, type a **name**, then **Create**.
- There is no instructions form, avatar picker or tool picker. The bot's job comes from the first message. The user tells it the job and asks it to remember how to work. The name alone shapes its opening pitch: "researchbot" introduces itself as a research assistant.
- The first bot ("Grok Bot") already exists, and its chat opens after a short intro.
- There is also **Browse shared Bots**.
- Each bot is its own chat thread in the sidebar. Rename it by tapping the name in the chat header, which opens its details.
- Each bot has its own cloud computer, opened with **Open computer**, that you can watch and take over on mobile.
- Logins are handled when needed through a Secure Form or by taking over. Approvals before external changes can be given from the phone.
- Composer: voice input and **Start voice chat**.
- Skills and routines are saved from a chat later, not set up at creation. Bots can message each other, and a "chief of staff" bot can manage the others.
- Sources: https://docs.x.ai/grok-bot/get-started, https://www.mindstudio.ai/blog/grokbot-xai-agent-app, https://www.bensbites.com/p/grok-bot-is-not-what-you-think

The main Grok app also has **Custom Agents** (since March 2026): Settings, then Customize, then Create Agent. Fields are name, a one-line description used for routing, instructions (4,000 characters max) and an **Auto-engage** toggle. There are 4 slots, listed under "Your Agents". You pick one when starting a chat or call it by name. Source: https://aitoolsrecap.com/Blog/grok-agent-settings-explained-2026

**2. Cue by Manus (launched 28 Sep 2026)**
- Onboarding is a guided wizard where every step can be skipped:
  1. What the agent should call you.
  2. Agent **name**, with a **random button that rerolls both name and avatar**.
  3. The agent's own email address (can be renamed).
  4. Optional phone number.
  5. Optional wallet.
- You land in chat with a first agent already created, plus a system agent for configuration.
- Suggestion chips sit above the composer. A "see how others use Cue" gallery loads an example straight into the composer.
- Each agent has a **profile page** for its assets (email, phone, computer, payment), automations, instructions and memory.
- There are multiple agents with custom avatars, split by role (work, family, investing). Group chats put several agents in one thread.
- Work runs on the agent's cloud computer, which you can open.
- Sources: https://www.woshipm.com/ai/6472113.html, https://runtimewire.com/article/manus-cue-personal-agents-launch, https://myclaw.ai/ko/blog/manus-ai-agent-cue-review

**3. ChatGPT GPTs**
- Two modes:
  - **Create**: a conversational builder that drafts the GPT from your description.
  - **Configure**: name, description, instructions, conversation starters, knowledge (up to 20 files), capabilities toggles, apps.
- Building is **web only**. Mobile can use GPTs but cannot build them.
- The name shows at the top of the chat, and starters show when the GPT is opened.
- Source: https://help.openai.com/en/articles/8554397-creating-a-gpt

**4. Character.ai** (third-party guides, which conflict on details)
- Fields: name, avatar, tagline, description, greeting, definition, voice, visibility (public/unlisted/private), then "Create and Chat".
- The greeting is the first bubble of the chat.
- Source: https://shapes.inc/fandom/character-ai/creation-guide

**5. Poe**
- 5 steps, one of them optional.
- Fields: picture (optional), name (**prefilled with a random name**, 4 to 20 characters), description, base bot (model), prompt with a "visible" toggle, knowledge, greeting.
- Advanced settings: suggested replies, temperature.
- After creation it opens the bot page, where you can chat or share.
- Source: https://creator.poe.com/docs/how-to-create-a-prompt-bot

**6. Gemini Gems**
- Fields: name (Save stays disabled until it is set), instructions with a **magic wand** that drafts or rewrites them, knowledge (up to about 10 files).
- Gems are created on the web only and then appear on mobile.
- Sources: https://chromestory.com/2026/07/create-gem-gemini-app/, https://blog.google/products/gemini/google-gems-tips/

**7. Meta AI Studio**
- Describe the idea first. It **auto-generates the name, tagline and 4 avatar options**.
- You then edit instructions (how it behaves) and example responses.
- You can start from an Instagram DM with "Create an AI chat".
- Sources: https://ai.meta.com/static-resource/ai-studio-handbook, https://allthings.how/how-to-create-your-own-custom-ai-with-meta-ai-studio/, https://about.fb.com/news/2024/07/create-your-own-custom-ai-with-ai-studio/

**8. Claude Projects**
- A modal asks "What are you working on?" (name) and "What are you trying to achieve?" (description).
- Instructions and knowledge files are set afterwards. The name and description are for organizing only.
- Source: https://support.anthropic.com/en/articles/9519177-how-can-i-create-and-manage-projects

**What they have in common**
- The direct apps (Grok Bot, Cue, Meta) ask for **one thing first**: a name or a one-line idea.
- Everything else is generated or deferred until it is needed.
- A default bot already exists, so the first screen is a chat.
- A bot is a chat thread with its own header. Its profile opens from the name in the header.
- The heavy configure forms (GPTs, Poe, Gems) are desktop-oriented.

## Proposed ANU flow (minimal, direct, built on the harness)

These fields map onto what the harness already has: `assistant/src/prompts/templates/IDENTITY.md` (Name, Emoji, Nature, Personality, Role, plus an `## Avatar` section that `assistant/src/avatar/identity-avatar.ts` maintains) and `SOUL.md` (how it works and boundaries). ANU should not invent a separate bot schema.

**Entry points**
- A **+** in the bot switcher at the top of chat (bot avatar and name, which opens a sheet of bots).
- A "New bot" card at the end of the Agents page.
- Inside any chat, the phrase "make me a bot that..." should also work, with the default ANU bot creating it. This is the Grok Bot and Cue approach.

**Screen 1: one sheet, one field**
- Prompt: "What should your bot do?" (ar: "ماذا تريد أن يفعل البوت؟"), a multiline field with voice input.
- Under it, 4 to 6 template chips: Researcher, Shopper, Inbox helper, Tutor, Writer, Planner. Tapping a chip fills the text.
- One primary button: **Create**.

**Generation (AI-assisted, about 2 seconds)**
- The backend makes one LLM call in the harness via `getConfiguredProvider` and returns:
  - name in the user's language (Arabic or English);
  - Role (one line);
  - Personality (short);
  - 3 conversation starters;
  - a deterministic Frostling avatar (body, eyes, color seeded from the name).
- Defaults: the model profile is inherited from the account default, tools are all of the harness defaults, and visibility is private.
- Approvals stay under Permission controls v2 unchanged. No new modes.

**Screen 2: preview card, editable inline**
- A large animated Frostling with a **reroll die** that rerolls the avatar only. Tapping the avatar opens the body, eyes and color picker.
- Name: tap to edit, with a reroll.
- Role line: tap to edit.
- "Instructions" collapsed (the generated SOUL text), with "Rewrite with AI", similar to the Gems wand.
- Starters as chips.
- Primary button: **Start chatting**. This writes the profile and opens the chat with the bot's greeting and starters.
- So creation is 2 taps (describe, then Start chatting). Everything on screen 2 is optional.

**Advanced (collapsed, "More")**
- Model profile picker (from the harness model profiles).
- Knowledge files.
- Skills on or off (from the harness skills list).
- Auto-engage (whether the bot can be pulled in by mention).
- Delete.
- Leave out: tagline, visibility and sharing, temperature, voice. Add them later if needed.

**Persistence (harness, not parallel)**
- Each bot is a harness profile: its own `IDENTITY.md` (Name, Emoji, Nature, Personality, Role, Avatar section with the Frostling traits) and a `SOUL.md` seeded from the template with a short "Your job" section.
- The API (`/v1/bots` or an extended `/v1/agents`) only does CRUD and points sessions at the profile. `/v1/sessions` takes `botId`, and the worker loads that profile.
- After creation the bot keeps learning the way the harness already does: it edits its own SOUL.md "Working with [User]" section, the way Grok Bot "remember how it should work" behaves.

**After creation**
- The bot appears:
  - in the switcher sheet (avatar plus name);
  - as an avatar on the Agents page, with live status (working, waiting, done);
  - in the chat header, where tapping it opens a **profile sheet**: avatar, role, instructions, model, skills, recent sessions, and Edit.
- Chat layout:
  - Greeting bubble from the bot, starter chips above the composer (as Cue does), voice input in the composer.
  - Browser and Files open as full windows from inline cards in the conversation, like Grok Bot's "Open computer".
  - Approvals appear inline.

**Default bots, already there on first run**
- **ANU** (general; it can also create bots from chat).
- 2 or 3 seeded starters, for example Researcher and Shopper.
- With these, the app opens straight to a chat, like Grok Bot and Cue.

**Arabic and RTL**
- Generated names and starters come back in the language of the interface.
- All labels go through the i18n catalogs (ar and en).
- The reroll and avatar controls are mirrored under RTL.
