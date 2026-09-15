# Trial

Two tools for running and studying an operating list. They are independent — no shared
code, no shared data — and live side by side in this repository.

| | What it is | Where it lives | Full README |
| --- | --- | --- | --- |
| **OT List Extractor** | Photograph the day's OT list and pull out every case, flagging the ones that belong to the chordee / Byar's flap thesis. Runs entirely in the browser; nothing leaves the device. | `index.html`, `css/`, `js/` | [README-extractor.md](README-extractor.md) |
| **OT Manager** | Plan the lists in the first place: patients, workup, giving a patient a date and ringing them about it, an auto-generated but always-editable OT list, printing, and calendar sync. Node server plus a SQLite file. | `server/`, `client/` | [README-ot-manager.md](README-ot-manager.md) |

Roughly, the extractor reads a list that already exists on paper; the manager produces the
list in the first place. Nothing connects them yet — the extractor's CSV export is the
bridge if you want its output somewhere else.

## Running them

**OT List Extractor** — static files, so open `index.html` directly, or serve the repository
root over HTTPS (GitHub Pages works; see its README) so the phone camera is available.

**OT Manager** — needs Node 20.11 or newer:

```bash
npm install
cp .env.example .env     # set SESSION_SECRET and your initial login
npm run seed             # optional: a week of demo data
npm run dev
```

The `package.json` at the root belongs to OT Manager and drives both its workspaces. The
extractor has no build step and no dependencies.

## A note on patient data

Both tools handle identifiable clinical information, and neither is hardened for it out of
the box. The extractor keeps everything in the browser's `localStorage`, which is erased by
clearing site data — take backups. OT Manager needs to sit behind HTTPS before it is used
for real, and its calendar subscription URL is readable by anyone holding the link. Each
README sets out what is on you rather than on the code; read that section before either
tool sees a real patient.
