# Shiftmaxxing 🕐

The little command center for our support team. It shows who's on shift, who's on break, who's covering what, and where every open case stands — all on one screen, all in real time, no spreadsheet archaeology required.

Think of it as mission control for the team's day. There's even a tiny pixel world where everyone walks around. We'll get to that.

---

## First things first: signing in

When you open it, you pick how you're getting in:

- **Manager** — full control. You can move shifts around, approve overtime, mark people absent, the works. Needs the manager password.
- **Agent** — that's most of us. Type the agent password, tap your name, confirm it's really you. You can manage *your own* shift and breaks. No fiddling with other people's lanes (on purpose 🙂).
- **View only** — no password, look but don't touch. Great for throwing it up on a screen.

Everything runs on **UTC** — there's a big clock at the top so nobody has to do timezone math in their head at 3am.

---

## The tabs (left menu)

### 🟨 Command
The main event. Pick a day up top, then see everyone's shift one of three ways:

- **Clock** — a 24-hour circle, like a real clock but it's everyone's shifts stacked in rings. The hand shows the current hour, live.
- **1 Day** — the same info as a straight timeline bar, if circles aren't your thing.
- **14 Days** — the big-picture two-week view.

**Online now** sits at the top — little pills for whoever's on shift this moment. On break? Their pill turns amber with a ☕ and a timer. Tap your own pill to start a break (it asks "you sure?" once so a fat-finger doesn't yeet you onto a break).

**Shift levers** are the draggable bars for each person. Grab an end and drag to shrink or stretch your shift. Shrink it and the hours you drop become "up for grabs" for someone else. Stretch past your normal end and it logs as overtime (with sensible limits so nobody accidentally signs up for a 19-hour day). Prefer precision? The ±30m buttons do the same thing without the drama.

**Coverage gaps** show up as red dashes — that's a chunk of the day nobody's covering. Click it to grab the slot (or, if you're a manager, hand it to someone).

> **Time travel note:** past days are **read-only** — they're history, you can't rewrite them. Today is live. Future days are a *preview* of the regular weekly schedule, so heads up: editing a future day changes that weekday going forward, not just that one date. The app tells you which mode you're looking at, so you won't get surprised.

### 📜 Activity
The team's diary. Breaks taken, shifts changed, coverage handed off — it all lands here with a timestamp. Filter by last hour / day / week / month, or search the whole thing. Need a clean slate on screen? **Archive** tucks old entries away without actually deleting them (they wait in the Library). Managers can hard-delete too, but it asks twice because gone-gone is gone-gone.

### ⏰ Overtime
Where extra hours and coverage pickups live their lives: **pending → approved → paid**. If two people want the same open slot, they "join the line" and a manager picks. Clean, no Slack arguments.

### 👥 Agents
The roster. Names, colors, roles, timezones, who's off which days, and the standard weekly shift template. Mostly manager territory, but you can tweak your own profile and even upload a custom little sprite for the world (see below 👇).

### 🌐 World
Pure joy, honestly. A little pixel-art office where everyone shows up as a character. On shift? You're at a desk. On break? Breakroom with a coffee. Sick? Clinic. On vacation? You're literally at the beach. It's the team's status at a glance, but make it a video game.

### 🛟 Cases
A live, tidy view of every support case the team has escalated — pulled straight from the case tracker. Filter by Open / Resolved, search anything, click a case for the full story plus quick links to the Slack thread and Intercom. Updates itself, so just leave it open and check whenever. (Editing case status from here is coming soon — for now it's read-and-track.)

---

## The stuff that makes life easier

- **Breaks track themselves.** Scheduled break time arrives, the app puts you on break and brings you back 30 minutes later — and logs it — even if nobody's looking at the screen.
- **Sick / Vacation** — mark a day or a whole range. The person's shifts free up automatically and they show up in the clinic/beach in the world.
- **Overnight shifts** (like 23:00–07:00) just work. The clock wraps the arc around midnight, the timeline splits it across the day. No weird math.
- **Everything's live.** Someone starts a break or grabs coverage, everyone else's screen updates on its own. No refresh-spamming.

---

## Quick "how do I…"

| I want to… | Do this |
|---|---|
| Take a break | Tap your pill in **Online now** (or the break button on your card), confirm |
| Cover for someone | Find the red gap or freed slot on Command, click it, claim it |
| Drop part of my shift | Drag your lever in, or use the ◀ 30m button — freed time goes up for grabs |
| See what happened yesterday | **Activity** tab, or pick a past day on Command (read-only) |
| Check a support case | **Cases** tab, search or filter, click for details |
| Find someone right now | **World** tab — desk, breakroom, clinic, or beach |

---

That's it. If something's confusing or you wish it did a thing it doesn't, poke Gab. 🛠️
