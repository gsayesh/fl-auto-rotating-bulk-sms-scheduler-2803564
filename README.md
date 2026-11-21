# Zamu — Auto-Rotating Bulk SMS Scheduler (Android)

*Zamu* is Swahili for "turn": every SMS takes its turn in the template carousel.

This folder holds the interactive prototype, the rotation engine and its tests, plus the screen
designs for all 7 pages of the brief.

| Page in the brief | Screen | File / route |
|---|---|---|
| PAGE_1 Home & dashboard | Rotation dial, next SMS, progress, Start / Pause, every page one tap away | `index.html#/home` |
| PAGE_2 Clients | Add manually, phonebook search ("jo" → select all), Excel / CSV, Google Sheet, auto-add new contacts | `#/clients` |
| PAGE_3 SMS templates | Type or import from Excel / CSV, fixed rotation order, 160-character / SMS counter, bulk edit | `#/templates` |
| PAGE_4 Schedule | Date, time, interval (seconds or minutes), night pause, skip days, SIM 1 / SIM 2, Start / Pause | `#/schedule` |
| PAGE_5 SMS scheduled planner | Client × template grid (as in the attachment), last SMS of the plan, bulk edit / delete, search & delete by number | `#/planner` |
| PAGE_6 Sent report | Sent / failed, time and template per number, rotation check, download log (.csv) | `#/report` |
| PAGE_7 Forwarding & auto-response | SIM choice, missed-call + reply forwarding, keyword auto-reply, reschedule failed SMS, auto-allow, resume, battery | `#/auto` |

## Run it

Open `index.html` in Chrome (desktop or Android phone), or use the live link. Press **Start sending**
to watch the carousel move one template per SMS. You can import your own CSV / XLSX, search a number
in the Planner, delete its future SMS, or download the sent log.

The prototype ships with 3,169 demo clients (Mbeya, +255) and 5 Swahili templates. Sending is
**simulated** in the browser. State is saved in the browser, so a reload continues from the same
SMS, just as the app resumes after a crash or restart.

## The rotation rule (template carousel)

```
send #k (k = 0, 1, 2 …) uses template  T[(k mod N) + 1]        → T1, T2, …, TN, T1, T2 …
client(k) = (k + floor(k / L)) mod M      M = clients, N = templates, g = gcd(M, N), L = M·N / g
```

* No randomness and no batch reuse: every single send moves to the next template, and after the last
  one it loops back to T1.
* Every client receives every template exactly once (M × N SMS in total).
* A client's SMS are spaced one full pass of the client list apart. Your example of 60 clients,
  10 SMS and a 1-minute interval gives **one SMS per client every hour**.
* Daily window (e.g. 07:00–19:00): the app pauses at night and resumes the remaining SMS next morning.
  Skipped weekdays get no SMS.
* Failed SMS are rescheduled to the end of the plan. Deleting a number, or bulk-deleting a template,
  re-flows the queue so the order stays strict.
* New phonebook contacts join the running plan without moving anyone else.

The first sends of the demo plan (start Mon 16 Nov 2026 07:01, 1-minute interval):

| # | time | template | client |
|---|---|---|---|
| 1 | 07:01 | T1 | Andrew Mwakyusa |
| 2 | 07:02 | T2 | Briton Kyando |
| 3 | 07:03 | T3 | Clinton Mwaipopo |
| 4 | 07:04 | T4 | Brown Mbilinyi |
| 5 | 07:05 | T5 | Edward Sanga |
| 6 | 07:06 | **T1** (loops back) | Fred Mwakalinga |

## CSV / Excel column format (clients)

```
name,phone,group
Andrew Mwakyusa,0755214873,Gereji
Briton Kyando,+255713590214,Lori
Clinton Mwaipopo,255784336092,Boda
```

* `phone` is required. These formats are accepted: `07XXXXXXXX`, `+2557XXXXXXXX`, `2557XXXXXXXX`,
  `7XXXXXXXX`, and numbers with spaces or dashes. All are stored as `+255…`.
* `name` and `group` are optional. Column headers can also be in Swahili: `jina`, `simu`, `kundi`.
* With no header row, column A is the name and column B is the phone (as in the attachment).
* Excel (.xlsx) uses the same columns in the first sheet. For Google Sheets, use File → Share →
  Publish to web → CSV and paste the link.
* Duplicates and invalid numbers are skipped and counted. A 3,000-row file imports in well under a
  second.

Sample files: `samples/clients_3000.csv`, `samples/clients_sample.xlsx`.

## Templates file format

```
id,template
1,"Habari {name}! DOT 4 inahimili joto kali zaidi ya DOT 3, …"
2,"{name}, badilisha oil ya injini kila km 5,000 …"
```

A single column named `template` (or `sms` / `message`) also works. `{name}` is replaced with the
client's first name. When you import, choose **Add to existing** or **Replace all**.
Sample: `samples/templates.csv`.

## Live rotation test

```
node tests/engine.test.js
```

The script runs 26 checks:

* 12 consecutive sends follow T1 → T5 → T1;
* every (client, template) pair appears exactly once for 8 different client/template counts;
* client spacing is even;
* nothing is sent on Sundays or outside the daily window;
* the 3,000-row import works;
* search & delete (clients 1001 → 1000), bulk edit and bulk delete keep the order strict;
* failed SMS are rescheduled;
* crash resume continues from the same SMS.

It writes `tests/live-test-log.csv`, the first 10 consecutive sends with time, template, client,
phone, SIM and status.

## Sent report log (download)

Columns: `send_no, datetime, template, template_title, client, phone, sim, status, error`.

## Android implementation notes (native layer)

These describe the planned native layer of the Android build. None of it is in this folder yet,
and none of it has been tested on a device.

* **Sending**: `SmsManager` for the chosen subscription (SIM 1 / SIM 2 through `SubscriptionManager`),
  multipart for long SMS, with sent / delivered `PendingIntent`s feeding the report.
* **Queue & resume**: the plan and cursor live in SQLite. A foreground service plus exact alarms
  wakes up at each slot, and `BOOT_COMPLETED` restarts it, so sending continues from the same SMS
  after a crash, a reboot or running out of credit.
* **Phonebook**: `ContactsContract` (search, then select all). A `ContentObserver` adds new contacts
  to the running plan.
* **"Sending a large number of SMS" prompt**: raise the limit once with
  `adb shell settings put global sms_outgoing_check_max_count 100000`, or grant
  `WRITE_SECURE_SETTINGS`. An optional Accessibility helper taps **Allow**.
* **Forwarding**: missed calls come from `TelephonyCallback` + `CallLog` (caller name and number).
  Replies come from an `SMS_RECEIVED` receiver (sender name, number and text). Both are sent to your
  second number.
* **Auto-reply**: keyword rules (e.g. BEI, MAHALI, STOP). STOP adds the number to an opt-out list.
* **Battery**: requests `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` and shows the current status.

## Files

```
index.html            prototype shell (desktop frame / full screen on phones)
app/engine.js         rotation engine, scheduler, CSV + phone parsing (shared with tests)
app/data.js           demo data (3,169 clients, 5 Swahili templates)
app/app.js, app.css   all screens and interactions
screens/*.png         every screen at 1236 × 2769 px (412 × 923 dp @3x)
entries/              contest boards (hero + all pages)
samples/              CSV / XLSX / templates samples
tests/                engine tests + live-test-log.csv
```

Fonts: Plus Jakarta Sans and JetBrains Mono (Google Fonts, free), with Material Symbols Rounded icons.
