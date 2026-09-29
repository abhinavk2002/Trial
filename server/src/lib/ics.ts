/**
 * Minimal RFC 5545 writer — enough for a read-only surgical calendar feed.
 *
 * Times are emitted as "floating" local date-times (no Z, no TZID). A 09:00
 * slot then shows as 09:00 in whatever timezone the calendar app is set to,
 * which is what a theatre list wants: the wall clock on the hospital wall.
 */

const PRODID = '-//OT Manager//Surgical Lists//EN';

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM — omit for an all-day event */
  startTime?: string;
  /** HH:MM — omit for an all-day event */
  endTime?: string;
  /** Bumped whenever the underlying case changes, so clients refresh. */
  sequence?: number;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Minutes before start to alarm. Omit for no alarm. */
  reminderMinutes?: number;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 says lines wrap at 75 octets, continued with a leading space. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not split a multi-byte character across a fold.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return chunks.join('\r\n ');
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function compactDateTime(date: string, time: string): string {
  const [h = '00', m = '00'] = time.split(':');
  return `${compactDate(date)}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

/** YYYY-MM-DD plus n days, staying in UTC so DST never shifts a date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function stamp(): string {
  return `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

function renderEvent(event: IcsEvent, now: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${now}`];

  if (event.startTime && event.endTime) {
    lines.push(`DTSTART:${compactDateTime(event.date, event.startTime)}`);
    // An end time earlier than the start means the case runs past midnight.
    const end =
      event.endTime < event.startTime
        ? compactDateTime(addDays(event.date, 1), event.endTime)
        : compactDateTime(event.date, event.endTime);
    lines.push(`DTEND:${end}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(event.date, 1))}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  lines.push(`SEQUENCE:${event.sequence ?? 0}`);
  lines.push(`STATUS:${event.status ?? 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE');

  if (event.reminderMinutes && event.reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:-PT${event.reminderMinutes}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar(calendarName: string, events: IcsEvent[]): string {
  const now = stamp();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `NAME:${escapeText(calendarName)}`,
    'X-PUBLISHED-TTL:PT30M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
  ];

  for (const event of events) lines.push(...renderEvent(event, now));
  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
