/**
 * After-delete trigger của esdHTKTpaymentVendor.
 *
 * Khi một NCC bị xóa khỏi đề nghị thanh toán trigger dọn
 * các dữ liệu chi tiết vẫn còn tham chiếu đến cặp payment.id + vendor.id:
 *   - esdHTKTpaymentInvoice
 *   - esdHTKTpaymentCostDivision
 */
function handleRemoveVendorPaymentData(rec) {
    if (!rec) return;

    var paymentId = rec["payment.id"];
    var vendorId = rec["vendor.id"];

    if (!paymentId || !vendorId) {
        return;
    }

    var query =
        'payment.id="' + paymentId + '"' +
        ' and vendor.id="' + vendorId + '"';

    deleteTriggerRecords("esdHTKTpaymentInvoice", query);
    deleteTriggerRecords("esdHTKTpaymentCostDivision", query);
}

/** Xóa toàn bộ record của một bảng khớp query và trả về số dòng xóa thành công. */
function deleteTriggerRecords(tableName, query) {
    var file = null;
    var deletedCount = 0;

    try {
        file = new SCFile(tableName);
        var rc = file.doSelect(query);

        while (rc === RC_SUCCESS) {
            if (file.doDelete() === RC_SUCCESS) deletedCount++;
            rc = file.getNext();
        }
    } finally {
        try {
            if (file) file.doClose();
        } catch (ignore) { }
    }

    return deletedCount;
}


try {
    handleRemoveVendorPaymentData(record);
} catch (e) {
    try {
        print("[PAYMENT-VENDOR-AFTER-DELETE][ERROR] " + e);
    } catch (ignore) {}
}