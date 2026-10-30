# Cue by Manus research

CUE (MANUS) RESEARCH REPORT

Confidence: the product facts below are well sourced. The visual details of the ad are mostly not. I could not watch the launch film: it lives on X (@CueAgents) and no text source describes its frames, colours or type. Anything about the film's look is marked [unverified]. Have a human watch the X post before treating it as a visual spec.

1. WHAT CUE IS
- It is a standalone personal-agent app from Manus, launched with Manus 2.0 on 2026-09-28. It is a separate app, not a mode of Manus, though it runs on the same infrastructure.
- Taglines: "Give it a cue, and it gets to work.", "Your personal team of AI agents" and "Your Personal Agents, With Their Own Identity" (on cue.im).
- Each agent gets its own email, phone number (US/CA/SG, sold in-app), wallet (Link, spends within a budget the user sets) and cloud computer.
- What agents do: they send messages, pay for things, answer your calls and leave a call summary in Cue, and take orders by QR (scan a restaurant QR and an agent orders or holds your place).
- Several agents can share one group chat with a common goal and hand work to each other. Manus's example is one agent researching venues, one shortlisting them and one drafting the deck. Copy: "You set the direction, check in from your phone, and make the final call."
- It runs on web, desktop and Android, plus iOS 17+ after App Store review. Access is invite-only (code MEETCUE).
- Inside Manus, an "Agents (Cue!)" sidebar tab shows a QR code to download the app.

Sources: https://manus.im/blog/introducing-manus-2-0 , https://thenextweb.com/news/manus-2-0-cue-ai-agents-email-phone-wallet , https://www.implicator.ai/manus-cue-agents-phone-numbers-wallets/ , https://www.oflight.co.jp/en/columns/cue-by-manus-personal-agents-app-guide-2026 , https://hao.cnyes.com/post/270200 , https://myclaw.ai/blog/manus-ai-agent-cue-review

2. APP UI, FROM A HANDS-ON WALKTHROUGH (https://www.woshipm.com/ai/6472113.html)
- **Onboarding is a conversation.** The agent first asks your name. You then name your agent; a "random" button re-rolls the name and the avatar together. It assigns the agent's email (you can rename it). Phone, wallet and cloud computer are optional steps you can skip and set up later.
- **Home** is a list of agents, each with its own avatar. There is always a built-in system agent named "Cue" that handles configuration by chat (settings become a conversation). Your own agents (for example "Coco") sit alongside it.
- **Empty states guide you.** Example prompts sit inside the composer, there is a community "see how others use Cue" area, and tapping an example fills the composer.
- **Each agent has a profile ("Agent Info").** It holds identity assets (email, phone, computer, wallet), automations, instructions and memory, plus Integrations > Messenger > Connect for iMessage, Telegram, LINE and Slack. You can share an agent as a QR code that others scan.
- **Chat is where the work happens.** When the agent needs something, it opens a login page on its own cloud computer and asks you to scan a QR code. The user can look at that computer and operate it. Payments always come back for confirmation, and the user sets how much needs confirming.
- **Group chat:** you add several agents to one thread and assign roles.
- **Other screens:** skills settings, an app or connector catalogue, a weekly usage meter and a "Cue Plus" plan.

3. THE LAUNCH FILM ("Cue AI from Manus" ad)
- **How it was made:** it was produced overnight in Manus Studio's video editor, not with a video-generation model. After 76 minutes Manus offered three creative directions, the author replied "A. Make it.", and Manus drew 16 storyboard panels. A few hours of polishing followed. The film is built from code-driven motion graphics: clips, text, motion graphics and audio as separate layers. It got 1.7M+ views on X. (https://manus.im/blog/introducing-video-editor ; https://eu.36kr.com/en/p/4003830453686403)
- **What it shows:** coverage confirms a "scan to connect an agent" scene. The beats very likely follow the launch copy: identity cards (email, phone, wallet, computer), a call answered and then summarised, QR ordering, and a group chat of agents handing off work. [Scene list partly unverified]
- **Look:** because it is code-driven motion graphics, expect kinetic UI mockups of phone screens, type-led cards and short, punchy copy rather than photoreal footage. The author said the hardest part was "matching the brand's tone". The tone is warm and personal: these are "your" agents with names and faces, not a tool. [Colours, typography and music unverified]

4. MANUS APP PATTERNS RELEVANT TO ANU
- **"Manus's Computer" panel:** a live view of the agent's own sandbox (browser, terminal, editor, files) next to the chat, with the current step shown as a caption ("Manus is using Browser...").
- **Plan checklist:** collapsible steps that tick off as they finish.
- **Task replay:** a shareable link that plays the run back with a scrubber.
- **2.0 Remote Control:** "watch your desktop live on your phone while it does". The agent works in "its own visible workspace", limited to the files, browser and apps you approve.
- **Automations** fire on events from email or calendar.

(The 2.0 points are from the blog. The panel, checklist and replay descriptions come from Manus 1.x knowledge and are not re-verified here.)

PATTERNS ANU SHOULD ADOPT
1. **Agents are people.** Each one has a name, a face and an identity card. Map this to the Frostling avatar plus the harness identity files (IDENTITY/SOUL). The "random" button re-rolls name and Frostling together, so creating a bot takes one tap.
2. **Create a bot by chatting.** A built-in system agent (the equivalent of "Cue") creates and configures bots in conversation. This matches "direct", and it stores the result in harness profiles, not a parallel form-based system.
3. **Home is a list of agents, each opening a chat.** Group chat is a later option. Each row shows the avatar, the live status (working / waiting for you / done) and the last line. This is the right shape for the owner's Agents page and Sessions-as-chat requirement.
4. **The profile sheet has four parts:** instructions, memory, skills, and integrations/automations. It mirrors harness concepts one to one.
5. **The chat is the control surface.** Decisions (payments, logins, approvals) come back to the user as inline cards in the chat, and the user sets the confirmation scope (Permission controls v2).
6. **The agent's computer is a separate full window** opened from the chat ("watch it work", live browser, files), with a one-line caption showing what it is doing now. This matches the owner's "full windows, not tabs".
7. **Empty states carry the guidance:** tappable example prompts in the composer and nothing else on screen.
8. **Share an agent by QR code** (later).

PATTERNS TO AVOID
- **Too many identity assets.** Phone, wallet and email setup add steps and US-only friction. Keep these optional and hidden after onboarding.
- **A dense developer view.** Manus's split chat/computer layout and step logs are too technical for a regular user on a phone. Show a single status line, not a terminal.
- **Barriers at the door:** invite gates, usage meters and plan upsells on the first screens.
- **Group chats as the default.** They add complexity; offer them only after the user has more than one agent.
- **Copying the film's hype.** Do not copy its tone or motion wholesale. Use motion for agent state (thinking, success, waiting), which ANU's AnimatedAvatar already supports, not for decoration.
- **Two bot systems.** Do not separate "system agent" settings from bot profiles. Both must persist through the harness.
