export const ZSXQ_TIME_ZONE = "Asia/Shanghai";
export const ZSXQ_UTC_OFFSET = "+08:00";

const ZSXQ_UTC_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const DAYS_PER_MONTH = Object.freeze([
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
]);
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/u;

function timestampMilliseconds(timestamp) {
  if (typeof timestamp !== "string") {
    throw new TypeError(
      "timestamp must be an ISO-8601 date-time with an explicit Z or UTC offset",
    );
  }
  const match = ISO_INSTANT.exec(timestamp);
  if (!match) {
    throw new TypeError(
      "timestamp must be an ISO-8601 date-time with an explicit Z or UTC offset",
    );
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    ,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  const offsetHour = Number(offsetHourText ?? "0");
  const offsetMinute = Number(offsetMinuteText ?? "0");
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 && leapYear ? 29 : DAYS_PER_MONTH[month - 1];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new TypeError("timestamp must identify a real ISO-8601 instant");
  }
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("timestamp must identify a real ISO-8601 instant");
  }
  return milliseconds;
}

function beijingDateFromMilliseconds(milliseconds) {
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("instant must be a finite number of milliseconds");
  }
  const beijingInstant = new Date(milliseconds + ZSXQ_UTC_OFFSET_MILLISECONDS);
  if (Number.isNaN(beijingInstant.valueOf())) {
    throw new TypeError("instant must be a representable number of milliseconds");
  }
  const iso = beijingInstant.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(iso)) {
    throw new TypeError(
      "instant must resolve to a four-digit Beijing calendar year",
    );
  }
  return iso.slice(0, 10);
}

export function beijingDateFromTimestamp(timestamp) {
  return beijingDateFromMilliseconds(timestampMilliseconds(timestamp));
}

/** Render the represented instant as a Beijing-time `YYYY-MM-DD HH:mm:ss` display value. */
export function beijingDisplayFromTimestamp(timestamp) {
  const beijingInstant = new Date(
    timestampMilliseconds(timestamp) + ZSXQ_UTC_OFFSET_MILLISECONDS,
  );
  const iso = beijingInstant.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(iso)) {
    throw new TypeError(
      "instant must resolve to a four-digit Beijing calendar year",
    );
  }
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export function currentBeijingDate(nowMilliseconds = Date.now()) {
  return beijingDateFromMilliseconds(nowMilliseconds);
}
