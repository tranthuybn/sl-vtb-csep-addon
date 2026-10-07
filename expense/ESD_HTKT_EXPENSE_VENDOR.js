/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VENDOR
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị dự chi
 * Chức năng:
 * - Lấy danh sách món Dự chi theo hợp đồng và nhà cung cấp.
 * - Dùng esdHTKTpaymentContract làm bảng gốc để hợp đồng mới tạo vẫn xuất hiện
 *   kể cả khi chưa có bản ghi tương ứng trong esdHTKTpaymentVendor.
 * -----------------------------------------------------------------------------
 */

function getListExpenseVendor(input) {
    var resultList = [];
    var paymentId = getExpenseVendorPaymentId(input);

    if (!paymentId) {
        return resultList;
    }

    var fieldMappings = [
        ["pc.id", "payment_contract_id", "S"],
        ["pv.id", "payment_vendor_id", "S"],
        ["pc.payment.id", "payment_id", "S"],
        ["pc.contract.id", "contract_id", "S"],
        ["pc.contract.name", "contract_name", "S"],
        ["pv.vendor.id", "vendor_id", "S"],
        ["v.vendor.name", "vendor_name", "S"],
        ["v.vendor.number", "vendor_number", "S"],
        ["pv.amount", "vendor_amount", "N"],
        ["pc.amount", "contract_amount", "N"],
        ["pv.currency", "vendor_currency", "S"],
        ["pc.currency", "contract_currency", "S"],
        ["pv.payment.method", "payment_method", "S"],
        ["v.supplier.id", "supplier_id", "S"],
        ["pv.ogl.sync.status", "ogl_sync_status", "S"],
        ["v.ogl.vendor.id", "ogl_vendor_id", "S"]
    ];

    var selectFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        selectFields.push(fieldMappings[i][0]);
    }

    var query =
            "SELECT " + selectFields.join(", ") +
            " FROM esdHTKTpaymentContract pc" +
            " LEFT JOIN esdHTKTpaymentVendor pv" +
            " ON (pc.payment.id = pv.payment.id AND pc.contract.id = pv.contract.id)" +
            " LEFT JOIN esdHTKTvendor v ON (pv.vendor.id = v.id)" +
            ' WHERE pc.payment.id = "' + escapeExpenseVendorQueryValue(paymentId) + '"';

    var file = new SCFile("esdHTKTpaymentContract", SCFILE_READONLY);
    try {
        var rc = file.doSelect(query);
        while (rc == RC_SUCCESS) {
            var item = mapExpenseVendorRow(file, fieldMappings);

            // Khi chưa có paymentVendor, dùng paymentContract.id làm khóa dòng
            // để hợp đồng mới tạo vẫn hiển thị trên danh sách Dự chi.
            item.id = item.payment_vendor_id || item.payment_contract_id;
            item.vendor_contract_id = item.contract_id;
            item.amount = item.payment_vendor_id ? item.vendor_amount : item.contract_amount;
            item.currency = item.vendor_currency || item.contract_currency || "VND";
            item.count = countExpenseVendorInvoices(
                    item.payment_id,
                    item.contract_id,
                    item.vendor_id
            );

            resultList.push(item);
            rc = file.getNext();
        }
    } finally {
        closeExpenseVendorFile(file);
    }

    return resultList;
}

function getExpenseVendorPaymentId(input) {
    try {
        var rawDetails = input ? (input.details || input.queryString) : null;
        if (!rawDetails) return "";

        var details = typeof rawDetails === "string" ? JSON.parse(rawDetails) : rawDetails;
        if (details instanceof Array) details = details[0] || {};
        return String(details.paymentId || details.expenseId || "").replace(/^\s+|\s+$/g, "");
    } catch (e) {
        return "";
    }
}

function countExpenseVendorInvoices(paymentId, contractId, vendorId) {
    if (!paymentId || !contractId || !vendorId) return 0;

    var countFile = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
    try {
        var query =
                "SELECT count(*) FROM esdHTKTpaymentInvoice pi" +
                ' WHERE pi.payment.id = "' + escapeExpenseVendorQueryValue(paymentId) + '"' +
                ' AND pi.contract.id = "' + escapeExpenseVendorQueryValue(contractId) + '"' +
                ' AND pi.vendor.id = "' + escapeExpenseVendorQueryValue(vendorId) + '"';

        if (countFile.doSelect(query) == RC_SUCCESS) {
            return Number(countFile[0] || 0);
        }
    } finally {
        closeExpenseVendorFile(countFile);
    }

    return 0;
}

function mapExpenseVendorRow(record, fieldMappings) {
    var item = {};
    for (var i = 0; i < fieldMappings.length; i++) {
        var key = fieldMappings[i][1];
        var type = fieldMappings[i][2];
        var value = record[i];

        if (type === "N") {
            item[key] = value ? Number(value) : 0;
        } else {
            item[key] = value ? String(value) : "";
        }
    }
    return item;
}

function escapeExpenseVendorQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function closeExpenseVendorFile(file) {
    if (!file) return;
    try { file.doClose(); } catch (e) {}
}
