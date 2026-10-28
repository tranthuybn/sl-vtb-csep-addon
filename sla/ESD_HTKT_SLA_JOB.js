/**
 * ScriptLibrary: ESD_HTKT_SLA_JOB
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Job tính lại trạng thái SLA
 * Version     : 2.1.0
 *
 * Chức năng   : Quét Tracking đang mở, phục hồi EventLog PREPARED và tính lại
 *               due.at/status. Không lưu elapsed/remaining và không gửi email.
 * Điểm gọi    : SM Scheduler gọi runBatch() định kỳ nếu cần cập nhật trạng thái
 *               vi phạm của Tracking đang mở.
 * Môi trường  : OpenText Service Manager (JavaScript ES5 Engine).
 * -----------------------------------------------------------------------------
 */
function isSupportedTransactionType(value) {
    return value === "Dự chi" || value === "Tạm ứng" || value === "Thanh toán";
}

function runBatch(runtime, asOf, batch) {
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
            if (!payment || !isSupportedTransactionType(String(payment["transaction.type"] || ""))) continue;
            runtime.service.retryPrepared(id);
            results.push(runtime.service.refresh(id, asOf));
        } catch (error) {
            errors.push({paymentId: id, error: String(error.message || error)});
        }
    }
    return {success: errors.length === 0, results: results, errors: errors,
        nextCursor: i < keys.length ? keys[i - 1] : null};
}

// Tương thích scheduler cũ trong giai đoạn chuyển đổi.
function runExpenseBatch(runtime, asOf, batch) { return runBatch(runtime, asOf, batch); }
