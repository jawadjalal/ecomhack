/**
 * "Order in the next 3h 12m, get it Thursday" — computed in London time.
 * We dispatch 7 days a week: orders before the 8pm cutoff leave the same day, later ones the next
 * day. Couriers don't deliver on Sundays.
 */
const CUTOFF_HOUR = 20;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface LondonParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function londonParts(now: Date): LondonParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export interface DeliveryEstimate {
  /** e.g. "3h 12m" until today's (or the next working day's) cutoff. */
  countdown: string;
  /** e.g. "Thursday". */
  weekday: string;
  /** e.g. "Thu 2 Oct". */
  date: string;
  /** Full sentence for the product page. */
  message: string;
}

export function deliveryEstimate(now: Date, deliveryDays: number): DeliveryEstimate {
  const p = londonParts(now);
  // Work on a UTC date that represents the London calendar day (no DST maths needed).
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

  let minutesLeft = (CUTOFF_HOUR - p.hour) * 60 - p.minute;
  let dispatch = day;
  if (minutesLeft <= 0) {
    dispatch = addDays(day, 1);
    minutesLeft += 24 * 60;
  }

  let arrival = dispatch;
  for (let i = 0; i < Math.max(1, deliveryDays); ) {
    arrival = addDays(arrival, 1);
    if (arrival.getUTCDay() !== 0) i++;
  }

  const h = Math.floor(minutesLeft / 60);
  const m = minutesLeft % 60;
  const countdown = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  const weekday = WEEKDAYS[arrival.getUTCDay()];
  const date = `${weekday.slice(0, 3)} ${arrival.getUTCDate()} ${MONTHS[arrival.getUTCMonth()]}`;
  return { countdown, weekday, date, message: `Order in the next ${countdown}, get it ${weekday}` };
}
