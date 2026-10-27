/** ScriptLibrary: ESD_HTKT_SLA_CALENDAR
 * Pure calculation; ES5, no SCFile, no dependency on server local timezone.
 * Instants: Date / epoch milliseconds / ISO string with Z or explicit offset.
 * Calendar: {timezone, workingHours:[{dayOfWeek,startTime,endTime}], holidays:[YYYY-MM-DD]}.
 * Version 1 supports Asia/Ho_Chi_Minh (UTC+07, no DST) only; rejects other zones.
 * Durations retain fractional minutes; round only for display.
 */
var SLA_DAY_MS = 86400000;
var SLA_MINUTE_MS = 60000;
var SLA_OFFSET_MS = 7 * 60 * SLA_MINUTE_MS;

function toMillis(value) {
    var n;
    if (typeof value === "number") n = value;
    else if (value && typeof value.getTime === "function") n = value.getTime();
    else if (typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        n = Date.parse(value);
    } else throw new Error("SLA_INVALID_INSTANT: use Date, epoch milliseconds or ISO with timezone");
    if (!isFinite(n) || Math.abs(n) > 8640000000000000) throw new Error("SLA_INVALID_INSTANT");
    return n;
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }
function dateKey(day) {
    var d = new Date(day * SLA_DAY_MS);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function clockMinutes(value) {
    var m = /^(\d{2}):(\d{2})(?::00)?$/.exec(String(value));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error("SLA_INVALID_WORKING_TIME: " + value);
    return Number(m[1]) * 60 + Number(m[2]);
}
function compileCalendar(calendar) {
    if (!calendar || calendar.timezone !== "Asia/Ho_Chi_Minh") {
        throw new Error("SLA_UNSUPPORTED_TIMEZONE: expected Asia/Ho_Chi_Minh");
    }
    var compiled = { days: {}, holidays: {} }, rows = calendar.workingHours || [];
    var i, row, day, start, end, slots, j, key, parsed;
    if (!rows.length) throw new Error("SLA_EMPTY_WORKING_HOURS");
    for (i = 0; i < rows.length; i++) {
        row = rows[i]; day = Number(row.dayOfWeek);
        if (day < 1 || day > 7 || day !== Math.floor(day)) throw new Error("SLA_INVALID_WEEKDAY");
        start = clockMinutes(row.startTime); end = clockMinutes(row.endTime);
        if (end <= start) throw new Error("SLA_INVALID_WORKING_INTERVAL");
        if (!compiled.days[day]) compiled.days[day] = [];
        compiled.days[day].push([start, end]);
    }
    for (day = 1; day <= 7; day++) {
        slots = compiled.days[day] || [];
        slots.sort(function(a, b) { return a[0] - b[0]; });
        for (j = 1; j < slots.length; j++) {
            if (slots[j][0] < slots[j - 1][1]) throw new Error("SLA_OVERLAPPING_WORKING_HOURS");
        }
    }
    rows = calendar.holidays || [];
    for (i = 0; i < rows.length; i++) {
        key = String(rows[i]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("SLA_INVALID_HOLIDAY: " + key);
        parsed = Date.parse(key + "T00:00:00Z");
        if (!isFinite(parsed) || dateKey(Math.floor(parsed / SLA_DAY_MS)) !== key) {
            throw new Error("SLA_INVALID_HOLIDAY: " + key);
        }
        compiled.holidays[key] = true;
    }
    return compiled;
}
function daySlots(compiled, day) {
    if (compiled.holidays[dateKey(day)]) return [];
    var weekday = new Date(day * SLA_DAY_MS).getUTCDay();
    return compiled.days[weekday === 0 ? 7 : weekday] || [];
}
function workingMillis(compiled, start, end) {
    if (end < start) throw new Error("SLA_END_BEFORE_START");
    var first = Math.floor((start + SLA_OFFSET_MS) / SLA_DAY_MS);
    var last = Math.floor((end + SLA_OFFSET_MS) / SLA_DAY_MS);
    if (last - first > 36600) throw new Error("SLA_RANGE_TOO_LARGE");
    var day, slots, i, base, a, b, total = 0;
    for (day = first; day <= last; day++) {
        slots = daySlots(compiled, day); base = day * SLA_DAY_MS - SLA_OFFSET_MS;
        for (i = 0; i < slots.length; i++) {
            a = Math.max(start, base + slots[i][0] * SLA_MINUTE_MS);
            b = Math.min(end, base + slots[i][1] * SLA_MINUTE_MS);
            if (b > a) total += b - a;
        }
    }
    return total;
}
function addMillis(compiled, start, duration) {
    if (!isFinite(duration) || duration < 0) throw new Error("SLA_INVALID_DURATION");
    if (duration === 0) return start;
    var first = Math.floor((start + SLA_OFFSET_MS) / SLA_DAY_MS);
    var day, slots, i, base, a, b;
    for (day = first; day <= first + 36600; day++) {
        slots = daySlots(compiled, day); base = day * SLA_DAY_MS - SLA_OFFSET_MS;
        for (i = 0; i < slots.length; i++) {
            a = Math.max(start, base + slots[i][0] * SLA_MINUTE_MS);
            b = base + slots[i][1] * SLA_MINUTE_MS;
            if (b <= a) continue;
            if (duration <= b - a) return a + duration;
            duration -= b - a;
        }
    }
    throw new Error("SLA_DUE_DATE_OUT_OF_RANGE");
}
function getWorkingMinutes(calendar, start, end) {
    return workingMillis(compileCalendar(calendar), toMillis(start), toMillis(end)) / SLA_MINUTE_MS;
}
function addWorkingMinutes(calendar, start, minutes) {
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes < 0) throw new Error("SLA_INVALID_DURATION");
    return new Date(addMillis(compileCalendar(calendar), toMillis(start), minutes * SLA_MINUTE_MS));
}
