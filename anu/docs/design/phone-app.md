# ANU phone app: final design spec

Status: final for the build round of 2026-10-30. Builders implement this file. Critics review against section E.
Inputs: owner feedback (all binding), research on Grok Bot (xAI), Grok app, Cue (Manus), GPTs, Character.ai, Poe, Gems, Meta AI Studio, the harness profile inventory, and three design directions (A chat-first, B living board, C hybrid tabs).

## 0. Verdict

### 0.1 Scores

Each direction is scored 0 to 3 against the binding requirements (3 = fully met).

| Requirement | A chat-first | B living board | C hybrid tabs |
| --- | --- | --- | --- |
| Direct (launch to typing, few steps) | 3 (0 taps) | 2 (pinned composer, but home is a board) | 2 (composer docked, home is a list) |
| Custom bots, created in 2 taps | 3 | 3 | 3 |
| Bot profiles live in the harness | 3 | 3 | 3 |
| Agents page with avatars, working and finished | 2 (in drawer, plain) | 3 (strongest agents surface) | 2 (segmented, hides groups) |
| Sessions are chats, separate from tasks | 3 | 2 (drops the task timeline, merges tasks into chats) | 3 |
| Logo only on icon and splash | 3 | 3 | 3 |
| Browser and files are full windows from chat | 3 | 3 | 3 |
| Arabic first, real dark mode | 3 | 3 | 3 |
| Not like Vellum (not task-centred, no tab-bar dashboard) | 3 | 2 (board drifts to dashboard past 8 bots) | 1 (bottom tab bar plus list home is closest to the old app) |
| Matches the named references (Grok Bot, Cue) | 3 (Grok Bot: first screen is a chat, bots are threads) | 2 (Cue home only) | 1 |
| Total | 29 | 26 | 24 |

### 0.2 Winner and grafts

Winner: Direction A, chat-first, bots as faces. It is the closest match to Grok Bot, which the owner named: the app opens on a chat with a bot that already exists, each bot is its own thread, and a bot is created by naming or describing it.

Ideas grafted from the other directions and the research:
- From B, the "Needs you" group shown first, at most 3 rows. It appears at the top of the drawer and of the Agents page.
- From B, the Agents page cards, with finished agents keeping their avatar plus the first line of the result, and the "New bot" card as the last item.
- From B, the 3px progress edge under the chat header for multi-step work.
- From C, "Show steps" inside a chat expands the step list in place. There is no separate timeline screen for a chat.
- From C, the bot check mark in the switcher and the account entry to Settings.
- From Grok Bot, bots are listed as threads in the drawer. Tapping a bot name in the chat header opens its profile. Grok Bot's "Open computer" becomes a plain kebab action, "See what it's doing", that opens the Browser window.
- From Cue, the reroll button changes name and avatar together on the preview card. The built-in ANU bot can create and edit bots by chat.
- From Meta AI Studio, one sentence in, then a generated name, role, avatar and starters out.
- From Gems, "Rewrite" on the instructions.

Dropped from A: the pull-down bot row under the header. It duplicated the switcher sheet and added chrome. Live bot state is shown in the switcher sheet, the drawer and the Agents page instead.

### 0.3 Product identity (owner directive, binding)

ANU is simply a personal AI agent that helps the user with any task. Every surface the user can see says that, plainly and warmly, and nothing more.

- One-liner (app store, README opening, BRAND.md tagline, i18n `anu.identity.oneLiner`):
  - ar: "ANU وكيلك الشخصي بالذكاء الاصطناعي، يساعدك في أي مهمة."
  - en: "ANU is your personal AI agent. It helps you with any task."
- The ANU bot introduces itself the same way: "أهلاً، أنا ANU. بماذا أساعدك؟" / "Hi, I'm ANU. What can I help with?"
- Banned in any user-facing string (UI, onboarding, empty states, splash, errors, seeded greetings and starters, store copy): sandbox, harness, runtime, workspace, isolated environment, approved tools, "review every step before adoption", daemon, driver, profile file names (IDENTITY.md, SOUL.md), model or provider names, "platform". Arabic forms are banned the same way: "ساند بوكس"، "بيئة معزولة"، "أدوات معتمدة"، "راجع كل خطوة قبل اعتمادها"، "منصة". Internal docs (`anu/docs`, `AGENTS.md`) and code may keep technical terms.
- There is no onboarding tour, feature carousel or explainer screen. After login the user lands in a chat with ANU, and ANU's greeting and three starters are the whole introduction.
- Approvals read as the bot simply asking, in one sentence with the concrete object: "أرسل هذا البريد إلى سارة؟" / "Send this email to Sara?" Buttons "اسمح" / "Allow" and "ليس الآن" / "Not now". No risk levels, tool names or policy words on the card.
- Activity lines describe what the bot is doing in everyday words ("يقرأ صفحة الأسعار" / "Reading the pricing page"), never tool names or commands.
- Scope of this spec's builders: the ANU app copy (clients/web i18n `en` and `ar`, splash, login, empty states, seeded bot greetings and starters in `anu/src/api/default-bots.ts`). A separate agent owns `skills/`, `README.md`, `docs/ANU-VOICE.md`, `assets/brand/BRAND.md` and the persona templates `assistant/src/prompts/templates/IDENTITY.md` and `SOUL.md`. App builders, critics and fixers do not edit those files, and app review does not fail on them.

## A. Information architecture and screens

### A.1 Map

```
Splash (1.2s max, only place the mark appears in-app)
  -> Login (phone, then code)            [signed out]
  -> Chat with current bot (root)        [signed in]
       header: menu | bot chip | new chat
       -> Bot switcher sheet -> Create bot sheet -> Preview sheet
       -> Bot profile (full screen) -> Edit (preview sheet in edit mode)
       -> Browser window (full screen)
       -> Files window (full screen) -> File preview (full screen)
       -> Drawer (leading edge; from the right in RTL)
            Needs you (only when non-empty)
            Bots (each bot is a thread; + New bot last)
            Chats      -> Sessions screen (all chats, grouped by bot)
            Agents     -> Agents screen
            Tasks      -> Tasks screen -> Task detail (step timeline)
            Settings   -> Settings screen
```

Rules:
- There is no bottom tab bar.
- The root is always a chat. On first run it is a chat with ANU. Later it is the last bot used, on its latest session.
- Back (chevron or edge swipe from the leading edge, the right edge in RTL) always returns one level and restores the exact scroll position.
- Deepest path is 3 levels: Chat > Files window > File preview.
- Routes (clients/web, under /anu): `/anu` (chat root), `/anu/chat/:sessionId`, `/anu/chat/:sessionId/browser`, `/anu/chat/:sessionId/files`, `/anu/chat/:sessionId/files/:path`, `/anu/bots/:botId` (profile), `/anu/chats`, `/anu/agents`, `/anu/tasks`, `/anu/tasks/:taskId`, `/anu/tasks/:taskId/browser`, `/anu/tasks/:taskId/files`, `/anu/settings`, `/anu/login`. Sheets (switcher, create, preview) are overlays and have no route of their own.
- The old "new goal" page is removed from navigation. A task is started from a chat ("do this as a task" is a later item) or stays reachable only through the existing Tasks list.

### A.2 Visual system

Tokens are CSS custom properties on the ANU shell root, defined twice. Light is designed on its own, not inverted.

| Token | Light | Dark |
| --- | --- | --- |
| --anu-bg | #FFFFFF | #0B0D10 |
| --anu-surface | #F2F4F7 | #17191D |
| --anu-surface-2 | #E8EBF0 | #212329 |
| --anu-ink | #0A1633 (Night 900) | #ECEEF1 |
| --anu-muted | #5B6475 | #A3A8B3 |
| --anu-accent | #2563EB (ANU Blue) | #38BDF8 (Azure) |
| --anu-accent-ink | #FFFFFF | #0A1633 |
| --anu-primary (filled button) | #0A1633 on white text | #ECEEF1 on #0B0D10 text |
| --anu-waiting (tint / text) | #FEF3C7 / #92400E | #3A2E12 / #F2B544 |
| --anu-done (tint / text) | #DCFCE7 / #166534 | #12301E / #6EE7A0 |
| --anu-failed (text) | #B91C1C | #F87171 |

- Dark ground is a true neutral, never navy. Depth comes from tone steps only (bg, surface, surface-2). No glow, no blur, no glass, no gradients.
- Accent stays under 5% of any screen. It appears only on the send button when there is text, focus rings, links, and the check on the current bot in the switcher.
- Each row or card carries at most one status mark.
- Type: IBM Plex Sans Arabic (`@fontsource/ibm-plex-sans-arabic`, already a dependency) for Arabic and Latin. Sizes 13, 15, 17, 22, 28. Weights 400 and 600 (dark uses 400 for body and 500 where light uses 600). No monospace labels, no letter-spaced capitals, no eyebrow labels, no emoji anywhere in the UI.
- Shape: composer and chips are full pills, sheets and cards 20px, user bubbles 18px. No 1px borders on cards. Shadows only on floating things (composer, sheets, drawer).
- Motion: sheets 320ms ease-out `cubic-bezier(.22,1,.36,1)`, press 140ms, no bounce, no shimmer, no typewriter effect. Messages appear whole.
- Avatar is the status display. States from AnimatedAvatar: idle (static, a slow blink only on the empty state), thinking (only while the bot is busy), `reaction="waiting"` (held while an approval is open, no pulsing), `reaction="success"` (plays once on completion, then rests), failed (static, desaturated). Off-screen avatars pause. `prefers-reduced-motion` shows the final pose of each state with no animation.
- Avatar sizes: 24 (message runs, Tasks rows), 28 (header chip), 40 (drawer and switcher rows), 48 (Agents rows), 96 (chat empty state, preview), 120 (create loading).
- A bot's identity colour appears only in its avatar, never as a card or bubble fill.
- RTL: logical properties only (`margin-inline-start`, `inset-inline-end`). Chevrons, drawer side, back gesture, reroll placement all mirror. Arabic uses Arabic-Indic digits through `Intl.NumberFormat("ar")`; times through `Intl.RelativeTimeFormat`. Each message sets `dir="auto"` so mixed-language text renders correctly.
- All user-facing strings come from `clients/web/src/i18n` catalogs. Every new key exists in `en` and `ar`; other locales may fall back to `en`.

### A.3 Screens

Every screen below lists layout, then states: empty, loading, error, and any special state. Arabic first, English second.

#### 1. Splash
- Layout: Night 900 `#0A1633` ground in both themes, the ice snowflake mark (existing `anu-mark.tsx`, ice variant) at 96px, centred. The six facets draw in over 600ms.
- Holds until the auth and session restore resolve, never longer than 1.2s in total, then crossfades in 300ms to Chat (with the bot avatar already in place) or Login.
- Reduced motion: the mark shows static.
- This is the only screen inside the app that shows the mark. The native Capacitor launch screen uses the same ground and mark so there is no flash.

#### 2. Login
- Step 1: title "رقم هاتفك" / "Your phone number", one filled field (placeholder 555-0142, accepts Arabic-Indic digits), primary button "أرسل الرمز" / "Send code".
- Step 2: "أدخل الرمز المرسل إلى 555-0142" / "Enter the code sent to 555-0142", six cells with `autocomplete="one-time-code"`, auto-submit on the sixth digit, "إعادة الإرسال بعد 0:30" / "Resend in 0:30", then "أعد الإرسال" / "Resend".
- Loading: the button shows a small spinner in place of its label, the field stays visible.
- Error inline under the field: "الرمز غير صحيح. حاول مرة أخرى." / "That code didn't match. Try again." Rate limit: "محاولات كثيرة. انتظر دقيقة." / "Too many tries. Wait a minute."
- No mark, no marketing copy, no illustration.

#### 3. Chat (root and every session)
- Header, 48px, no logo:
  - Leading: menu icon (opens drawer).
  - Centre-start: bot chip = 28px avatar + bot name + small chevron. Under the name, only while busy, "يعمل" / "Working" in muted 13px. Tapping the chip opens the Bot switcher. Tapping the avatar inside the chip opens the Bot profile.
  - Trailing: new chat icon ("محادثة جديدة" / "New chat" as its accessible label), then a kebab with "شاهد ما يفعله" / "See what it's doing" (Browser window), "الملفات" / "Files", "حذف المحادثة" / "Delete chat".
  - A 3px progress edge sits under the header only while a multi-step turn runs and a step count is known. It shows the true fraction. Accent colour at 60% opacity.
- Messages:
  - Bot replies are plain text on the ground, aligned to the start, with the 24px avatar beside the first line of each run.
  - User messages sit in `--anu-surface` bubbles at the end edge.
  - Markdown rendering for bot text (lists, links, code blocks on surface-2).
- Inline cards in the message flow (surface, 20px radius, one line plus a chevron):
  - Browser card: "فتح 3 صفحات" / "Opened 3 pages" with a strip of up to 3 thumbnails. Opens the Browser window.
  - Files card: "ملفان" / "2 files" with the first file name. Opens the Files window.
  - Steps card, collapsed: "5 خطوات" / "5 steps" with "عرض الخطوات" / "Show steps". Expands in place to the step list (plan, tool, observation items). Never a separate screen.
  - Approval card: the request in one sentence in the bot's voice ("أرسل هذا البريد إلى سارة؟" / "Send this email to Sara?", with the bot's 24px avatar beside it), buttons "اسمح" / "Allow" (primary) and "ليس الآن" / "Not now" (ghost). While open, the header avatar holds the waiting pose. Uses the existing approvals endpoints and Permission controls v2 as they are, with no new modes.
  - Bot preview card: when ANU is asked "اصنع لي بوتاً يتابع أسعار الرحلات" / "Make me a bot that tracks flight prices", it returns the same preview card as the Create flow (see 5), inline.
- Composer: floating pill. Attach (leading), multiline text field "اكتب رسالة" / "Message", mic, send. Send is an accent circle only when there is text. While busy, send becomes stop. Typing `@` at the start of a word opens a small list of bots (phase 2; render nothing in phase 1).
- Empty state (new session): 96px avatar in idle (blinking) at the upper third, the bot's greeting below it (from `bots.greeting`), and up to 3 starter chips (from `bots.starters`) just above the composer. Tapping a chip sends its prompt. Nothing else on screen.
- Loading history: flat grey bars at the real bubble sizes, no shimmer.
- Working: header avatar plays thinking. One caption line above the composer, updated from the latest step title: "يقرأ صفحة الأسعار" / "Reading the pricing page". If a step count is known it appends ", الخطوة 2 من 5" / ", step 2 of 5". No step log.
- Done: the header avatar plays the success reaction once.
- Error: inside the failed message: "تعذّر إكمال الرد." / "Couldn't finish the reply." with "أعد المحاولة" / "Retry". Connection lost: "انقطع الاتصال. نعيد المحاولة…" / "Connection lost. Reconnecting" shown in the caption line, not a banner.
- Switching bots never stops another bot's work.

#### 4. Bot switcher (bottom sheet)
- Opened from the header chip. Title "البوتات" / "Bots".
- Rows, 56px: 40px avatar in its live state, name, one-line role in muted, and either a state pill ("يعمل" / "Working" in done tint, "ينتظرك" / "Needs you" in waiting tint) or a check on the current bot. One mark per row.
- Order: needs you, working, then most recently used.
- Last row: "+ بوت جديد" / "+ New bot". Opens Create bot.
- One tap on a bot closes the sheet and opens that bot's latest session, or a new empty session if it has none.
- Loading: 3 grey rows. Error: "تعذّر تحميل البوتات." / "Couldn't load bots." with "أعد المحاولة" / "Retry" in the sheet.

#### 5. Create bot
Entry points: "+ New bot" in the switcher, "+ New bot" in the drawer, the "New bot" card on the Agents page, and by asking ANU in chat.

- Sheet 1, one field:
  - Title "ماذا تريد أن يفعل البوت؟" / "What should your bot do?"
  - Multiline filled field with a mic inside. Placeholder "مثلاً: يتابع أسعار الرحلات إلى دبي ويخبرني إذا نزلت" / "For example: watches flight prices to Dubai and tells me when they drop". A short input that looks like a name (1 to 3 words, no verb) is also accepted, in the Grok Bot way.
  - Template chips below: باحث / Researcher, متسوّق / Shopper, كاتب / Writer, مدرّس / Tutor, منظّم / Planner, مساعد البريد / Inbox helper. A chip fills the field with a one-sentence description from the catalog.
  - Primary button "إنشاء" / "Create", disabled while the field is empty.
  - Secondary text action "اكتبه بنفسك" / "Write it yourself" opens Sheet 2 blank.
- Generating (up to about 8s, typical 2 to 4s): the sheet shows a 120px avatar in the thinking pose, assembling (body, then eyes, then colour, 240ms each, skipped under reduced motion), and "أجهّز البوت…" / "Setting up your bot". A text action "إلغاء" / "Cancel" aborts.
- Sheet 2, preview card (everything optional, editable in place):
  - 96px animated avatar. A reroll button next to it rerolls name and avatar together (Cue). Tapping the avatar opens a picker for body, eyes and colour (from packages/avatar-catalog).
  - Name, tap to edit, 1 to 40 characters.
  - Role line, tap to edit, up to 120 characters.
  - Greeting, tap to edit.
  - Starters as up to 3 chips, each editable or removable.
  - "التعليمات" / "Instructions", collapsed. Expanded, it is a text area with the generated instructions and "أعد الصياغة" / "Rewrite", which redrafts the instructions only.
  - "المزيد" / "More", collapsed: Model (from the allowlist; hidden if the allowlist has one entry), Skills (switches; hidden if the allowlist is empty).
  - Primary button "ابدأ المحادثة" / "Start chatting". It saves the bot (POST /v1/bots), creates a session with that bot, opens the chat on its empty state, and the bot's avatar plays the success reaction once.
- Tap count: describe, then Start chatting. Two taps after typing.
- Errors:
  - Draft failed or timed out: Sheet 2 opens with the description kept as the instructions and a deterministic name and avatar, plus a note "لم أستطع إنشاء مسودة. أكمله بنفسك أو حاول مجدداً." / "Couldn't draft it. Fill it in or try again." with "حاول مجدداً" / "Try again".
  - Save failed (validation): the field shows its message inline, for example "الاسم مطلوب" / "Name is required".
  - Bot limit reached: "وصلت إلى الحد الأقصى (20 بوتاً). احذف واحداً لإضافة غيره." / "You've reached the limit of 20 bots. Delete one to add another."

#### 6. Bot profile and edit
- Full-screen, opened from the header avatar, from a bot row long-press in the drawer, or from Settings > My bots.
- Layout: back; 96px avatar; name (22px); role; "يبدأ بـ" / "Starts with" greeting; "التعليمات" / "Instructions" (first 4 lines, then "المزيد" / "More"); Model; Skills; "المحادثات الأخيرة" / "Recent chats" (3 rows, then "عرض الكل" / "See all" to the Sessions screen filtered by this bot).
- Actions at the end: "تعديل" / "Edit" (opens Sheet 2 in edit mode, button "حفظ" / "Save"), "نسخ" / "Duplicate", "حذف البوت" / "Delete bot" (red text action, confirm sheet "سيُحذف البوت. تبقى محادثاته." / "The bot will be deleted. Its chats stay.").
- The built-in ANU bot can be edited but not deleted; its Delete action is not rendered.
- Saving takes effect from the next turn of any session with this bot (see C.2, "Bot edits").
- Loading: grey blocks at real sizes. Not found: "هذا البوت لم يعد موجوداً." / "This bot no longer exists." with back.

#### 7. Drawer
- Opens from the leading edge (right in RTL), 86% width, surface tone, shadow.
- Top: "يحتاجونك" / "Needs you", only when non-empty, at most 3 rows (40px avatar in waiting pose, one-line request, tap opens that chat at the approval card), then "عرض الكل" / "See all" to Agents.
- "البوتات" / "Bots": each bot as a thread row (40px avatar in live state, name, last line muted, relative time). Tap opens its latest session. "+ بوت جديد" / "+ New bot" last.
- Then plain text rows: "المحادثات" / "Chats", "الوكلاء" / "Agents", "المهام" / "Tasks", "الإعدادات" / "Settings".
- Bottom: the account phone (555-0142 style) in muted text.
- No mark, no logo.

#### 8. Sessions screen (Chats)
- Title "المحادثات" / "Chats". Optional filter chip row of bots (avatar chips) at the top; "الكل" / "All" first.
- Rows, 64px: 40px avatar, line 1 bot name and session title, line 2 last message muted, trailing relative time. A pale "ينتظرك" / "Needs you" pill when an approval is open.
- Grouped "اليوم" / "Today", "سابقاً" / "Earlier".
- Swipe a row toward the start to reveal "حذف" / "Delete".
- Empty: "لا محادثات بعد. اكتب لأي بوت وتظهر هنا." / "No chats yet. Write to any bot and it shows up here."
- Loading: grey rows. Error: "تعذّر تحميل المحادثات." / "Couldn't load chats." with Retry.

#### 9. Agents screen
- Title "الوكلاء" / "Agents". Agents are the running instances behind sessions and tasks (GET /v1/agents), each shown with its bot's face.
- Groups, in order, each hidden when empty:
  - "ينتظرونك" / "Waiting for you": 48px avatar in waiting pose, name, the one-line request, trailing ghost button "راجِع" / "Review".
  - "يعمل الآن" / "Working now": 48px avatar thinking, name, the current caption ("يقارن 4 فنادق" / "Comparing 4 hotels"), elapsed time.
  - "انتهى" / "Finished": 48px avatar at rest, name, first line of the result, relative time. Failed agents sit here with the desaturated avatar and "تعذّر الإكمال" / "Didn't finish" in failed text.
- Last item: "بوت جديد" / "New bot" card (surface, dashed 1px ghost avatar outline, "صِف ما تريده بجملة" / "Describe it in one sentence"). Opens Create bot.
- Tap a row opens its chat (session agents) or task detail (task agents).
- Live updates: poll GET /v1/agents every 5s while visible; avatar state transitions animate in 240ms.
- Empty (no agents at all): "لا يعمل أحد الآن. ابدأ محادثة وسيظهر هنا." / "No one is working right now. Start a chat and it shows up here." plus the New bot card.
- Loading: grey rows with muted circles. Error: "تعذّر تحميل الوكلاء. آخر تحديث 9:14" / "Couldn't load agents. Last updated 9:14" with Retry.

#### 10. Tasks screen and Task detail
- Title "المهام" / "Tasks". Filter chips: "الكل" / "All", "جارية" / "Running", "بانتظارك" / "Waiting", "منتهية" / "Done".
- Rows, two lines: title; 24px agent avatar, status pill, duration.
- Task detail keeps the step timeline (existing `anu-step-timeline.tsx`), approvals inline, result card, and Browser and Files cards that open the full windows. This is the only place a timeline is the main content.
- Empty: "لا مهام بعد." / "No tasks yet." Loading and error as on Chats.

#### 11. Browser window
- Full screen, pushed from a Browser card or "See what it's doing". No tabs.
- Top bar: close (back), page title over the domain, "مباشر" / "Live" pill when live, open externally.
- A single caption pill near the bottom: "الباحث يقارن الأسعار" / "Researcher is comparing prices", from the latest step.
- The latest frame fills the width at its real aspect ratio and updates live (existing browser frame endpoints). A strip of visited pages at the bottom; tapping one shows that frame.
- Loading: last frame dimmed with "يتصل…" / "Connecting". No frame yet: grey block at the real aspect ratio.
- Ended: "انتهت الجلسة. هذه آخر صفحة." / "Session ended. This is the last page."
- Error: "توقفت الصفحة عن التحديث." / "The page stopped updating." with Retry, inside the frame.

#### 12. Files window and File preview
- Full screen. Title "الملفات" / "Files" with a count ("ملفان" / "2 files").
- Rows: name; type, size and time in muted.
- Tap opens File preview full screen (text, code, image, PDF, JSON tree via existing components) with "مشاركة" / "Share" and "حفظ" / "Save".
- Empty: "لم ينشئ البوت ملفات في هذه المحادثة بعد." / "No files from this bot in this chat yet."
- Loading: grey rows. Error: "تعذّر تحميل الملفات." / "Couldn't load files." with Retry.

#### 13. Settings
- Grouped plain rows, no logo, no upsell:
  - "الحساب" / "Account": phone number.
  - "اللغة" / "Language": العربية / English.
  - "المظهر" / "Appearance": "النظام" / "System", "فاتح" / "Light", "داكن" / "Dark".
  - "البوت الافتراضي" / "Default bot": picker.
  - "بوتاتي" / "My bots": list, each opens the Bot profile.
  - "متى يسألني" / "When it asks me": existing Permission controls v2 scope, described in plain words (no tool names, no risk levels).
  - "تصدير بياناتي" / "Export my data" (existing /v1/me/export).
  - "تسجيل الخروج" / "Sign out" (red text action).

## B. Custom bot model

### B.1 Fields

| Field | Type and limits | Default | Shown in UI |
| --- | --- | --- | --- |
| id | uuid | generated | no |
| name | 1 to 40 chars, trimmed, no newlines | from draft | yes |
| role | 0 to 120 chars | from draft | yes |
| personality | 0 to 200 chars | from draft | no (folded into instructions view as read-only line in profile) |
| greeting | 0 to 280 chars | from draft | yes |
| instructions | 0 to 4000 chars | from draft | yes, collapsed |
| starters | 0 to 3 items of {label 1 to 60, prompt 1 to 500} | from draft | yes, chips |
| avatar | {bodyShape, eyeStyle, color} from avatar-catalog ids | seeded from name | yes |
| model_profile | string from ANU allowlist, or null | null (account default) | under More, only if allowlist has more than one |
| skills | array of skill ids from ANU allowlist, max 20 | [] | under More, only if allowlist non-empty |
| locale | "ar" or "en" | request locale | no |
| default_key | "anu", "researcher", "shopper" or null | null | no |
| created_at, updated_at | timestamps | now | no |

Not in v1: tagline, visibility, sharing, voice, temperature, excluded tools, plugins, knowledge files. Each has a harness hook (C.2) so it can be added without a parallel system.

### B.2 Creation flow

1. Client: POST /v1/bots/draft {description, locale}.
2. API validates, then asks the sandbox server for a draft job (D.4). The sandbox runs one harness turn in a throwaway workspace using the existing kilo profile. The harness makes the model call through its own configured provider (no LLM call in anu/src/api, nothing new in assistant/).
3. The turn's reply must be a single JSON object. The API parses it with zod (D.5), clamps lengths, strips em dashes and en dashes (replaced with commas), and fills the avatar deterministically from the name (sha256 seed, same scheme as `agentIdentityFor`).
4. Client shows the preview (Sheet 2). The user edits any field.
5. Client: POST /v1/bots with the final fields. Then POST /v1/sessions {bot_id}. Then it routes to the chat.
6. Fallback when the draft fails or the driver cannot run a harness (scripted driver, tests): the API returns a deterministic draft built from the template catalog that best matches the description keywords, or the generic template, with `source: "fallback"`. The UI shows the "Couldn't draft it" note only when `source` is "fallback" because of an error, not in scripted dev mode (`fallback_reason` tells them apart).

Chat route: when the user asks ANU to make a bot, ANU's instructions tell it to reply with a fenced block of type `anu-bot-draft` containing the same JSON. The client renders that block as the preview card instead of text. Saving it calls POST /v1/bots the same way. No new harness tool is needed.

### B.3 Defaults and limits
- Max 20 bots per user (409 `bot_limit`).
- One default bot per user (`users.default_bot_id`, falls back to the ANU bot).
- Model profile null means the account default (`kilo-free` today).
- Approvals: unchanged, Permission controls v2.

## C. Mapping to the harness

All harness paths are under `assistant/`. All sandbox paths are under `anu/src/sandbox/`. The harness workspace for a session is `<ctx.workspaceDir>/harness/.vellum/workspace` (set by `drivers/harness.ts`, VELLUM_WORKSPACE_DIR). Each session has its own workspace, so workspace-level settings are per bot in practice.

### C.1 Field to mechanism

| Bot field | Harness mechanism | How ANU applies it | When |
| --- | --- | --- | --- |
| name, personality, role | `IDENTITY.md` (template `src/prompts/templates/IDENTITY.md`: Name, Emoji, Nature, Personality, Role, `## Avatar`). Loaded into the system prompt by `src/prompts/system-prompt.ts` (PROMPT_FILES, buildCoreIdentityContext). Read back by GET /v1/identity (`src/runtime/routes/identity-routes.ts`). | Write the file into the workspace before the daemon starts. Fields: Name = name, Emoji = "none", Nature = "A personal AI agent that helps with any task", Personality = personality, Role = role. Keep the `## Avatar` heading; `src/avatar/identity-avatar.ts` maintains it. Because the file is not template content (`isTemplateContent`), it is used, and `ensurePromptFiles()` does not seed BOOTSTRAP.md, so no onboarding interview. | Pre-boot |
| instructions | `SOUL.md` (template `src/prompts/templates/SOUL.md`), always in the prompt. | Write the template text unchanged, then append `## This bot` with the instructions. Never replace the template's Boundaries and How You Work sections. The section stays short (system prompt minimalism; 4000 chars is a hard cap, drafts aim for under 600). | Pre-boot |
| avatar (bodyShape, eyeStyle, color) | Avatar store `src/avatar/avatar-store.ts` setCharacter() via POST /v1/avatar/render-from-traits (`src/runtime/routes/avatar-routes.ts`). Ids are the packages/avatar-catalog ids. | `client.call("POST", "/v1/avatar/render-from-traits", traits)` after readiness. The phone renders the avatar from traits itself; this keeps the harness's own view consistent. Failure is logged, never fatal. | Post-boot |
| model_profile | `llm.profiles`, `llm.activeProfile` (`src/config/schemas/llm.ts`, `src/config/llm-resolver.ts`); routes POST /v1/inference/profiles, /v1/inference/active-profile (`src/runtime/routes/inference-profiles-routes.ts`); per-turn `inferenceProfile` on POST /v1/messages. | The driver already creates `kilo-free`. For any other allowlisted name it POSTs /v1/inference/profiles on the existing kilo connection, then passes `bot.modelProfile ?? PROFILE` as `inferenceProfile` in `runTurn` (`drivers/harness-turn.ts`). Users never send provider config. | Post-boot and per turn |
| skills | `skills.entries[id].enabled` in workspace config (`src/daemon/handlers/skills.ts` enableSkill/disableSkill); routes POST /v1/skills/:id/enable, POST /v1/skills/:id/disable, GET /v1/skills. | For each id in `bot.skills`, POST /v1/skills/:id/enable. Ids are validated against the ANU allowlist at create time. | Post-boot |
| greeting, starters | No harness mechanism. Harness conversation starters (`src/persistence/schema/conversation-starters.ts`) are generated from memory and have no write route. | Stored in ANU (`bots.greeting`, `bots.starters`), rendered by the client on the empty state. Harness unchanged. | n/a |
| later: excluded tools | `tools.exclude` (`src/config/schemas/tools.ts`) via POST /v1/config/set. A capability filter, not an approval mode. | Not in v1. | Post-boot |
| later: plugins | PUT /v1/conversations/:id/enabledplugins (`conversation-management-routes.ts`). | Not in v1. | Post-boot |

Not used for bots: `users/<slug>.md` and `persona-resolver.ts` (that is the user's persona), contacts and channels (the user's), and `hatch`, species and the lockfile (machine-level instances).

### C.2 Sandbox changes
- `protocol.ts`: the `session` ParentMessage gains optional `bot?: BotProfile`. The `start` (task) message gains the same optional field. A new `{ t: "draft"; jobId; description; locale; driver; workspaceDir; settings }` message and a `{ t: "draft_done"; jobId; status; json?: string; error?: string }` worker message.
- `drivers/types.ts`: export `BotProfile { id, name, role, personality, instructions, avatar: {bodyShape, eyeStyle, color}, modelProfile: string | null, skills: string[], version: string }` where `version` is a sha256 of the canonical JSON of the other fields. `DriverContext.bot?: BotProfile`.
- `drivers/harness.ts`: new `applyBotProfile(workspace, client, bot)`:
  - Pre-boot (inside `withRuntime` before spawning the daemon): write `IDENTITY.md` and `SOUL.md` (template plus `## This bot`) only if `<workspace>/.anu-bot-version` differs from `bot.version`; then write that sidecar. This keeps the assistant's own later edits to SOUL.md ("Working with [User]") across reboots while the bot is unchanged, and applies edits made in the app.
  - Post-boot: render-from-traits, extra inference profile if needed, skills enable.
  - Idempotent: a resumed session reboots on the same workspace and repeats the post-boot calls safely.
- Session without a bot (old rows): behaves as today, using the ANU default profile.
- `drivers/scripted.ts` and `drivers/kilo.ts`: accept `bot` and include its name in their output so tests can assert it reached the driver. They answer `draft` with a deterministic fallback.
- Bot edits: the API sends nothing to running workers. The next worker start (idle timeout or restart) picks up the new version. To make edits apply on the next turn, the API stops idle session workers whose `bot_version` is stale when a turn arrives, and respawns with the new profile (history is replayed as today).

## D. API contract

All endpoints need the bearer token. Errors use the existing `{ error: { code, message } }` shape. Strings in bot fields are trimmed; em dashes and en dashes are replaced with commas on write.

### D.1 Database (migration `anu/db/migrations/0004_bots.sql`)

```sql
create table bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  default_key text check (default_key in ('anu', 'researcher', 'shopper')),
  name text not null check (char_length(name) between 1 and 40),
  role text not null default '' check (char_length(role) <= 120),
  personality text not null default '' check (char_length(personality) <= 200),
  greeting text not null default '' check (char_length(greeting) <= 280),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  starters jsonb not null default '[]'::jsonb check (jsonb_typeof(starters) = 'array' and jsonb_array_length(starters) <= 3),
  body_shape text not null,
  eye_style text not null,
  color text not null,
  model_profile text,
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  locale text not null default 'en' check (locale in ('ar', 'en')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, default_key)
);
create index bots_user on bots (user_id, last_used_at desc nulls last);
-- RLS: same policy pattern as agents (bots_scope).

alter table chat_sessions add column bot_id uuid references bots (id) on delete set null;
alter table chat_sessions add column bot_version text;
alter table tasks add column bot_id uuid references bots (id) on delete set null;
alter table agents add column bot_id uuid references bots (id) on delete set null;
alter table users add column default_bot_id uuid references bots (id) on delete set null;
```

Defaults are per-user rows (not shared rows with a null owner), so every bot follows the one RLS rule and users can edit them. They are created lazily and idempotently (`insert ... on conflict (user_id, default_key) do nothing`) on the first GET /v1/bots, GET /v1/sessions or POST /v1/sessions for that user, in the request's locale (`Accept-Language`, `ar` if it starts with `ar`, else `en`).

### D.2 Resource shape

```json
{
  "id": "6f1c2a8e-3b4d-4c5e-9f60-7a8b9c0d1e2f",
  "name": "باحث",
  "role": "يبحث ويقارن المصادر",
  "personality": "هادئ ودقيق",
  "greeting": "أهلاً، أنا الباحث. عن ماذا أبحث لك؟",
  "instructions": "Find sources, compare them, and cite each claim with a link.",
  "starters": [{ "label": "قارن أسعار الهواتف", "prompt": "قارن أسعار أحدث ثلاثة هواتف" }],
  "avatar": { "bodyShape": "stellar", "eyeStyle": "curious", "color": "teal" },
  "modelProfile": null,
  "skills": [],
  "locale": "ar",
  "isDefault": true,
  "defaultKey": "researcher",
  "deletable": true,
  "status": "idle",
  "lastUsedAt": "2026-10-30T09:14:00Z",
  "createdAt": "2026-10-30T09:00:00Z",
  "updatedAt": "2026-10-30T09:00:00Z"
}
```

`status` is the most urgent state among the bot's live agents: `waiting_for_you` > `working` > `failed` > `idle`. `deletable` is false only for `defaultKey: "anu"`.

### D.3 Endpoints

| Method and path | Body | Success | Errors |
| --- | --- | --- | --- |
| GET /v1/bots | none | 200 `{ bots: Bot[], defaultBotId }`, ordered: waiting, working, then last_used_at desc | 401 |
| GET /v1/bots/options | none | 200 `{ modelProfiles: string[], skills: [{ id, label }], templates: [{ key, label, description }] }` (labels resolved from the request locale on the client via i18n keys; API returns keys) | 401 |
| POST /v1/bots/draft | `{ description: string 1..500, locale?: "ar"\|"en" }` | 200 `{ draft: BotInput, source: "model"\|"fallback", fallbackReason?: "driver_unavailable"\|"timeout"\|"invalid_output"\|"error" }` | 400 `invalid_request`, 401, 429 `rate_limited` (10 per user per hour) |
| POST /v1/bots | `BotInput` | 201 `Bot` | 400 `invalid_request` (field path in message), 409 `bot_limit` |
| GET /v1/bots/:botId | none | 200 `Bot` | 401, 404 |
| PATCH /v1/bots/:botId | partial `BotInput` | 200 `Bot` | 400, 401, 404 |
| DELETE /v1/bots/:botId | none | 204. Sessions keep their history with `bot_id` set null; they show the agent's stored name and avatar. | 401, 404, 409 `bot_not_deletable` (ANU) |
| POST /v1/bots/:botId/duplicate | none | 201 `Bot` (name gets " 2" / " ٢" suffix, `defaultKey` null) | 401, 404, 409 `bot_limit` |
| PUT /v1/me/default-bot | `{ botId }` | 204 | 400, 401, 404 |

`BotInput` = `{ name, role?, personality?, greeting?, instructions?, starters?, avatar?, modelProfile?, skills?, locale? }`. If `avatar` is omitted it is derived from the name. Unknown properties are rejected (zod `.strict()`).

Validation (shared zod schema in `anu/src/api/bots.ts`):
- `name` 1..40 after trim, no control characters.
- `avatar.bodyShape` in BODY_SHAPES, `eyeStyle` in EYE_STYLES, `color` in AVATAR_COLORS (from `anu/src/api/agents.ts`).
- `modelProfile` null or in `BOT_MODEL_PROFILES` (initially `["kilo-free"]`).
- `skills` each in `BOT_SKILL_IDS` (curated constant; initially empty, so the UI hides Skills).
- `starters` at most 3, each label 1..60 and prompt 1..500.
- Lengths as in B.1.

Ownership: every query runs under the existing per-request RLS context (`anu_current_user_id()`). A bot id belonging to another user returns 404, never 403. `bot_id` on sessions and tasks is checked inside the same transaction.

### D.4 Sessions, tasks and agents

- POST /v1/sessions body: `{ title?: string, botId?: uuid }`. If `botId` is omitted the user's default bot is used. 404 if the bot is not the user's. The session stores `bot_id` and `bot_version`; `last_used_at` of the bot is updated.
- ChatSession responses gain `botId` and `bot: { id, name, avatar }` (null if deleted).
- GET /v1/sessions gains query `botId` to filter.
- POST /v1/tasks body gains optional `botId` with the same rules.
- Agent rows: `insertAgent` takes the bot's name and traits when `bot_id` is set (instead of `agentIdentityFor`), and stores `bot_id`. Agent responses gain `botId`. Old agents keep their random identity.
- The API passes the bot to the sandbox as `BotProfile` in the `session` and `start` messages through `sandbox-client.ts`.
- Draft job: the API calls the sandbox server `POST /internal/drafts` `{ description, locale }` and waits up to 15s. The sandbox runs a `draft` worker in a temporary directory that is deleted afterwards. The harness driver boots the runtime with no bot profile and sends one turn whose text is a fixed prompt asking for a JSON object with keys `name, role, personality, greeting, instructions, starters` in the given language, no other text. Any non-JSON reply is `invalid_output` and triggers the fallback.

### D.5 Draft output schema

```ts
z.object({
  name: z.string().min(1).max(40),
  role: z.string().max(120),
  personality: z.string().max(200),
  greeting: z.string().max(280),
  instructions: z.string().max(4000),
  starters: z.array(z.object({ label: z.string().min(1).max(60), prompt: z.string().min(1).max(500) })).max(3),
})
```

The API takes the first `{ ... }` block in the reply, parses it, truncates over-long strings rather than failing, and adds `avatar` from the name.

### D.6 Seeded default bots

Created per user in their locale. Instructions are stored in English (they are prompt text, not UI) and include "Reply in the user's language."

| default_key | name en / ar | role en / ar | avatar | instructions (summary, final text in `anu/src/api/default-bots.ts`) |
| --- | --- | --- | --- | --- |
| anu | ANU / ANU | Your personal AI agent for any task / وكيلك الشخصي لأي مهمة | stellar, gentle, (catalog colour closest to brand blue) | General help. When asked to make a bot, reply with an `anu-bot-draft` fenced JSON block (D.5 shape) and one short sentence. |
| researcher | Researcher / باحث | Finds and compares sources / يبحث ويقارن المصادر | dendrite, curious, teal | Search, read several sources, compare, cite links, state what could not be checked. |
| shopper | Shopper / متسوّق | Compares prices and options / يقارن الأسعار والخيارات | cloud, goofy, orange | Compare products and prices, never buy or pay without an approval. |

Greetings and starters are seeded from i18n-matched constants in both languages, for example ANU: "أهلاً، أنا ANU. بماذا أساعدك؟" / "Hi, I'm ANU. What can I help with?" with starters "خطّط لعطلة نهاية الأسبوع" / "Plan my weekend", "لخّص لي خبراً" / "Summarize a news story", "اصنع لي بوتاً" / "Make me a bot".

### D.7 Docs and tests
- Update `anu/openapi.yaml` (schemas Bot, BotInput, BotDraft; the endpoints above; new fields on ChatSession, Task, Agent) and `anu/docs/api.md`.
- Tests (scoped paths only): `anu/src/api/bots.test.ts` (CRUD, validation, ownership 404, limit, ANU not deletable, lazy seeding idempotent and localized, draft fallback with scripted driver), additions to `sessions.test.ts` (botId default, foreign bot 404, agent takes bot identity), `anu/src/sandbox/drivers/harness-bot.test.ts` (IDENTITY.md and SOUL.md contents, sidecar version skip, SOUL template sections preserved, inferenceProfile passed), and client model tests under `clients/web/src/domains/anu/`.
- Phone numbers in fixtures only 555-0100 to 555-0199.

## E. Acceptance checklist

Critics check each item on each screen in four captures: ar light, ar dark, en light, en dark. An item fails if any capture fails it.

### E.1 Owner requirements
1. Launch to typing in a chat takes zero taps after the splash for a signed-in user.
2. The mark appears only on the splash (and the native launch screen and app icon). No header, drawer, login, settings or empty state shows it or the wordmark.
3. Splash lasts at most 1.2s in total and crossfades into a chat with the bot avatar in place.
4. A first-run user sees three bots (ANU, Researcher, Shopper) in the switcher and drawer without enabling anything.
5. Creating a bot from the switcher takes: open switcher, New bot, type one sentence, Create, Start chatting. The generated preview has name, role, greeting, up to 3 starters and an avatar.
6. Reroll changes name and avatar together; tapping the avatar opens body, eyes and colour.
7. Asking ANU "make me a bot that ..." in chat shows the preview card inline, and saving it creates the bot.
8. A bot's name, role and instructions reach the harness through IDENTITY.md and SOUL.md (`## This bot`), verifiable by the driver test and by GET /v1/identity on a live sandbox. No other persona store exists.
9. Editing a bot changes the next turn of its chats.
10. Sessions are chats (messages, greeting, starters), reached from the drawer "Chats" and from bots. They never show a task timeline as their main content.
11. Tasks stay separate under Tasks with their own step timeline.
12. The Agents screen shows working, waiting and finished agents, each with its bot's animated avatar, and the finished ones show the result's first line.
13. Browser and Files open as full-screen windows from cards in the chat (and from the kebab). There are no Browser or Files tabs anywhere.
14. Back from a window returns to the same chat scroll position.
15. Approvals appear inline in the chat with Allow and Not now, using Permission controls v2 unchanged.
16. Arabic is complete: every visible string is translated, layout mirrors (drawer from the right, chevrons, back gesture), digits are Arabic-Indic, mixed text renders correctly.
17. Dark mode uses the neutral ground #0B0D10, not navy, and every text token meets 4.5:1 (muted included); light mode is not an inversion of dark.
18. Nothing on any screen looks like the original Vellum app's task-centred home or its header logo.
19. Identity (0.3): the one-liner appears in en and ar exactly as written; no user-facing string in the app (i18n `en` and `ar`, splash, login, empty states, errors, seeded bot greetings and starters) uses a banned internal term in either language; there is no onboarding tour; approval cards are one plain question in the bot's voice ("Send this email to Sara?"). Files owned by the separate copy agent (README, ANU-VOICE, BRAND, persona templates, skills) are out of scope for app review.

### E.2 Taste rules
20. No em dashes or en dashes in UI strings, docs, seeded text or code comments added in this round.
21. No emoji in the UI. No gradients, glass, glows, blur or shimmer. No KPI tiles, no icon-in-circle cards, no eyebrow labels, no letter-spaced capitals, no "Welcome back" banner.
22. Accent covers under 5% of each screen and appears only on send, focus rings, links and the current-bot check.
23. One status mark per row or card.
24. Cards have no 1px borders (the New bot dashed outline is the one exception) and no shadows; only composer, sheets and drawer float.
25. One type family, five sizes (13, 15, 17, 22, 28), no monospace labels.
26. Motion only signals state: thinking only while busy, success once, waiting held without pulsing; reduced motion shows static poses.
27. Every list and window has an empty, loading (grey blocks at real size) and error state with a retry, as written in section A.
28. Copy is short, plain and specific; errors say what happened and offer one action.

### E.3 Correctness and running
29. `/v1/bots*` endpoints match section D, including 404 for another user's bot, 409 for the bot limit and for deleting ANU, and `.strict()` rejection of unknown fields.
30. POST /v1/sessions without botId uses the default bot; agent rows take the bot's name and traits.
31. Lazy default seeding is idempotent under concurrent first requests.
32. Draft works with the harness driver and falls back deterministically with the scripted driver.
33. The sandbox writes IDENTITY.md and SOUL.md before boot, keeps the SOUL template sections, skips rewrites when the version sidecar matches, and passes the bot's inference profile.
34. No LLM call is added in anu/src/api or anywhere outside the harness's configured provider.
35. New i18n keys exist in `en` and `ar` catalogs and the catalog tests pass.
36. Scoped tests pass (`bun test <paths>` only), typecheck and lint pass, and dependency versions are exact.
