/** ScriptLibrary: ESD_HTKT_SLA_SCHEDULE.
 * Call from a recurring SM scheduler. No auto-registration or admin endpoints.
 * Pagination is by payment ID; continue with nextCursor until null, then restart.
 */
function runExpenseBatch(runtime, asOf, batch) {
    batch = batch || {};
    var limit = typeof batch.limit === "undefined" ? 100 : Number(batch.limit);
    if (!isFinite(limit) || limit < 1 || limit !== Math.floor(limit)) throw new Error("SLA_INVALID_BATCH_LIMIT");
    var store = runtime.store, ids = {}, list = store.list("esdHTKTslaTracking", {}), i, id;
    for (i = 0; i < list.length; i++) if (!list[i]["ended.at"]) ids[String(list[i]["payment.id"])] = true;
    list = store.list("esdHTKTslaEventLog", {"processing.status": "PREPARED"});
    for (i = 0; i < list.length; i++) ids[String(list[i]["payment.id"])] = true;
    var keys = [], payment, results = [], errors = [], processed = 0, cursor = batch.afterPaymentId || "";
    for (id in ids) if (Object.prototype.hasOwnProperty.call(ids, id) && id > cursor) keys.push(id);
    keys.sort();
    for (i = 0; i < keys.length && processed < limit; i++) {
        id = keys[i]; processed++;
        try {
            payment = store.get("esdHTKTpayment", id);
            if (!payment || payment["transaction.type"] !== "Dự chi") continue;
            runtime.service.retryPrepared(id);
            results.push(runtime.service.refreshExpense(id, asOf));
        } catch (error) { errors.push({paymentId: id, error: String(error.message || error)}); }
    }
    return {success: errors.length === 0, results: results, errors: errors,
        nextCursor: i < keys.length ? keys[i - 1] : null};
}

// sendEmail(alertPayload) must return {success:true} only after the mail gateway accepts it.
// Pass alertPayload.id to the mail gateway as its idempotency key. Without gateway
// deduplication, send-success followed by a DB failure can cause a duplicate email on retry.
function dispatchPendingAlerts(runtime, sendEmail, asOf, batch) {
    if (typeof sendEmail !== "function") throw new Error("SLA_MAIL_SENDER_REQUIRED");
    batch = batch || {};
    var store = runtime.store, rows = store.list("esdHTKTslaAlertHistory", {}), ids = [], i;
    var limit = typeof batch.limit === "undefined" ? 100 : Number(batch.limit);
    if (!isFinite(limit) || limit < 1 || limit !== Math.floor(limit)) throw new Error("SLA_INVALID_BATCH_LIMIT");
    for (i = 0; i < rows.length; i++) if ((rows[i]["send.status"] === "Chờ gửi" || rows[i]["send.status"] === "Gửi lỗi") && rows[i].id > (batch.afterAlertId || "")) ids.push(rows[i].id);
    ids.sort();
    var sent = 0, cancelled = 0, errors = [], processed = 0, stamp = new Date(lib.ESD_HTKT_SLA_CALENDAR.toMillis(store.decodeInstant(asOf))).toISOString();
    for (i = 0; i < ids.length && processed < limit; i++) {
        processed++;
        try {
            var candidate = store.get("esdHTKTslaAlertHistory", ids[i]);
            var tracking = store.get("esdHTKTslaTracking", candidate["sla.tracking.id"]);
            if (!tracking) throw new Error("SLA_ALERT_TRACKING_NOT_FOUND");
            store.withPaymentLock(String(tracking["payment.id"]), function() {
                var a = store.get("esdHTKTslaAlertHistory", candidate.id);
                var t = store.get("esdHTKTslaTracking", candidate["sla.tracking.id"]);
                var p = store.get("esdHTKTpayment", t["payment.id"]);
                if (a["send.status"] !== "Chờ gửi" && a["send.status"] !== "Gửi lỗi") return;
                if (!p || p["transaction.type"] !== "Dự chi") return;
                var pending = store.list("esdHTKTslaEventLog", {"payment.id": t["payment.id"], "processing.status": "PREPARED"});
                if (pending.length) throw new Error("SLA_PENDING_EVENT_RETRY_FIRST");
                a["updated.at"] = stamp;
                if (t["ended.at"] || p.status === "cancelled" || p.status === "approved" || p.status === "accounted") {
                    a["send.status"] = "Đã hủy"; store.put("esdHTKTslaAlertHistory", a); cancelled++; return;
                }
                // A delayed business event can rewind a calculation to its actual timestamp.
                // Wait for the next refresh rather than sending an alert not currently reached.
                if (Number(t["elapsed.minutes"]) < Number(t["sla.minutes"]) * Number(a["threshold.rate"])) return;
                // Resolve the person currently assigned, including reassignment after threshold detection.
                if (a["recipient.user"] !== t["current.assignee"]) {
                    a["recipient.user"] = t["current.assignee"];
                    a["recipient.email"] = null;
                }
                try {
                    var outcome = sendEmail({id: a.id, paymentId: t["payment.id"], trackingId: t.id,
                        recipientUser: a["recipient.user"], recipientEmail: a["recipient.email"],
                        stage: a["alert.stage"], thresholdRate: a["threshold.rate"], dueAt: t["due.at"],
                        elapsedMinutes: t["elapsed.minutes"], remainingMinutes: t["remaining.minutes"]});
                    if (!outcome || outcome.success !== true) throw new Error("SLA_MAIL_GATEWAY_NOT_ACCEPTED");
                    if (outcome.recipientEmail) a["recipient.email"] = outcome.recipientEmail;
                    a["send.status"] = "Đã gửi"; a["sent.at"] = stamp; a["error.message"] = null;
                } catch (mailError) {
                    a["send.status"] = "Gửi lỗi"; a["retry.count"] = Number(a["retry.count"] || 0) + 1;
                    a["error.message"] = String(mailError.message || mailError);
                }
                // DB failures are not swallowed as mail errors; retry with gateway idempotency key.
                store.put("esdHTKTslaAlertHistory", a);
                if (a["send.status"] === "Đã gửi") sent++;
                else errors.push({alertId: a.id, error: a["error.message"]});
            });
        } catch (error) { errors.push({alertId: ids[i], error: String(error.message || error)}); }
    }
    return {success: errors.length === 0, sent: sent, cancelled: cancelled, errors: errors,
        nextCursor: i < ids.length ? ids[i - 1] : null};
}
