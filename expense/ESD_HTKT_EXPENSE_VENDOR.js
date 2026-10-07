/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VENDOR
 * Danh sách món Dự chi, lấy paymentContract làm dữ liệu gốc.
 */

function getListExpenseVendor(input) {
    var resultList = [];
    var paymentId = getExpenseVendorPaymentId(input);
    if (!paymentId) return resultList;

    var contractFile = new SCFile("esdHTKTpaymentContract", SCFILE_READONLY);
    try {
        var contractRc = contractFile.doSelect(
                'payment.id="' + escapeExpenseVendorQueryValue(paymentId) + '"'
        );
        while (contractRc == RC_SUCCESS) {
            appendExpenseVendorRows(resultList, {
                payment_id: String(contractFile["payment.id"] || paymentId),
                contract_id: String(contractFile["contract.id"] || ""),
                currency: String(contractFile["currency"] || "VND")
            });
            contractRc = contractFile.getNext();
        }
    } finally {
        closeExpenseVendorFile(contractFile);
    }
    return resultList;
}

function appendExpenseVendorRows(resultList, contractItem) {
    var paymentVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    var foundVendor = false;
    try {
        var vendorRc = paymentVendorFile.doSelect(
                'payment.id="' + escapeExpenseVendorQueryValue(contractItem.payment_id) + '"' +
                ' and contract.id="' + escapeExpenseVendorQueryValue(contractItem.contract_id) + '"'
        );
        while (vendorRc == RC_SUCCESS) {
            foundVendor = true;
            resultList.push(buildExpenseVendorItem(contractItem, paymentVendorFile));
            vendorRc = paymentVendorFile.getNext();
        }
    } finally {
        closeExpenseVendorFile(paymentVendorFile);
    }

    // Tương đương LEFT JOIN: vẫn trả hợp đồng khi chưa có paymentVendor.
    if (!foundVendor) resultList.push(buildExpenseVendorItem(contractItem, null));
}

function buildExpenseVendorItem(contractItem, paymentVendorFile) {
    var paymentVendorId = paymentVendorFile ? String(paymentVendorFile["id"] || "") : "";
    var vendorId = paymentVendorFile ? String(paymentVendorFile["vendor.id"] || "") : "";
    var vendorInfo = getExpenseVendorInfo(vendorId);
    return {
        id: paymentVendorId || buildExpenseContractRowId(contractItem.payment_id, contractItem.contract_id),
        payment_id: contractItem.payment_id,
        contract_id: contractItem.contract_id,
        vendor_number: vendorInfo.vendor_number,
        vendor_name: vendorInfo.vendor_name,
        amount: paymentVendorFile ? Number(paymentVendorFile["amount"] || 0) : 0,
        currency: contractItem.currency || "VND",
        count: countExpenseVendorInvoices(
                contractItem.payment_id,
                contractItem.contract_id,
                vendorId
        ),
        ogl_sync_status: paymentVendorFile
                ? paymentVendorFile["ogl.sync.status"]
                : false,
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

function buildExpenseContractRowId(paymentId, contractId) {
    return String(paymentId || "") + "|" + String(contractId || "");
}

function escapeExpenseVendorQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function closeExpenseVendorFile(file) {
    if (!file) return;
    try { file.doClose(); } catch (e) {}
}
