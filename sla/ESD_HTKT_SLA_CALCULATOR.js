/** ScriptLibrary: ESD_HTKT_SLA_CALCULATOR
 * Calculation only: does not persist data, send mail or change workflow.
 * Caller injects the calendar SL (normally lib.ESD_HTKT_SLA_CALENDAR).
 * Segments: {startedAt, endedAt?}; tracking: {startedAt, endedAt?, slaMinutes}.
 * Result is independent of assignee. Reassignment must use adjacent segments.
 */
function calculateTracking(calendarLib, calendar, tracking, segments, asOf, thresholds) {
    if (!calendarLib || !tracking || !segments || !segments.length) throw new Error("SLA_MISSING_INPUT");
    var c = calendarLib.compileCalendar(calendar);
    var now = calendarLib.toMillis(asOf);
    var start = calendarLib.toMillis(tracking.startedAt);
    var closed = tracking.endedAt !== null && typeof tracking.endedAt !== "undefined";
    var end = closed ? calendarLib.toMillis(tracking.endedAt) : now;
    var budget = tracking.slaMinutes;
    if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) throw new Error("SLA_INVALID_BUDGET");
    if (end < start || end > now) throw new Error("SLA_INVALID_TRACKING_RANGE");
    thresholds = thresholds || { stage1: 0.7, stage2: 0.9 };
    var r1 = thresholds.stage1, r2 = thresholds.stage2;
    if (typeof r1 !== "number" || typeof r2 !== "number" || !(r1 > 0 && r1 < r2 && r2 < 1)) {
        throw new Error("SLA_INVALID_ALERT_THRESHOLDS");
    }
    var rows = [], i, segment, a, b, open, previousEnd = start;
    for (i = 0; i < segments.length; i++) {
        segment = segments[i]; a = calendarLib.toMillis(segment.startedAt);
        open = segment.endedAt === null || typeof segment.endedAt === "undefined";
        if (closed && open) throw new Error("SLA_OPEN_SEGMENT_IN_CLOSED_TRACKING");
        b = open ? end : calendarLib.toMillis(segment.endedAt);
        if (a < start || b < a || b > end) throw new Error("SLA_INVALID_SEGMENT_RANGE");
        rows.push({ start: a, end: b, open: open, index: i });
    }
    rows.sort(function(x, y) { return x.start - y.start || x.end - y.end; });
    if (rows[0].start !== start) throw new Error("SLA_FIRST_SEGMENT_MUST_START_WITH_TRACKING");
    var totalMs = 0, usedMs, pausedMs = 0, results = [], running = false;
    for (i = 0; i < rows.length; i++) {
        segment = rows[i];
        if (segment.start < previousEnd) throw new Error("SLA_OVERLAPPING_SEGMENTS");
        if (segment.open && i !== rows.length - 1) throw new Error("SLA_OPEN_SEGMENT_NOT_LAST");
        pausedMs += calendarLib.workingMillis(c, previousEnd, segment.start);
        usedMs = calendarLib.workingMillis(c, segment.start, segment.end);
        totalMs += usedMs;
        results.push({ inputIndex: segment.index, workingMinutes: usedMs / 60000 });
        previousEnd = segment.end; running = segment.open;
    }
    pausedMs += calendarLib.workingMillis(c, previousEnd, end);
    var budgetMs = budget * 60000, remainingMs = budgetMs - totalMs;
    var level = totalMs >= budgetMs ? "STAGE_3" :
        totalMs >= budgetMs * r2 ? "STAGE_2" : totalMs >= budgetMs * r1 ? "STAGE_1" : "NONE";
    // An actual deadline can be recovered from segments once the budget is consumed.
    // Before consumption: initial budget plus excluded working time in gaps (pauses).
    // While paused the future resume instant is unknown, so no reliable dueAt exists.
    var due = null, consumed = 0;
    if (totalMs >= budgetMs) {
        for (i = 0; i < rows.length; i++) {
            usedMs = calendarLib.workingMillis(c, rows[i].start, rows[i].end);
            if (consumed + usedMs >= budgetMs) {
                due = new Date(calendarLib.addMillis(c, rows[i].start, budgetMs - consumed)); break;
            }
            consumed += usedMs;
        }
    } else if (closed || running) {
        due = new Date(calendarLib.addMillis(c, start, budgetMs + pausedMs));
    }
    return {
        slaMinutes: budget, elapsedMinutes: totalMs / 60000,
        remainingMinutes: remainingMs / 60000, dueAt: due,
        status: closed ? "Đã kết thúc" : remainingMs <= 0 ? "Vi phạm" : "Trong thời gian",
        isRunning: !closed && running, isBreached: remainingMs <= 0,
        alertStatus: level,
        // Thresholds reached are informational; send only for open tracking and dedupe in persistence.
        reachedStages: totalMs >= budgetMs ? ["STAGE_1_70", "STAGE_2_90", "STAGE_3_BREACH"] :
            totalMs >= budgetMs * r2 ? ["STAGE_1_70", "STAGE_2_90"] :
            totalMs >= budgetMs * r1 ? ["STAGE_1_70"] : [],
        canAlert: !closed && running, segments: results, calculatedAt: new Date(end)
    };
}

// Expense entry point: caller maps SM dates and fields explicitly before calculation.
// Each tracking is calculated independently (RS2 can overlap Phê duyệt KTTC).
function calculateExpenseTracking(calendarLib, calendar, payment, tracking, segments, asOf, thresholds) {
    if (!payment || payment["transaction.type"] !== "Dự chi") throw new Error("SLA_NOT_EXPENSE");
    if (!payment.id || tracking.paymentId !== String(payment.id)) throw new Error("SLA_PAYMENT_MISMATCH");
    return calculateTracking(calendarLib, calendar, tracking, segments, asOf, thresholds);
}
