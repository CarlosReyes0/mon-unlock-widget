# Weekly Update – Open Paywall 🧠 Week #36

**Project:** Open Paywall  
**Period:** August 30 – September 5, 2026  
**Live:** https://mon-unlock-widget-production.up.railway.app

Let's go 👇

---

## 1. TL;DR

**Quick wins ✅**  
We shipped **11 updates**. An AI helper can now post an article for you at **50 cents**. You can text it the title, price, and story from your phone. We launched a public **Articles** page so people can find and pay for stories on our site. The pay button now shows the price *before* you tap.

**Challenges 😤**  
The new Articles page broke three times on launch day: the page was missing, payments wouldn’t start, and stories looked free. One person got charged by surprise. We hid that story and put the price on the button.

**What's next 🔮**  
Put a few real stories on the Articles page. Try a 50-cent unlock on someone’s actual website. Remember the payment type (dollars vs MON) in the writer dashboard.

---

## 2. Highlights

One line per update we shipped this week:

- **#42** — If an AI helper posts your article, readers pay **50 cents** by default. You can still charge in MON if you want.
- **#43** — You can text the helper your title, price, teaser, and story from your phone. No forms or code.
- **#44** — The author name box starts empty, so your phone won’t fill in your real name.
- **#45** — Sign in with email, Google, or a wallet now works on iPhone.
- **#46** — Photos and videos are checked before they go in. You can edit the story later without starting over.
- **#47** — On iPhone, Add photo / video buttons stay on screen when the keyboard is open.
- **#48** — Writers can list a story on our Articles page. Pay once, read it here or on the writer’s own site.
- **#49** — The Articles page was missing on the live site. We put it back.
- **#50** — Stories on our site wouldn’t take payment. They do now. Stories pasted on other sites still need the writer’s stamp.
- **#51** — The button now says **Pay 0.50 USDC** before you tap, so nobody thinks it’s free.
- **#52** — Removed leftover shop tabs on old demo pages that made people think they were browsing a store.

**Why this matters:**  
Writers and AI helpers now both default to a simple **50-cent** unlock on Monad. And readers can find stories on our site — they don’t have to already know the writer’s blog.

---

## 3. Lowlights

- 😓 **#49** — We launched the Articles page and it showed “not found.” We forgot to include the new pages on the live server.
- 😓 **#50** — Then payments wouldn’t start on those stories. We fixed it the same day.
- 😓 **#51** — Stories looked like free samples. Someone got charged. We hid that story and put the price on the button.
- 😓 **#45 / #47** — iPhone still bit us: sign-in buttons did nothing, then Add photo buttons hid behind the keyboard.
- 😓 **We still don’t have simple weekly numbers** — how many writers, how many unlocks. Same gap as last week.

Being honest so we can fix fast.

---

## 4. Core Metrics

| What we track | This week | In plain English |
|---------------|-----------|------------------|
| **Updates shipped** | 11 | Work that went live Aug 30 – Sep 3 |
| **Ways to pay on Monad** | 2 | Dollars (USDC) or MON |
| **Public pages** | Home + Articles | Articles is new; one story is hidden after the surprise charge |
| **Default price** | 50 cents | Writers can still pick MON instead |

*(We still owe you writer count and unlock count. Next week.)*

---

## 5. This Week's Focus

→ Put **2–3 real stories** on the Articles page and pay for one ourselves.  
→ Put a 50-cent unlock on a **real website** (not just ours) — leftover from last week.  
→ Remember in the dashboard whether a story charges dollars or MON.

---

## 6. Asks

- Know a writer who’d try listing one **50-cent** story on our Articles page this week?
- Does the Articles page help you find stories, or do you only care about embeds on a writer’s own site?
- Monad / DeltaV — should we push **50-cent dollars** or **MON** as the default for everyday readers?

---

## 7. Shoutouts

🙏 **Cursor Cloud Agents** — 11 updates, including the same-day scramble to unbreak Articles.  
🙏 **The person who paid by surprise** — sorry. The price is on the button now.  
🙏 **Pareen / DeltaV** — for a format that stays short.

---

## Appendix: What we shipped (Aug 30 – Sep 5)

| Update | When | What it was |
|--------|------|-------------|
| [#42](https://github.com/CarlosReyes0/mon-unlock-widget/pull/42) | Aug 31 | AI helper posts default to 50 cents |
| [#43](https://github.com/CarlosReyes0/mon-unlock-widget/pull/43) | Aug 31 | Text your story from a phone |
| [#44](https://github.com/CarlosReyes0/mon-unlock-widget/pull/44) | Sep 1 | Author name starts empty |
| [#45](https://github.com/CarlosReyes0/mon-unlock-widget/pull/45) | Sep 1 | iPhone sign-in works |
| [#46](https://github.com/CarlosReyes0/mon-unlock-widget/pull/46) | Sep 1 | Check photos; edit later without starting over |
| [#47](https://github.com/CarlosReyes0/mon-unlock-widget/pull/47) | Sep 2 | Add photo buttons stay visible on iPhone |
| [#48](https://github.com/CarlosReyes0/mon-unlock-widget/pull/48) | Sep 3 | Public Articles page |
| [#49](https://github.com/CarlosReyes0/mon-unlock-widget/pull/49) | Sep 3 | Articles page was missing; fixed |
| [#50](https://github.com/CarlosReyes0/mon-unlock-widget/pull/50) | Sep 3 | Listed stories can take payment |
| [#51](https://github.com/CarlosReyes0/mon-unlock-widget/pull/51) | Sep 3 | Price on the pay button |
| [#52](https://github.com/CarlosReyes0/mon-unlock-widget/pull/52) | Sep 3 | Removed leftover shop tabs |

**Try it:** https://mon-unlock-widget-production.up.railway.app/articles
