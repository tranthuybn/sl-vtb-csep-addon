/**
 * ScriptLibrary: ESD_HTKT_SLA_JOB
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Job tính lại trạng thái SLA
 * Version     : 2.1.0
 *
 * Chức năng   : Quét Tracking đang mở và tính lại due.at/status.
 *               Không lưu elapsed/remaining và không gửi email.
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
    function collect(row) {
        var table = lib.ESD_HTKT_SLA_ENGINE.sourceTableForId(row["payment.id"]);
        ids[String(row["payment.id"])] = {id:String(row["payment.id"]),table:table};
    }
    for (i = 0; i < list.length; i++) if (!list[i]["ended.at"]) collect(list[i]);
    var keys = [], payment, results = [], errors = [], processed = 0, cursor = batch.afterPaymentId || "";
    for (id in ids) if (Object.prototype.hasOwnProperty.call(ids, id) && id > cursor) keys.push(id);
    keys.sort();
    for (i = 0; i < keys.length && processed < limit; i++) {
        id = keys[i]; processed++;
        try {
            var target = ids[id];
            payment = store.get(target.table, target.id);
            if (!payment || !isSupportedTransactionType(String(payment["transaction.type"] || ""))) continue;
            results.push(runtime.service.refresh(target.id, asOf, target.table));
        } catch (error) {
            errors.push({paymentId: id, error: String(error.message || error)});
        }
    }
    return {success: errors.length === 0, results: results, errors: errors,
        nextCursor: i < keys.length ? keys[i - 1] : null};
}

