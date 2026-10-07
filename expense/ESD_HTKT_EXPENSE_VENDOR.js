/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VENDOR
 * Danh sách món Dự chi từ esdHTKTpaymentVendor.
 */

function getListExpenseVendor(input) {
    var resultList = [];
    var paymentId = getExpenseVendorPaymentId(input);
    if (!paymentId) return resultList;

    var paymentVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    try {
        var vendorRc = paymentVendorFile.doSelect(
                'payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"'
        );
        while (vendorRc == RC_SUCCESS) {
            resultList.push(buildExpenseVendorItem(paymentVendorFile));
            vendorRc = paymentVendorFile.getNext();
        }
    } finally {
        closeExpenseVendorFile(paymentVendorFile);
    }
    return resultList;
}

function buildExpenseVendorItem(paymentVendorFile) {
    var paymentVendorId = String(paymentVendorFile["id"] || "");
    var paymentId = String(paymentVendorFile["payment.id"] || "");
    var contractId = String(paymentVendorFile["contract.id"] || "");
    var vendorId = String(paymentVendorFile["vendor.id"] || "");
    var vendorInfo = getExpenseVendorInfo(vendorId);
    return {
        id: paymentVendorId,
        payment_id: paymentId,
        contract_id: contractId,
        vendor_number: vendorInfo.vendor_number,
        vendor_name: vendorInfo.vendor_name,
        amount: Number(paymentVendorFile["amount"] || 0),
        currency: String(paymentVendorFile["currency"] || "VND"),
        count: countExpenseVendorInvoices(
                paymentId,
                contractId,
                vendorId
        ),
        ogl_sync_status: paymentVendorFile["ogl.sync.status"],
        ogl_vendor_id: vendorInfo.ogl_vendor_id
    };
}

function getExpenseVendorInfo(vendorId) {
    var result = { vendor_number: "", vendor_name: "", ogl_vendor_id: "" };
    if (!vendorId) return result;

    var vendorFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
    try {
        if (vendorFile.doSelect('id="' + escapeExpenseVendorQueryValue(vendorId) + '"') == RC_SUCCESS) {
            result.vendor_number = String(vendorFile["vendor.number"] || "");
            result.vendor_name = String(vendorFile["vendor.name"] || "");
            result.ogl_vendor_id = String(vendorFile["ogl.vendor.id"] || "");
        }
    } finally {
        closeExpenseVendorFile(vendorFile);
    }
    return result;
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

function escapeExpenseVendorQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function closeExpenseVendorFile(file) {
    if (!file) return;
    try { file.doClose(); } catch (e) {}
}
