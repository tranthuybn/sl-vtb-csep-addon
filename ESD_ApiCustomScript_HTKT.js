run()

function run() {
    var input = vars["$L.file"];
    var rawParams = input["queryString"];
    var name = input["name"];
    var parsed = {};
    var nameParams = null;
    var glAccountPrefix = "getListGLAccount::";

    // Chỉ action getListGLAccount hỗ trợ truyền tham số trong name.
    if (name && name.indexOf(glAccountPrefix) === 0) {
        try {
            nameParams = JSON.parse(name.substring(glAccountPrefix.length));
            name = "getListGLAccount";
        } catch (e) {
            input["queryReturn"] = JSON.stringify({
                success: false,
                error: "Invalid JSON in getListGLAccount name"
            });
            return;
        }
    }

    var details = getInputDetails(input);
    if (nameParams) copyObject(details, nameParams);

    var startTime = system.functions.tod();
    var TIMEOUT_MS = 7000;

    function isTimeout() {
        return (system.functions.tod() - startTime > TIMEOUT_MS);
    }

    function safeReturn(obj) {
        input["queryReturn"] = JSON.stringify(obj);
        vars.$L_exit = "normal";
    }

    if (!nameParams) {
        try {
            parsed = JSON.parse(rawParams);
        } catch (e) {
            input["queryReturn"] = JSON.stringify({
                success: false,
                error: "Invalid JSON in queryString"
            });
            return;
        }
    }

    var result = null;
    try {
        switch (name) {
            case "listPurchaseContracts":
                result = lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.listPurchaseContracts(input);
                break;
            case "createPaymentRequest":
                result = lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.createPaymentRequest(input);
                break;
            case "getListPaymentEntry":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getListPaymentEntryByInputDetails(details);
                break;
            case "getGLAddRowOptions":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getGLAddRowOptions(details);
                break;
            case "syncPaymentEntry":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryNowByInputDetails(details);
                break;
            case "syncPaymentEntryBySourceChange":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
                    String(details.sourceTable || input.sourceTable || "").trim(),
                    details
                );
                break;
            case "savePaymentEntryEdit":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.savePaymentEntryEdit(details);
                break;
            case "getListGLAccount":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getListGlAccount(details);
                break;
            case "getGlUnits":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getGlUnitsApi(details);
                break;
            case "getCreatorAccountingInfo":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getCreatorAccountingInfo(details);
                break;
            case "getCostCenterOptions":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getCostCenterOptions(details);
                break;
            case "getTransactionOfficeOptions":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getTransactionOfficeOptionsApi(details);
                break;
            case "addFileAttachment":
                result = lib.ESD_HTKT_PAYMENT_FILE_ATTACHMENT.addFileAttachment(input);
                break;

            case "viewFileAttachment":
                result = lib.ESD_HTKT_PAYMENT_FILE_ATTACHMENT.viewFileAttachment(input);
                break;

            case "downloadFileAttachment":
                result = lib.ESD_HTKT_PAYMENT_FILE_ATTACHMENT.downloadFileAttachment(input);
                break;

            case "deleteFileAttachment":
                result = lib.ESD_HTKT_PAYMENT_FILE_ATTACHMENT.deleteFileAttachment(input);

            case 'getListPaymentInvoice':
                result = lib.ESD_HTKT_PAYMENT_INVOICE.getListPaymentInvoice(input);

            case "getCostDivision":
                var data = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getCostDivision(input);
                result = { success: true, data: data };
                break;
            case "createCostDivision":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.createCostDivision(input);
                break;
            case "updateCostDivision":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.updateCostDivision(input);
                break;
            case "deleteCostDivision":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.deleteCostDivision(input);
                break;
            case "importCostDivision":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.importCostDivision(input);
                break;

            // --- DANH MỤC ---
            case "getCreatorUnitInfo":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getCreatorAccountingInfo(input);
                break;
            case "getGlUnitsCostDivision":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getGlUnitOptions(input);
                break;
            case "getGlDepartments":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getGlDepartmentOptions(input);
                break;
            case "getGlTransactionOffices":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getGlTransactionOfficeOptions(input);
                break;
            case "getGlAccounts":
                result = lib.ESD_HTKT_PAYMENT_COST_DIVISION.getGlAccounts(input);
                break;


            //Danh sách Đề nghị theo nhà cung cấp
            case 'getListPaymentVendor':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.getListPaymentVendor(input);
                result = { success: true, data: data };
                break;
                //tổng nhà cung cấp
            case 'totalContractSuppliers':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.totalContractSuppliers(input);
                result = { success: true, data: data };
                break;
                //Xóa nhà cung cấp
            case 'deletePaymentVendor':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.deletePaymentVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn có thể chọn theo nhà cung cấp
            case 'getListInvoinVendor':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.getListInvoinVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn đã được gán với nhà cung cấp
            case 'getInvoicesBySupplier':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.getInvoicesBySupplier(input);
                result = { success: true, data: data };
                break;
                //Gán hóa đơn vào nhà cung cấp
            case 'createListInvoinVendor':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.createListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            case 'deletePaymentInvoice':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.deletePaymentInvoice(input);
                result = { success: true, data: data };
                break;
                //cập nhật Loại khấu trừ thuế 
            case 'updateListInvoinVendor':
                var data = lib.ESD_HTKT_PAYMENT_VENDOR.updateListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            case "getListSupplierLedger":
                result = { success: true, data: lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getListSupplierLedger(input) };
                break;
            case "getListAccountsPayable":
                result = { success: true, data: lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getListAccountsPayable(input) };
                break;
            case 'saveListPaymentEntryRefund':
                var data = lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.saveListPaymentEntryRefund(input);
                result = { success: true, data: data };
                break;
            case 'saveListPaymentEntryPayable':
                var data = lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.saveListPaymentEntryPayable(input);
                result = { success: true, data: data };
                break;
            case "getCurrentPaymentSummary":
                result = { success: true, data: lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getCurrentPaymentSummary(input) };
                break;
            case "getSupplierDebtSummary":
                result = { success: true, data: lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getSupplierDebtSummary(input) };
                break;    

            default:
                result = {
                    success: false,
                    message: "Unknown action: " + name
                };
        }
    } catch (actionError) {
        return safeReturn({
            success: false,
            error: "ACTION_EXECUTION_ERROR",
            detail: actionError.message,
            action: name
        });
    }
    if (isTimeout()) {
        return safeReturn({
            success: false,
            error: "TIMEOUT",
            action: name
        });
    }

    input["queryReturn"] = JSON.stringify(result);
    vars.$L_exit = "normal";
}



function getInputDetails(input) {
    var parsed = {};

    copyObject(parsed, parseJsonObject(input.queryString));
    copyObject(parsed, parseJsonObject(input.details));

    if (!parsed.paymentId) parsed.paymentId = input.paymentId || input.id;
    if (!parsed.vendorId && input.vendorId) parsed.vendorId = input.vendorId;
    if (!parsed.entries && input.entries) parsed.entries = input.entries;

    return parsed;
}

function copyObject(target, source) {
    if (!source) return target;

    for (var key in source) {
        if (source.hasOwnProperty(key)) target[key] = source[key];
    }

    return target;
}

function parseJsonObject(value) {
    if (!value) return null;

    try {
        var parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        return null;
    }
}
