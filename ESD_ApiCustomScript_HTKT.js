run()

function run() {
    var input = vars["$L.file"];
    var rawParams = input["queryString"];
    var name = input["name"];
    var parsed = {};
    var details = getInputDetails(input);

    var startTime = system.functions.tod();
    var TIMEOUT_MS = 7000;

    function isTimeout() {
        return (system.functions.tod() - startTime > TIMEOUT_MS);
    }

    function safeReturn(obj) {
        input["queryReturn"] = JSON.stringify(obj);
        vars.$L_exit = "normal";
    }

    try {
        parsed = JSON.parse(rawParams);
    } catch (e) {
        input["queryReturn"] = JSON.stringify({
            success: false,
            error: "Invalid JSON in queryString"
        });
        return;
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
            case "getGlAccounts":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getListGlAccount(details);
                break;
            case "getGlUnits":
            case "getGLUnits":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getGlUnitsApi(details);
                break;
            case "getCreatorAccountingInfo":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getCreatorAccountingInfo(details);
                break;
            case "getCostCenterOptions":
            case "getGlDepartments":
                result = lib.ESD_HTKT_PAYMENT_ENTRY.getCostCenterOptions(details);
                break;
            case "getTransactionOfficeOptions":
            case "getGlTransactionOffices":
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
                result =  lib.ESD_HTKT_PAYMENT_INVOICE.getListPaymentInvoice(input);

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