# Grok bot UI research

GROK BOT: UI RESEARCH REPORT FOR ANU (2026-10-30)

1. WHAT "GROK BOT" MEANS
"Grok bot" is the common name for xAI's Grok assistant. It reaches users in three ways, and all three matter for ANU.
a) @grok on X. You tag the bot in any post or reply and it answers in that thread. There is no separate screen: the bot comes to where the conversation already is. https://www.layer3labs.io/guides/what-is-grok-bot , https://www.trustedreviews.com/explainer/what-is-grok-4508767
b) The standalone Grok app and grok.com. This is the chat assistant itself, with Voice Mode (including Live Camera), Imagine for images and video, selectable personalities such as Assistant, Romantic and Storyteller, and Companions. https://www.lazyweb.com/company/grok
c) Grok Companions (Ani, Rudi/Bad Rudi, Valentine, Mika). These are animated 3D characters that fill the screen and talk by voice. Status: on 2026-07-24 xAI said it would retire the 3D avatar mode. Removal reportedly began on 2026-09-01, starting with the Companions tab. Text chat with the personalities stays. Reported reason: the cost of real-time 3D rendering plus low-latency voice. https://www.layer3labs.io/guides/grok-companions-explained , https://www.roborhythms.com/grok-companions-discontinued/ , https://aiinsightsnews.net/grok-ani-gone-what-happened/
Takeaway: copy the persona and companion ideas, not the heavy 3D. ANU's lightweight animated Frostlings already fit this better.

2. SCREEN STRUCTURE (main app)
- Chat-first home. You land straight in a conversation with the composer ready; there is no dashboard. A 2025 revamp put recent conversations one tap from home. https://www.lazyweb.com/company/grok
- Navigation lives in a hamburger or left drawer (top-left icon) that holds history, Settings, Companions and the character list. The main surface is only the chat. https://getcoai.com/news/grok-ai-launches-flirty-companions-ani-and-rudi-for-30-monthly-subscribers , https://www.sportskeeda.com/gaming-tech/how-get-grok-companions
- On desktop, a left sidebar plus a simple model choice. Reviewers call it "clean" and "consumer-oriented, less techie". https://hackceleration.com/grok-review/ , https://blog.reviewaitool.com/?p=1378
- The Android widget is an elongated bar that opens straight into the chat input: zero steps from the home screen to typing. https://www.androidheadlines.com/2025/11/grok-app-android-google-like-widget-instant-one-tap-access.html
- Visual style, from my own product knowledge rather than a fetched source: dark-first near-black canvas, monochrome UI with almost no chrome, a large rounded pill composer at the bottom (attach, mode/model chip, voice button), a small wordmark only on an empty state. Light theme exists.

3. HOW THE BOT OR CHARACTER IS PRESENTED (Companions)
- The character fills the screen and is the conversation itself. It lip-syncs, gestures, moves its eyes, changes posture and reacts as it speaks. The background changes on its own to match the topic, and you can also change it by hand. https://www.ai-souken.com/article/what-is-grok-companions-mode , https://the-decoder.com/grok-introduces-interactive-ai-avatars-for-ios-app/
- Voice is the main input and text is secondary. Replies come in the character's own voice and style, in every language voice mode supports.
- A "heart meter" bar on the right edge shows relationship level (-10 to +15, five levels) and unlocks reactions as it rises. This is a gamified state indicator. https://www.ai-souken.com/article/what-is-grok-companions-mode
- You can save the last minute of a session as a video and share it to X.

4. STARTING A CONVERSATION AND CHOOSING PERSONAS
- Plain assistant: open the app and type or tap voice. There are no pre-steps.
- Companions: turn them on in Settings ("Enable Companions"), then pick Ani or Rudi from the top-left menu, or in Voice Mode use the gear (bottom right) and choose a character. A persona switch is one tap and does not start a new screen. https://www.ai-souken.com/article/what-is-grok-companions-mode
- Personalities are a short preset list attached to voice and text. Coverage counts nine: news, romance, friend, tutor, medical, comedy, therapy, science, coding. https://onlinemarketing.de/technologie/custom-voice-grok-xai-x
- Custom bots: Grok never shipped user-created companions. Musk promised "make your own" in 2025, and I found no confirmation it shipped. Customization stops at outfit and hair (paid tiers), mode variants (Bad Rudi) and custom instructions. https://www.cyberlink.com/blog/trending-topics/4134/grok-valentine , https://macmyths.com/grok-chatbots-new-ai-companions/
This is a gap ANU can fill.

5. WHAT MAKES IT FEEL DIRECT
1) The first screen is the composer. 2) Persona selection sits in the same surface (menu or gear) and never takes over the flow. 3) Voice is one tap away and stays there. 4) The bot comes to the user's context: @grok is summoned inside a thread, and the widget opens straight into input. 5) Personality carries the brand instead of chrome, with no logo in the header.

PATTERNS ANU SHOULD ADOPT
- Launch, then splash with the snowflake mark for 1 to 2 seconds, then straight into chat with the current bot. The bot's Frostling avatar sits small above the composer and animates (thinking, success, waiting). Empty state is the avatar plus a short greeting in the bot's voice plus 2 to 3 suggestion chips. No app logo in the header.
- Bot switcher as a tappable chip with the avatar and name at the top of the chat. It opens a bottom sheet listing bots (avatar, name, one-line role) with "+ Create bot" as the last row. Switching takes one tap.
- @mention inside a conversation (from @grok): type @ResearchBot to pull another agent into the current chat or hand it a subtask. Reuse /v1/sessions.
- Persona presets as templates for creating a bot (Researcher, Writer, Coder, Tutor, Assistant). Then "describe your bot in one sentence", which generates name, avatar traits and soul, with an editable preview. Store the result in the harness's identity and soul profile, not a parallel system.
- A minimal pill composer: attach, voice, send, and a small mode chip. Browser and Files open as full-screen windows from message cards (for example "Opened 3 pages", "2 files"), with a back gesture returning to chat.
- Ambient state on the avatar instead of status text: the Frostling animates while working and shows a reaction on success or when waiting for approval. A thin progress edge, a calmer version of the heart meter, can show multi-step work.
- Drawer, not tabs, for everything else: Agents (live and finished, with avatars), Sessions history, Tasks, Settings. The drawer opens from the right in RTL.
- Dark-first with near-black neutrals, one blue accent and real contrast. Build a proper light theme too, not an inversion.
- Voice as its own full-screen mode where the avatar grows large and reacts (a cheap 2D take on Companions).

PATTERNS TO AVOID
- Real-time 3D characters. They cost so much compute that xAI is retiring them, so keep to 2D Frostling animation.
- Engagement or intimacy gamification (heart meters, unlocks, flirty or "unhinged" modes). It was widely criticized ("never felt so uncomfortable", https://tomsguide.com/ai/i-tried-groks-new-companion-feature-and-ive-never-felt-so-uncomfortable) and does not suit a productivity agent.
- Hiding personas behind a Settings toggle (Grok's "Enable Companions"). Bots should be visible in the switcher from day one.
- Paywall interstitials inside flows (much of Grok's screen inventory is paywalls).
- A fixed persona list with no creation path. ANU needs first-class custom bots.
- Coupling to a social network, which reviewers call Grok's "design baggage".

Source caveat: details about the companion screen come from secondary and blog sources dated 2025 to 2026. The exact visual styling of the main Grok app (pill composer, monochrome dark) is from my product knowledge and was not confirmed by a fetched page.
