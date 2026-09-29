# OT List Extractor

A single-page web app for a thesis comparing two methods of chordee correction in
Byar's flap repair. Photograph the day's OT list, and it pulls out every case on
the list and flags the ones that belong to the study.

Everything runs in the browser. No server, no upload, no account — the photo and
the patient details never leave the device.

## Using it

1. **Capture** — take a photo of the OT list, or pick/paste an image. Set the list date.
2. **Select the table** — drag a box around **one** list. If two sheets are in the
   photo, select one, extract it, then come back and select the other with
   *Add to cases already in Review* ticked.
3. **Clean up** — rotate if needed and adjust the sliders while watching the preview.
4. **Extract cases** — the app reads the list and jumps to the review table.
5. **Review** — every cell is editable. Rows matching the study are highlighted green
   and ticked under *Mine*; tick or untick any row by hand to override.
6. **Save** — stores the list in this browser. Export CSV whenever you want it in Excel.

Cells the app is unsure about are underlined in amber — check those first.

## How the reading works

The app tries the ruled table first. It straightens the page, finds the printed
rules, takes the columns from the vertical ones and the patient rows from the
horizontal ones, then drops each recognised word into the cell it sits in. That
is what makes a diagnosis wrapped over four lines stay in one cell, and it maps
the form's own columns — S.No, Name, Age/Sex, CR No., Ward/Bed, Diagnosis,
Procedure, Viral serology, Blood group, Duration, Special requirement, Position,
Operating surgeon and team, Anaesthesia, Remarks.

One quirk of this form is handled deliberately: its horizontal rules do not cross
the whole table — the right-hand columns are divided at their own heights — so
row boundaries are measured over the left columns only, where the divisions line
up with actual patients.

If no grid is found (an unruled or handwritten list), it falls back to reading the
text and inferring rows from serial numbers. The toast after extraction tells you
which path ran, and the raw panel shows the detected geometry.

## How a case gets flagged

A row is marked as yours when it matches a **strong** term (chordee, Byar's flap,
orthoplasty, penile curvature …), or a **supporting** term (hypospadias,
urethroplasty, TIP, Snodgrass …) *together with* an operative word such as repair,
correction or plasty. The second condition is what keeps a hypospadias follow-up
in OPD out of the operative set.

Matching is fuzzy, so OCR damage still matches: `chordec`, `hypospodias` and
`Byar s flcp` are all caught. Short abbreviations are matched exactly rather than
fuzzily — otherwise `TEF repair` (tracheo-oesophageal fistula) matches `TIP repair`
(tubularised incised plate), which is a different operation on a different child. Both term lists are editable under **Settings** and
are saved in the browser — after editing, rows you haven't overridden by hand are
re-checked automatically.

## Getting good results

Recognition quality is set almost entirely by the photo:

- **One sheet per photo, filling the frame.** Resolution is the single biggest
  factor: the whole point is that each character gets enough pixels. Two sheets in
  one frame halves that, and small print is the first thing to suffer.
- Keep the paper flat — a few degrees of rotation is corrected automatically.
- Even light. A shadow across the page is the single biggest cause of garbled rows.
- Shoot square-on rather than at an angle.
- **Sharpen text** at ~12 suits a photographed page; set it to **0** for a clean
  printed list or a screenshot, where thresholding only adds artefacts.
- If rows come out jumbled, try **Page layout → Single column** or **Sparse text**.

Expect to correct some cells, especially with handwritten lists — that is what the
review table is for. Always check extracted values against the original list before
using them as study data.

## Notes on the data

- Records live in this browser's `localStorage`, tied to this exact address.
  Clearing site data, or "clear cookies and site data" on the phone, erases them.
- **Download a JSON backup regularly** (Saved lists → Download backup) and keep it
  somewhere safe. Restore puts it back on any device.
- The first extraction downloads the OCR engine and English data (~15 MB) from a
  CDN; the browser caches it afterwards and the app then works offline. To avoid
  the CDN entirely, host `tesseract.js`, `worker.min.js`, the core `.wasm` files
  and `eng.traineddata.gz` yourself and set, before `js/app.js` loads:

  ```html
  <script>
    window.OTX_OCR_PATHS = {
      workerPath: './vendor/worker.min.js',
      corePath: './vendor/',
      langPath: './vendor/lang',
    };
  </script>
  ```

## Publishing to GitHub Pages

In the repository: **Settings → Pages → Build and deployment**, set *Source* to
**Deploy from a branch**, pick this branch and the `/ (root)` folder, and save.
The site appears at `https://<user>.github.io/<repo>/` after a minute or so. Add
it to your phone's home screen for one-tap access.

Because the app is served over HTTPS, the camera and file picker work directly
from the phone.

## Layout

| File | What it does |
| --- | --- |
| `index.html` | Page structure and the four tabs |
| `css/styles.css` | Styling, light and dark |
| `js/preprocess.js` | Rotation, upscale, grayscale, contrast, despeckle, adaptive threshold |
| `js/grid.js` | Deskew, detection of the printed rules, cell rectangles |
| `js/table.js` | Grid reading: words into cells, columns matched to the form |
| `js/ocr.js` | Tesseract worker, line extraction, rejection of noise lines |
| `js/parse.js` | Free-text fallback: row assembly, field extraction, case flagging |
| `js/storage.js` | localStorage records, CSV and JSON export |
| `js/app.js` | UI wiring |

Organising the collected data and tracking patients over time is not built yet —
CSV export is the bridge to a spreadsheet until then.
