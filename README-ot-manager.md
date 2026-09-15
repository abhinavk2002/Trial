# OT Manager

A theatre-list and patient-scheduling app for a surgical consultant. It follows a case
from first workup, through offering the patient a date and ringing them to check they can
make it, to a printed operating list on the day — and it puts every dated case into your
calendar automatically.

## What it does

**Patients and cases.** Each patient carries their demographics, phone numbers,
comorbidities, allergies and blood group. Each patient can have several surgical cases over
time, and each case records the diagnosis, the planned procedure and side, the anaesthetic,
the expected theatre time, the implants and equipment, and the flags that matter on the
day — day care, infected, ICU bed needed, frozen section, units to cross-match.

**Workup.** Every new case gets your standard pre-op checklist (editable in Settings), and
you tick items off as they come back. A case is not offered a date until you say it is
ready, and the dashboard tells you which dated patients still have gaps — no consent, no
anaesthetic review, unfinished workup.

**Dating patients and ringing them.** When a case is ready you give it a date. The dialog
shows what is already booked that day and how much theatre time is spoken for, so you can
see whether the day has room. A date starts out *provisional*; you log the call when you
ring the patient, and the outcome moves the case on its own:

| Outcome | What happens |
| --- | --- |
| Accepted the date | Case is confirmed for that date |
| Declined the date | Date is freed, patient goes back into the waiting pool |
| Will call back / No answer | Date held provisionally, reminder set for the ring-back |
| Wants to defer | Logged, so you know to offer something later |

Patients due a ring-back appear on the dashboard.

**Automatic OT lists.** Once you have dated a few patients for a day, open OT Lists for that
date and press *Generate the OT list*. Everyone dated for that day is placed in a sensible
running order and given a planned start and finish time based on their expected theatre
time plus your turnover allowance.

The suggested order follows the conventions most units run on:

1. Clean cases before contaminated or infected ones — infected cases always go last,
   whatever their priority.
2. Emergency before urgent before routine.
3. Within a tier: children first, then diabetics, then day-care cases — the patients who
   tolerate a long starvation period least well, or who need to go home the same day.
4. Shorter cases before longer ones, so an overrun pushes the fewest patients.
5. Otherwise stable.

**Changing the list is always allowed.** Drag a case, use the up/down arrows, edit a case's
theatre time for that list, add a patient, take one off, move the whole list to a different
day, change the start time or turnover. Every change re-times the list immediately. Nothing
is ever reshuffled behind your back: dating another patient afterwards and pressing
*Generate* again simply appends them to the end of the list you already arranged — and if
your order has drifted from the suggested one, the list says so and offers to re-apply it.
Lock a list when it is final; unlocking is one click. Marking cases in-theatre or done stays
possible even while locked, so the list can be run on the day.

**Printing.** The Print button produces a clean one-page operating list — running order,
times, hospital numbers, procedure and side, anaesthetic, and a notes column carrying
allergies, blood, implants, ICU and frozen-section flags.

**Calendar sync.** Settings gives you a private subscription URL. Add it once to Google
Calendar, Apple Calendar or Outlook and every dated case appears in your calendar with the
patient, procedure, theatre, contact number and preparation notes — updating on its own as
the lists change. Cases with a list slot get a timed event with a one-hour reminder; cases
that only have a date get an all-day event. Provisional dates show as tentative. There is
also a per-case `.ics` download if you only want one operation in your calendar.

## Running it

Needs Node 20.11 or newer.

```bash
git clone <this repo>
cd Trial
npm install

cp .env.example .env        # then edit it — see below
npm run seed                # optional: a week of realistic demo data
npm run dev
```

`npm run dev` starts the API on <http://localhost:4000> and the app on
<http://localhost:5173>. Sign in with the `INITIAL_USER_EMAIL` / `INITIAL_USER_PASSWORD`
from your `.env`, then change the password from Settings.

For a single always-on process instead:

```bash
npm run build
NODE_ENV=production npm start     # serves the API and the app on PORT
```

### Configuration

Copy `.env.example` to `.env` and edit it. The two that matter:

- **`SESSION_SECRET`** — signs login cookies. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The server
  refuses to start in production without it, and changing it signs everyone out.
- **`INITIAL_USER_EMAIL` / `INITIAL_USER_PASSWORD`** — used *once*, on first boot, to create
  your account. Changing them later does nothing; change the password from Settings.

`DATABASE_PATH` (default `data/ot.db`) is a single SQLite file. Copy it to back up, and
copy it back to restore. Set `SECURE_COOKIES=true` if you put the app behind HTTPS.

## Before using it with real patients

This holds identifiable clinical data, so a few things are on you rather than on the code:

- **Put it behind HTTPS.** The login cookie is `httpOnly` and `sameSite=lax`, but it is only
  marked `Secure` when you set `SECURE_COOKIES=true`, and passwords cross the wire in the
  clear over plain HTTP. Terminate TLS in front of the app (Caddy, nginx, Cloudflare Tunnel)
  before it leaves your machine.
- **The calendar URL is a bearer token.** Anyone with that link can read your whole
  schedule, including patient names and procedures, without signing in — that is the price
  of calendar apps being unable to log in. Treat it like a password, share it with nobody,
  and use *Generate a new link* in Settings if it leaks.
- **Back the database file up**, and check your institution's rules on where patient data
  may be stored before putting it on a hosted server.
- There is no audit-grade access log or encryption at rest, and one account means no
  per-user accountability. If your governance requires those, this needs more work first.

## How it is put together

```
server/            Express + SQLite (better-sqlite3), TypeScript
  src/schema.sql     the whole data model, applied idempotently on boot
  src/lib/scheduling.ts  ordering rules and running-order times
  src/lib/ics.ts     RFC 5545 calendar writer
  src/routes/        auth, patients, cases, OT lists, calendar, settings, dashboard
client/            React + TypeScript, built with Vite; plain CSS, no UI framework
```

Passwords are hashed with scrypt. Sessions are a signed, expiring cookie — no session table
to sweep. Calendar times are written as floating local times, so 09:00 shows as 09:00 in any
calendar app, which is what a list on a theatre wall means.

Useful scripts:

```bash
npm run dev         # API + app with hot reload
npm run build       # typecheck and build both
npm start           # run the built server (serves the built app too)
npm run seed        # demo data — refuses to touch a database that has patients in it
npm run typecheck   # both workspaces
```
