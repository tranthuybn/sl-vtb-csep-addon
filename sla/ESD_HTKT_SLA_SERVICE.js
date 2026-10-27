/** ScriptLibrary: ESD_HTKT_SLA_SERVICE
 * Durable calculation and event application. Dependencies injected by createService().
 * All public mutations acquire the store payment lock, including ticks/retries.
 * SCFile has no transaction/lock contract in these sources; this SL does not pretend
 * that multiple doInsert/doUpdate calls form a database transaction.
 * A PREPARED EventLog stores the complete write plan BEFORE changing SLA state.
 * Retry the same event ID to finish interrupted writes. Never skip a PREPARED event.
 */
var SLA_T = { config: "esdHTKTslaConfig", detail: "esdHTKTslaConfigDetail",
    calendar: "esdHTKTslaCalendar", hours: "esdHTKTslaWorkingHour", holiday: "esdHTKTslaHoliday",
    tracking: "esdHTKTslaTracking", segment: "esdHTKTslaTimeSegment",
    event: "esdHTKTslaEventLog", alert: "esdHTKTslaAlertHistory" };
function createService(store, calendarLib, calculator, expenseRules, options) {
    options = options || {};
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function instant(x) { return calendarLib.toMillis(store.decodeInstant(x)); }
    function iso(x) { return new Date(x).toISOString(); }
    function key(parts) {
        var out = [], i;
        for (i = 0; i < parts.length; i++) out.push(encodeURIComponent(String(parts[i])));
        return out.join("|");
    }
    function rows(table, filter) { return store.list(table, filter || {}); }
    function blank(x) { return x === null || typeof x === "undefined" || x === ""; }
    function truth(x) { return x === true || x === 1 || x === "true" || x === "1"; }
    function loadCalendar(id) {
        var meta = store.get(SLA_T.calendar, id), result, list, i;
        if (!meta) throw new Error("SLA_CALENDAR_NOT_FOUND: " + id);
        result = {timezone: String(meta.timezone), workingHours: [], holidays: []};
        list = rows(SLA_T.hours, {"calendar.id": id});
        for (i = 0; i < list.length; i++) result.workingHours.push({
            dayOfWeek: Number(list[i]["day.of.week"]),
            startTime: store.decodeTime(list[i]["start.time"]), endTime: store.decodeTime(list[i]["end.time"])
        });
        list = rows(SLA_T.holiday, {"calendar.id": id});
        for (i = 0; i < list.length; i++) result.holidays.push(store.decodeDate(list[i]["holiday.date"]));
        calendarLib.compileCalendar(result); return result;
    }
    function selectDetail(role, at) {
        // Dự chi uses the common product bucket Tất cả, not a field inferred from the payment.
        var configs = rows(SLA_T.config, {"transaction.type": "Dự chi", "product.type": "Tất cả"});
        var matches = [], i, config, details;
        for (i = 0; i < configs.length; i++) {
            config = configs[i];
            if (instant(config["effective.from"]) <= at &&
                    (blank(config["effective.to"]) || at < instant(config["effective.to"]))) matches.push(config);
        }
        if (matches.length !== 1) throw new Error("SLA_EXPECT_ONE_EFFECTIVE_CONFIG: " + matches.length);
        config = matches[0];
        details = rows(SLA_T.detail, {"sla.config.id": config.id, "role.code": role});
        if (details.length !== 1) throw new Error("SLA_EXPECT_ONE_ROLE_DETAIL: " + role);
        if (!truth(details[0]["is.active"])) return null;
        return { config: config, detail: details[0], calendar: loadCalendar(config["calendar.id"]) };
    }
    function hydrateTracking(row) {
        var out = clone(row), names = ["started.at", "ended.at", "due.at", "last.calculated.at", "created.at", "updated.at"], i;
        for (i = 0; i < names.length; i++) if (!blank(row[names[i]])) out[names[i]] = iso(instant(row[names[i]]));
        return out;
    }
    function loadSegments(id) {
        var list = rows(SLA_T.segment, {"sla.tracking.id": id}), i;
        for (i = 0; i < list.length; i++) {
            list[i]["started.at"] = iso(instant(list[i]["started.at"]));
            list[i]["ended.at"] = blank(list[i]["ended.at"]) ? null : iso(instant(list[i]["ended.at"]));
        }
        list.sort(function(a,b) { return Number(a["segment.no"]) - Number(b["segment.no"]); });
        return list;
    }
    function calculate(row, segments, at) {
        var data = [], i;
        for (i = 0; i < segments.length; i++) data.push({startedAt: segments[i]["started.at"], endedAt: segments[i]["ended.at"]});
        var result = calculator.calculateTracking(calendarLib, loadCalendar(row["calendar.id"]), {
            startedAt: row["started.at"], endedAt: row["ended.at"], slaMinutes: Number(row["sla.minutes"])
        }, data, at, {stage1: Number(row["alert.stage1.rate"]), stage2: Number(row["alert.stage2.rate"])});
        row["due.at"] = result.dueAt ? result.dueAt.toISOString() : null;
        row["elapsed.minutes"] = result.elapsedMinutes; row["remaining.minutes"] = result.remainingMinutes;
        row.status = result.status; row["alert.status"] = result.alertStatus;
        row["last.calculated.at"] = at; row["updated.at"] = at;
        for (i = 0; i < result.segments.length; i++) {
            segments[result.segments[i].inputIndex]["working.minutes"] = result.segments[i].workingMinutes;
        }
        return result;
    }
    function thresholdAt(row, segments, rate) {
        var calendar = calendarLib.compileCalendar(loadCalendar(row["calendar.id"]));
        var needed = Number(row["sla.minutes"]) * rate * 60000, i, used;
        for (i = 0; i < segments.length; i++) {
            used = Number(segments[i]["working.minutes"]) * 60000;
            if (used >= needed) return iso(calendarLib.addMillis(calendar, instant(segments[i]["started.at"]), needed));
            needed -= used;
        }
        throw new Error("SLA_THRESHOLD_NOT_REACHED");
    }
    function journalId(paymentId, eventId) { return key(["EVENT", paymentId, eventId]); }
    function assertNoPending(paymentId, except) {
        var list = rows(SLA_T.event, {"payment.id": paymentId}), i;
        for (i = 0; i < list.length; i++) {
            if (list[i]["processing.status"] === "PREPARED" && list[i].id !== except) {
                throw new Error("SLA_PENDING_EVENT_RETRY_FIRST: " + list[i].id);
            }
        }
    }
    function addWrite(plan, table, row) { plan.push({table: table, row: clone(row)}); }
    function commit(journal) {
        var payload = JSON.parse(journal.data), i;
        // Replaying these deterministic upserts repairs partially applied writes.
        for (i = 0; i < payload.writes.length; i++) store.put(payload.writes[i].table, payload.writes[i].row);
        journal["processing.status"] = "APPLIED"; store.put(SLA_T.event, journal);
        return { success: true, eventId: journal["event.key"], writes: payload.writes.length };
    }
    function applyExpenseEvent(event) {
        var commands = expenseRules.buildCommands(event);
        var paymentId = String(event.after.id), rootId = journalId(paymentId, event.id);
        var existing = store.get(SLA_T.event, rootId);
        // Stable JSON payload protects an operation ID from being reused for another business action.
        var input = clone(event), fingerprint = JSON.stringify(input);
        if (existing) {
            if (JSON.parse(existing.data).fingerprint !== fingerprint) throw new Error("SLA_EVENT_ID_REUSED_WITH_DIFFERENT_INPUT");
            if (existing["processing.status"] === "APPLIED") return {success: true, duplicate: true, eventId: event.id};
            assertNoPending(paymentId, rootId); return commit(existing);
        }
        assertNoPending(paymentId);
        var atMs = instant(event.eventAt), at = iso(atMs), journalAttempt = 1;
        var journals = rows(SLA_T.event, {"payment.id": paymentId}), i, j;
        for (i = 0; i < journals.length; i++) {
            if (journals[i]["processing.status"] === "APPLIED") journalAttempt = Math.max(journalAttempt, Number(JSON.parse(journals[i].data).attempt || 1));
            if (journals[i]["processing.status"] === "APPLIED" && instant(journals[i]["event.at"]) > atMs) {
                throw new Error("SLA_OUT_OF_ORDER_EVENT");
            }
        }
        var all = rows(SLA_T.tracking, {"payment.id": paymentId}), attempt = journalAttempt, active = {}, plan = [], command, row, segments;
        for (i = 0; i < all.length; i++) {
            attempt = Math.max(attempt, Number(all[i]["attempt.no"]));
            if (blank(all[i]["ended.at"])) {
                if (active[all[i]["role.code"]]) throw new Error("SLA_MULTIPLE_ACTIVE_TRACKINGS_FOR_ROLE");
                row = hydrateTracking(all[i]);
                // A tick may have run after the business event's timestamp but before delivery.
                // Recalculate open intervals at the authoritative event time. Business events
                // themselves remain ordered by the APPLIED journal check above.
                active[row["role.code"]] = {row: row, segments: loadSegments(row.id)};
            }
        }
        if (event.kind === "CREATE" && (all.length || journals.length)) throw new Error("SLA_PAYMENT_ALREADY_INITIALIZED");
        function log(type, role, trackingId, actor, data, suffix) {
            addWrite(plan, SLA_T.event, {id: key([rootId, type, role || "ALL", suffix || ""]),
                "sla.tracking.id": trackingId || null, "payment.id": paymentId,
                "event.type": type, "event.at": at, "from.status": event.before ? event.before.status : null,
                "to.status": event.after.status, "from.phase": event.before ? event.before["current.phase"] : null,
                "to.phase": event.after["current.phase"], "role.code": role || null,
                "performed.by": event.performedBy, assignee: actor || null, data: JSON.stringify(data || {}),
                "created.at": at, "processing.status": null, "event.key": null });
        }
        function persist(state) {
            calculate(state.row, state.segments, at);
            for (var n = 0; n < state.segments.length; n++) addWrite(plan, SLA_T.segment, state.segments[n]);
            addWrite(plan, SLA_T.tracking, state.row);
        }
        function close(role, reason) {
            var state = active[role], n;
            if (!state) throw new Error("SLA_ACTIVE_TRACKING_NOT_FOUND: " + role);
            for (n = 0; n < state.segments.length; n++) if (blank(state.segments[n]["ended.at"])) {
                state.segments[n]["ended.at"] = at; state.segments[n]["end.event"] = reason;
            }
            state.row["ended.at"] = at; state.row["end.reason"] = reason;
            persist(state);
            state.row.result = reason === "COMPLETE" ? (state.row["remaining.minutes"] <= 0 ? "BREACHED" : "MET") : "NOT_EVALUATED";
            addWrite(plan, SLA_T.tracking, state.row);
            log(reason, role, state.row.id, state.row["current.assignee"]);
            var pendingAlerts = rows(SLA_T.alert, {"sla.tracking.id": state.row.id}), ai;
            for (ai = 0; ai < pendingAlerts.length; ai++) {
                if (pendingAlerts[ai]["send.status"] === "Chờ gửi" || pendingAlerts[ai]["send.status"] === "Gửi lỗi") {
                    pendingAlerts[ai]["send.status"] = "Đã hủy"; pendingAlerts[ai]["updated.at"] = at;
                    if (instant(pendingAlerts[ai]["triggered.at"]) > atMs) pendingAlerts[ai]["error.message"] = "Mốc cảnh báo nằm sau thời điểm kết thúc nghiệp vụ thực tế";
                    addWrite(plan, SLA_T.alert, pendingAlerts[ai]);
                }
            }
            delete active[role];
        }
        for (i = 0; i < commands.length; i++) {
            command = commands[i];
            if (command.type === "RETURN_ALL" || command.type === "CANCEL_ALL") {
                var roleNames = [], r;
                for (r in active) if (Object.prototype.hasOwnProperty.call(active, r)) roleNames.push(r);
                roleNames.sort();
                for (j = 0; j < roleNames.length; j++) close(roleNames[j], command.type === "RETURN_ALL" ? "RETURN" : "CANCEL");
                if (command.type === "RETURN_ALL") attempt++;
                if (!roleNames.length) log(command.type === "RETURN_ALL" ? "RETURN" : "CANCEL", null, null, null);
            } else if (command.type === "COMPLETE") {
                if (active[command.role]) close(command.role, "COMPLETE");
                else {
                    // Inactive configured roles have no tracking; missing active ones are a data error.
                    var disabled = selectDetail(command.role, atMs);
                    if (disabled !== null) throw new Error("SLA_ACTIVE_TRACKING_NOT_FOUND: " + command.role);
                }
            } else if (command.type === "START") {
                // RS2 started early at ĐMMS approval keeps its original clock on entry to check_final.
                if (active[command.role]) {
                    if (command.role !== "RA_SOAT_2" || String(event.after["current.phase"]) !== "check_final") {
                        throw new Error("SLA_ROLE_ALREADY_RUNNING: " + command.role);
                    }
                    continue;
                }
                var selected = selectDetail(command.role, atMs);
                if (selected === null) continue;
                if (!command.assignee) throw new Error("SLA_MISSING_ASSIGNEE: " + command.role);
                var detail = selected.detail;
                var hours = Number(detail["sla.hours"]);
                if (!isFinite(hours) || hours <= 0) throw new Error("SLA_INVALID_HOURS");
                var tid = key([paymentId, attempt, command.role]);
                if (store.get(SLA_T.tracking, tid)) throw new Error("SLA_TRACKING_ALREADY_EXISTS: " + tid);
                row = {id: tid, "payment.id": paymentId, "sla.config.id": selected.config.id,
                    "sla.config.detail.id": detail.id, "calendar.id": selected.config["calendar.id"],
                    "role.code": command.role, "attempt.no": attempt, "started.at": at, "ended.at": null,
                    "sla.minutes": hours * 60, "current.assignee": command.assignee,
                    "alert.stage1.rate": blank(detail["alert.stage1.rate"]) ? 0.7 : Number(detail["alert.stage1.rate"]),
                    "alert.stage2.rate": blank(detail["alert.stage2.rate"]) ? 0.9 : Number(detail["alert.stage2.rate"]),
                    "end.reason": null, result: null, "created.at": at};
                segments = [{id: key([tid, "SEG", 1]), "sla.tracking.id": tid, "segment.no": 1,
                    "started.at": at, "ended.at": null, "working.minutes": 0,
                    "start.event": event.kind === "RETURN" ? "RESET" : "START", "end.event": null,
                    assignee: command.assignee, "created.at": at}];
                active[command.role] = {row: row, segments: segments}; persist(active[command.role]);
                log(event.kind === "RETURN" ? "RESET" : "START", command.role, tid, command.assignee);
            } else if (command.type === "REASSIGN") {
                var state = active[command.role];
                if (!command.assignee) throw new Error("SLA_MISSING_NEW_ASSIGNEE");
                if (!state) {
                    // A future step has no clock to start/reset.
                    for (j = 0; j < all.length; j++) {
                        if (Number(all[j]["attempt.no"]) === attempt && all[j]["role.code"] === command.role) {
                            throw new Error("SLA_CANNOT_REASSIGN_COMPLETED_STEP");
                        }
                    }
                    log("REASSIGN", command.role, null, command.assignee, {from: command.oldAssignee, to: command.assignee});
                    continue;
                }
                if (state.row["current.assignee"] !== command.oldAssignee) throw new Error("SLA_STALE_ASSIGNEE");
                var found = 0, seq = 0;
                for (j = 0; j < state.segments.length; j++) {
                    seq = Math.max(seq, Number(state.segments[j]["segment.no"]));
                    if (blank(state.segments[j]["ended.at"])) {
                        state.segments[j]["ended.at"] = at; state.segments[j]["end.event"] = "REASSIGN"; found++;
                    }
                }
                if (found !== 1) throw new Error("SLA_EXPECT_ONE_OPEN_SEGMENT");
                seq++;
                state.segments.push({id: key([state.row.id, "SEG", seq]), "sla.tracking.id": state.row.id,
                    "segment.no": seq, "started.at": at, "ended.at": null, "working.minutes": 0,
                    "start.event": "REASSIGN", "end.event": null, assignee: command.assignee, "created.at": at});
                state.row["current.assignee"] = command.assignee; persist(state);
                log("REASSIGN", command.role, state.row.id, command.assignee, {from: command.oldAssignee, to: command.assignee});
            }
        }
        var journal = {id: rootId, "payment.id": paymentId, "event.type": "WORKFLOW",
            "event.at": at, "event.key": String(event.id), "performed.by": event.performedBy,
            "from.status": event.before ? event.before.status : null, "to.status": event.after.status,
            "from.phase": event.before ? event.before["current.phase"] : null, "to.phase": event.after["current.phase"],
            "created.at": at, "processing.status": "PREPARED", data: JSON.stringify({fingerprint: fingerprint, attempt: attempt, writes: plan})};
        store.put(SLA_T.event, journal); return commit(journal);
    }
    function refreshExpense(paymentId, asOf) {
        var payment = store.get("esdHTKTpayment", paymentId);
        if (!payment || payment["transaction.type"] !== "Dự chi") throw new Error("SLA_NOT_EXPENSE");
        assertNoPending(paymentId);
        if (payment.status === "cancelled" || payment.status === "approved" || payment.status === "accounted") {
            var dangling = rows(SLA_T.tracking, {"payment.id": paymentId}), d;
            for (d = 0; d < dangling.length; d++) if (blank(dangling[d]["ended.at"])) throw new Error("SLA_MISSING_TERMINAL_WORKFLOW_EVENT");
            return {success: true, paymentId: paymentId, calculated: 0};
        }
        var atMs = instant(asOf), at = iso(atMs), list = rows(SLA_T.tracking, {"payment.id": paymentId});
        var count = 0, i, j, row, segments, result, stages, stage, rate, aid, alert;
        // Validate every active tracking before writing any result for this payment.
        var prepared = [];
        for (i = 0; i < list.length; i++) {
            if (!blank(list[i]["ended.at"])) continue;
            row = hydrateTracking(list[i]);
            if (!blank(row["last.calculated.at"]) && instant(row["last.calculated.at"]) > atMs) throw new Error("SLA_STALE_REFRESH");
            segments = loadSegments(row.id); result = calculate(row, segments, at);
            prepared.push({row: row, segments: segments, result: result});
        }
        for (i = 0; i < prepared.length; i++) {
            row = prepared[i].row; segments = prepared[i].segments; result = prepared[i].result;
            for (j = 0; j < segments.length; j++) store.put(SLA_T.segment, segments[j]);
            store.put(SLA_T.tracking, row); count++;
            if (!result.canAlert || payment.status === "cancelled" || payment.status === "approved" || payment.status === "accounted") continue;
            stages = result.reachedStages;
            for (j = 0; j < stages.length; j++) {
                stage = stages[j]; rate = stage === "STAGE_1_70" ? Number(row["alert.stage1.rate"]) : stage === "STAGE_2_90" ? Number(row["alert.stage2.rate"]) : 1;
                aid = key([row.id, "ALERT", stage]); if (store.get(SLA_T.alert, aid)) continue;
                alert = {id: aid, "sla.tracking.id": row.id, "alert.stage": stage, "threshold.rate": rate,
                    "recipient.user": row["current.assignee"], "recipient.email": options.resolveEmail ? options.resolveEmail(row["current.assignee"]) : null,
                    "triggered.at": thresholdAt(row, segments, rate), "sent.at": null, "send.status": "Chờ gửi", "retry.count": 0,
                    "error.message": null, "created.at": at, "updated.at": at};
                store.put(SLA_T.alert, alert);
            }
        }
        return {success: true, paymentId: paymentId, calculated: count};
    }
    function retryPrepared(paymentId) {
        var list = rows(SLA_T.event, {"payment.id": paymentId, "processing.status": "PREPARED"});
        if (list.length > 1) throw new Error("SLA_MULTIPLE_PENDING_EVENTS_REQUIRE_RECONCILIATION");
        return list.length ? commit(list[0]) : {success: true, writes: 0};
    }
    if (typeof store.withPaymentLock !== "function") throw new Error("SLA_STORE_REQUIRES_PAYMENT_LOCK");
    return {
        applyExpenseEvent: function(event) {
            if (!event || !event.after || !event.after.id) throw new Error("SLA_MISSING_PAYMENT");
            return store.withPaymentLock(String(event.after.id), function() { return applyExpenseEvent(event); });
        },
        refreshExpense: function(paymentId, asOf) {
            return store.withPaymentLock(String(paymentId), function() { return refreshExpense(paymentId, asOf); });
        },
        retryPrepared: function(paymentId) {
            return store.withPaymentLock(String(paymentId), function() { return retryPrepared(paymentId); });
        }
    };
}
