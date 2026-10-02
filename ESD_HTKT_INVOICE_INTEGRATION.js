var createActivity = lib.ESD_Utils.createActivity;

//Helper bổ sung để lấy thông tin đơn vị của người upload.
// Chỉ dùng để ghi thêm unit.lv1/unit.lv2/unit.lv3 vào hóa đơn
function safeHTKTValue(value) {
    return value == null ? "" : String(value).trim();
}

function escapeHTKTQueryValue(value) {
    return safeHTKTValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getContactUnitInfo(contactId) {
    var result = {
        lv1: "",
        lv2: "",
        lv3: "",
        branchCode: "",
        fullName: ""
    };

    var safeContactId = safeHTKTValue(contactId);

    if (!safeContactId) {
        return result;
    }

    var contactFile = null;

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect('contact.name="' + escapeHTKTQueryValue(safeContactId) + '"');

        if (rcContact == RC_SUCCESS) {
            result.fullName =
                safeHTKTValue(contactFile["full.name"]) ||
                safeHTKTValue(contactFile["contact.full.name"]) ||
                safeHTKTValue(contactFile["contact.name"]);

            result.branchCode =
                safeHTKTValue(contactFile["branch.code"]) ||
                safeHTKTValue(contactFile["branch_code"]);

            result.lv1 =
                safeHTKTValue(contactFile["lv1.id"]) ||
                safeHTKTValue(contactFile.lv1_id) ||
                safeHTKTValue(contactFile["unit.lv1"]);

            result.lv2 =
                safeHTKTValue(contactFile["lv2.id"]) ||
                safeHTKTValue(contactFile.lv2_id) ||
                safeHTKTValue(contactFile["unit.lv2"]);

            result.lv3 =
                safeHTKTValue(contactFile["lv3.id"]) ||
                safeHTKTValue(contactFile.lv3_id) ||
                safeHTKTValue(contactFile["unit.lv3"]);
        }
    } catch (e) {
        print("[HTKT][SM_UPLOAD][CONTACT_UNIT_ERROR] contactId=" + safeContactId + " | error=" + e);
    }

    try {
        if (contactFile) {
            contactFile.doClose();
        }
    } catch (eClose) {}

    print(
        "[HTKT][SM_UPLOAD][CONTACT_UNIT] contactId=" + safeContactId +
        " | lv1=" + result.lv1 +
        " | lv2=" + result.lv2 +
        " | lv3=" + result.lv3 +
        " | branchCode=" + result.branchCode
    );

    return result;
}

// [HTKT][UNIT_SCOPE] Lấy phạm vi dữ liệu của người upload theo cấu hình chung Hợp đồng.
// Chỉ dùng để chuẩn hóa unit lưu trên hóa đơn; không thay đổi logic upload/check/trùng hiện có.
function getHTKTUploaderDataPermission(contactId) {
    var result = {
        scope: "",
        unit: []
    };

    var safeContactId = safeHTKTValue(contactId);

    if (!safeContactId) {
        return result;
    }

    try {
        result = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(safeContactId, "00401") || result;
    } catch (e) {
        print("[HTKT][SM_UPLOAD][UPLOADER_SCOPE_ERROR] contactId=" + safeContactId + " | error=" + e);
        result = {
            scope: "",
            unit: []
        };
    }

    print("[HTKT][SM_UPLOAD][UPLOADER_SCOPE] contactId=" + safeContactId + " | dataPermission=" + JSON.stringify(result));

    return result;
}

function firstHTKTUnit(unitArr) {
    if (!unitArr || !unitArr.length) {
        return "";
    }

    for (var i = 0; i < unitArr.length; i++) {
        var value = safeHTKTValue(unitArr[i]);
        if (value) {
            return value;
        }
    }

    return "";
}

function normalizeHTKTInvoiceUnitsByUploaderScope(uploadUser, contactUnitInfo, overrideLv1, overrideLv2, overrideLv3) {
    contactUnitInfo = contactUnitInfo || {
        lv1: "",
        lv2: "",
        lv3: ""
    };

    var dataPermission = getHTKTUploaderDataPermission(uploadUser);
    var scope = dataPermission && dataPermission.scope ? safeHTKTValue(dataPermission.scope) : "";
    var permissionUnit = dataPermission && dataPermission.unit ? firstHTKTUnit(dataPermission.unit) : "";

    var rawLv1 = safeHTKTValue(overrideLv1) || safeHTKTValue(contactUnitInfo.lv1) || "";
    var rawLv2 = safeHTKTValue(overrideLv2) || safeHTKTValue(contactUnitInfo.lv2) || "";
    var rawLv3 = safeHTKTValue(overrideLv3) || safeHTKTValue(contactUnitInfo.lv3) || "";

    var result = {
        scope: scope,
        lv1: "",
        lv2: "",
        lv3: ""
    };

    // User scope Khối/CN/ĐVSN: hóa đơn chỉ mang mã khối ở unit.lv1.
    // Không lưu unit.lv2 để user scope Phòng/Trung tâm không nhìn thấy dữ liệu cấp khối.
    if (scope === "QT_PQDL_04") {
        result.lv1 = permissionUnit || rawLv1;
        result.lv2 = "";
        result.lv3 = "";
    }
    // User scope Phòng/Trung tâm: hóa đơn mang mã khối + mã phòng/trung tâm.
    // Không lưu unit.lv3 để scope thấp hơn không nhìn nhầm.
    else if (scope === "QT_PQDL_03") {
        result.lv1 = rawLv1;
        result.lv2 = permissionUnit || rawLv2;
        result.lv3 = "";
    }
    // User scope Phòng ban thuộc trung tâm: lưu đủ lv1/lv2/lv3.
    else if (scope === "QT_PQDL_02") {
        result.lv1 = rawLv1;
        result.lv2 = rawLv2;
        result.lv3 = permissionUnit || rawLv3;
    }
    // Cá nhân hoặc không có scope: giữ theo contact để cấp Phòng/Khối vẫn xem được dữ liệu cá nhân.
    else {
        result.lv1 = rawLv1;
        result.lv2 = rawLv2;
        result.lv3 = rawLv3;
    }

    print(
        "[HTKT][SM_UPLOAD][NORMALIZED_UNIT] uploadUser=" + safeHTKTValue(uploadUser) +
        " | scope=" + result.scope +
        " | unit.lv1=" + result.lv1 +
        " | unit.lv2=" + result.lv2 +
        " | unit.lv3=" + result.lv3
    );

    return result;
}


// [HTKT][DELETE_INTEGRATION] Custom delete invoices từ NextJS.
// Chỉ bổ sung action mới "deleteInvoices", không thay đổi logic upload/base64/addInvoice hiện có.
// NextJS gọi vào cùng resource esdHTKTinvoiceIntegration với:
// {
//   esdHTKTinvoiceIntegration: {
//     name: "deleteInvoices",
//     queryString: "{\"currentUser\":\"VTB.HTKT.xxx\",\"records\":[{\"id\":\"IV...\"}]}"
//   }
// }
function parseHTKTJsonSafe(value) {
    var text = safeHTKTValue(value);

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (eJson) {
        try {
            return rteJSONParse(text);
        } catch (eRte) {
            return {};
        }
    }
}

function normalizeHTKTDeleteArray(value) {
    var result = [];

    if (!value) {
        return result;
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        var parts = value.split(",");

        for (var i = 0; i < parts.length; i++) {
            var item = safeHTKTValue(parts[i]);

            if (item) {
                result.push(item);
            }
        }
    }

    return result;
}

function readHTKTDeleteRequest(fileInput) {
    if (!fileInput) {
        return {};
    }

    if (fileInput.queryString) {
        return parseHTKTJsonSafe(fileInput.queryString);
    }

    if (fileInput.esdHTKTinvoiceIntegration && fileInput.esdHTKTinvoiceIntegration.queryString) {
        return parseHTKTJsonSafe(fileInput.esdHTKTinvoiceIntegration.queryString);
    }

    return fileInput;
}

function getHTKTDeleteCurrentUser(request) {
    request = request || {};

    var ctx = request.currentUserContext || request.auditContext || {};

    return safeHTKTValue(
        request.currentUser ||
        request.contactId ||
        request.userName ||
        request.user ||
        request["contact.name"] ||
        ctx.currentUser ||
        ctx.contactId ||
        ctx.userName ||
        ctx.user ||
        ctx["contact.name"]
    );
}

function normalizeHTKTDeleteTargets(request) {
    request = request || {};

    var source =
        request.records ||
        request.invoiceRecords ||
        request.invoices ||
        request.invoiceIds ||
        request.invoiceIDs ||
        request.ids ||
        [];

    var arr = normalizeHTKTDeleteArray(source);
    var result = [];
    var seen = {};

    for (var i = 0; i < arr.length; i++) {
        var rawItem = arr[i];
        var id = "";
        var invoiceNumber = "";

        if (rawItem && typeof rawItem === "object") {
            id = safeHTKTValue(
                rawItem.id ||
                rawItem.invoiceId ||
                rawItem.invoiceID ||
                rawItem.parentId ||
                rawItem.parent_id
            );

            invoiceNumber = safeHTKTValue(
                rawItem.invoiceNumber ||
                rawItem.invoice_number ||
                rawItem["invoice.number"]
            );
        } else {
            id = safeHTKTValue(rawItem);
        }

        if (!id || seen[id]) {
            continue;
        }

        seen[id] = true;

        result.push({
            id: id,
            invoiceNumber: invoiceNumber
        });
    }

    return result;
}

function normalizeHTKTRightsArray(rawRights) {
    var result = [];

    try {
        if (rawRights && rawRights.toArray) {
            rawRights = rawRights.toArray();
        }
    } catch (eToArray) {}

    if (!Array.isArray(rawRights)) {
        return result;
    }

    for (var i = 0; i < rawRights.length; i++) {
        var rightId = safeHTKTValue(rawRights[i]);

        if (rightId) {
            result.push(rightId);
        }
    }

    return result;
}

function getHTKTDeleteRights(currentUser) {
    var rights = [];

    try {
        if (lib.ESD_PERMS_RIGHTS && lib.ESD_PERMS_RIGHTS.permsRight) {
            rights = lib.ESD_PERMS_RIGHTS.permsRight(currentUser) || [];
        }
    } catch (e) {
        rights = [];
    }

    return normalizeHTKTRightsArray(rights);
}

function hasHTKTDeleteRight(rightsArray, rightId) {
    if (!rightsArray || !rightsArray.length || !rightId) {
        return false;
    }

    for (var i = 0; i < rightsArray.length; i++) {
        if (safeHTKTValue(rightsArray[i]) === rightId) {
            return true;
        }
    }

    return false;
}

function buildHTKTDeleteBlockedRecord(target, currentUser, createdBy, reason) {
    target = target || {};

    return {
        id: safeHTKTValue(target.id),
        invoiceNumber: safeHTKTValue(target.invoiceNumber || target.id),
        createdBy: safeHTKTValue(createdBy),
        currentUser: safeHTKTValue(currentUser),
        reason: safeHTKTValue(reason)
    };
}

function closeHTKTFileSafe(fileObj) {
    try {
        if (fileObj) {
            fileObj.doClose();
        }
    } catch (eClose) {}
}

function getHTKTInvoiceForDelete(invoiceId) {
    var invoiceFile = new SCFile("esdHTKTinvoice");
    var rc = invoiceFile.doSelect('id="' + escapeHTKTQueryValue(invoiceId) + '"');

    if (rc !== RC_SUCCESS) {
        closeHTKTFileSafe(invoiceFile);
        return null;
    }

    return invoiceFile;
}

function createHTKTDeleteActivity(invoiceId, invoiceNumber, currentUser) {
    try {
        var activityLines = [
            "ID hóa đơn: " + safeHTKTValue(invoiceId),
            "Số hóa đơn: " + safeHTKTValue(invoiceNumber),
            "Người xóa: " + safeHTKTValue(currentUser)
        ];

        createActivity(
            "activityHTKTinvoice",
            activityLines,
            invoiceId,
            "Xóa hóa đơn",
            currentUser
        );
    } catch (eActivity) {}
}

function deleteInvoices(fileInput) {
    var RIGHT_HTKT_INVOICE_DELETE = "0040040001000003";

    var request = readHTKTDeleteRequest(fileInput);
    var currentUser = getHTKTDeleteCurrentUser(request);
    var targets = normalizeHTKTDeleteTargets(request);

    var deletedRecords = [];
    var blockedRecords = [];
    var failedRecords = [];

    if (!currentUser) {
        return {
            success: false,
            currentUser: "",
            deletedCount: 0,
            blockedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            deletedRecords: [],
            blockedRecords: [],
            failedRecords: [],
            skippedRecords: [],
            message: "Không xác định được currentUser để xóa hóa đơn."
        };
    }

    if (!targets.length) {
        return {
            success: false,
            currentUser: currentUser,
            deletedCount: 0,
            blockedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            deletedRecords: [],
            blockedRecords: [],
            failedRecords: [],
            skippedRecords: [],
            message: "Danh sách hóa đơn xóa trống."
        };
    }

    var rightsArray = getHTKTDeleteRights(currentUser);
    var hasDeleteRight = hasHTKTDeleteRight(rightsArray, RIGHT_HTKT_INVOICE_DELETE);

    if (!hasDeleteRight) {
        for (var r = 0; r < targets.length; r++) {
            blockedRecords.push(
                buildHTKTDeleteBlockedRecord(
                    targets[r],
                    currentUser,
                    "",
                    "User không có quyền Xóa hóa đơn: " + RIGHT_HTKT_INVOICE_DELETE
                )
            );
        }

        return {
            success: false,
            currentUser: currentUser,
            deletedCount: 0,
            blockedCount: blockedRecords.length,
            failedCount: 0,
            skippedCount: blockedRecords.length,
            deletedRecords: [],
            blockedRecords: blockedRecords,
            failedRecords: [],
            skippedRecords: blockedRecords,
            message: "Bạn không có quyền xóa hóa đơn."
        };
    }

    for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var invoiceId = safeHTKTValue(target.id);

        if (!invoiceId) {
            blockedRecords.push(
                buildHTKTDeleteBlockedRecord(
                    target,
                    currentUser,
                    "",
                    "Hóa đơn không có ID hợp lệ."
                )
            );
            continue;
        }

        var invoiceFile = null;

        try {
            invoiceFile = getHTKTInvoiceForDelete(invoiceId);

            if (!invoiceFile) {
                blockedRecords.push(
                    buildHTKTDeleteBlockedRecord(
                        target,
                        currentUser,
                        "",
                        "Không tìm thấy hóa đơn trong SM."
                    )
                );
                continue;
            }

            var invoiceNumber = safeHTKTValue(invoiceFile["invoice.number"] || target.invoiceNumber || invoiceId);
            var createdBy = safeHTKTValue(invoiceFile["created.by"] || invoiceFile.created_by || invoiceFile.createdBy);

            if (!createdBy) {
                blockedRecords.push(
                    buildHTKTDeleteBlockedRecord(
                        {
                            id: invoiceId,
                            invoiceNumber: invoiceNumber
                        },
                        currentUser,
                        "",
                        "Không xác định được người upload hóa đơn."
                    )
                );

                closeHTKTFileSafe(invoiceFile);
                invoiceFile = null;
                continue;
            }

            if (createdBy !== currentUser) {
                blockedRecords.push(
                    buildHTKTDeleteBlockedRecord(
                        {
                            id: invoiceId,
                            invoiceNumber: invoiceNumber
                        },
                        currentUser,
                        createdBy,
                        "Hóa đơn được upload bởi " + createdBy + ", user hiện tại là " + currentUser + "."
                    )
                );

                closeHTKTFileSafe(invoiceFile);
                invoiceFile = null;
                continue;
            }

            var deleteRc = invoiceFile.doDelete();

            if (deleteRc === RC_SUCCESS) {
                deletedRecords.push({
                    id: invoiceId,
                    invoiceNumber: invoiceNumber,
                    createdBy: createdBy
                });

                createHTKTDeleteActivity(invoiceId, invoiceNumber, currentUser);
            } else {
                failedRecords.push({
                    id: invoiceId,
                    invoiceNumber: invoiceNumber,
                    createdBy: createdBy,
                    currentUser: currentUser,
                    reason: "SM doDelete không thành công: " + RCtoString(deleteRc)
                });
            }

            closeHTKTFileSafe(invoiceFile);
            invoiceFile = null;
        } catch (e) {
            failedRecords.push({
                id: invoiceId,
                invoiceNumber: safeHTKTValue(target.invoiceNumber || invoiceId),
                createdBy: "",
                currentUser: currentUser,
                reason: String(e)
            });

            closeHTKTFileSafe(invoiceFile);
            invoiceFile = null;
        }
    }

    var skippedRecords = blockedRecords.concat(failedRecords);
    var hasTechnicalFailure = failedRecords.length > 0;

    return {
        success: !hasTechnicalFailure,
        partialSuccess: deletedRecords.length > 0 && skippedRecords.length > 0,
        currentUser: currentUser,
        deletedCount: deletedRecords.length,
        blockedCount: blockedRecords.length,
        failedCount: failedRecords.length,
        skippedCount: skippedRecords.length,
        deletedRecords: deletedRecords,
        blockedRecords: blockedRecords,
        failedRecords: failedRecords,
        skippedRecords: skippedRecords,
        message:
            "Đã xóa " +
            deletedRecords.length +
            " hóa đơn. Không xóa " +
            skippedRecords.length +
            " hóa đơn."
    };
}


// [HTKT][CHECK_INVOICE_INTEGRATION] Kiểm tra hóa đơn thủ công từ NextJS.
// Chỉ bổ sung action mới "checkInvoices", không thay đổi logic upload/base64/deleteInvoices hiện có.
// NextJS gọi vào cùng resource esdHTKTinvoiceIntegration với:
// {
//   esdHTKTinvoiceIntegration: {
//     name: "checkInvoices",
//     queryString: "{\"mode\":\"MANUAL\",\"currentUser\":\"VTB.HTKT.xxx\",\"records\":[{\"id\":\"IV...\"}]}"
//   }
// }
function readHTKTCheckInvoiceRequest(fileInput) {
    if (!fileInput) {
        return {};
    }

    if (fileInput.queryString) {
        return parseHTKTJsonSafe(fileInput.queryString);
    }

    if (fileInput.esdHTKTinvoiceIntegration && fileInput.esdHTKTinvoiceIntegration.queryString) {
        return parseHTKTJsonSafe(fileInput.esdHTKTinvoiceIntegration.queryString);
    }

    return fileInput;
}

function getHTKTCheckInvoiceCurrentUser(request) {
    request = request || {};

    var ctx = request.currentUserContext || request.auditContext || {};

    return safeHTKTValue(
        request.currentUser ||
        request.contactId ||
        request.userName ||
        request.user ||
        request["contact.name"] ||
        ctx.currentUser ||
        ctx.contactId ||
        ctx.userName ||
        ctx.user ||
        ctx["contact.name"]
    );
}

function normalizeHTKTCheckInvoiceTargets(request) {
    request = request || {};

    var source =
        request.records ||
        request.invoiceRecords ||
        request.invoices ||
        request.invoiceIds ||
        request.invoiceIDs ||
        request.ids ||
        [];

    var arr = normalizeHTKTDeleteArray(source);
    var result = [];
    var seen = {};

    for (var i = 0; i < arr.length; i++) {
        var rawItem = arr[i];
        var id = "";
        var invoiceNumber = "";

        if (rawItem && typeof rawItem === "object") {
            id = safeHTKTValue(
                rawItem.id ||
                rawItem.invoiceId ||
                rawItem.invoiceID ||
                rawItem["invoice.id"]
            );

            invoiceNumber = safeHTKTValue(
                rawItem.invoiceNumber ||
                rawItem.invoice_number ||
                rawItem["invoice.number"]
            );
        } else {
            id = safeHTKTValue(rawItem);
        }

        if (!id || seen[id]) {
            continue;
        }

        seen[id] = true;

        result.push({
            id: id,
            invoiceNumber: invoiceNumber
        });
    }

    return result;
}

function checkInvoices(fileInput) {
    var request = readHTKTCheckInvoiceRequest(fileInput);
    var currentUser = getHTKTCheckInvoiceCurrentUser(request);
    var mode = safeHTKTValue(request.mode || "MANUAL").toUpperCase();
    var targets = normalizeHTKTCheckInvoiceTargets(request);

    if (mode !== "MANUAL") {
        return {
            success: false,
            mode: mode,
            currentUser: currentUser,
            totalProcessed: 0,
            successCount: 0,
            failedCount: 0,
            results: [],
            message: "Action checkInvoices chỉ hỗ trợ mode MANUAL."
        };
    }

    if (!currentUser) {
        return {
            success: false,
            mode: "MANUAL",
            currentUser: "",
            totalProcessed: 0,
            successCount: 0,
            failedCount: 0,
            results: [],
            message: "Không xác định được currentUser để kiểm tra hóa đơn."
        };
    }

    if (!targets.length) {
        return {
            success: false,
            mode: "MANUAL",
            currentUser: currentUser,
            totalProcessed: 0,
            successCount: 0,
            failedCount: 0,
            results: [],
            message: "Danh sách hóa đơn kiểm tra trống."
        };
    }

    var results = [];
    var successCount = 0;
    var failedCount = 0;

    for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var invoiceId = safeHTKTValue(target.id);

        try {
            var checkResult = lib.ESD_HTKT_SCHEDULE_OGL.processInvoiceManual(
                invoiceId,
                currentUser
            );

            if (!checkResult || typeof checkResult !== "object") {
                checkResult = {
                    success: false,
                    id: invoiceId,
                    invoiceNumber: safeHTKTValue(target.invoiceNumber || invoiceId),
                    checkStatus: "CHECKING",
                    jobStatus: "MANUAL",
                    errorCodes: "",
                    message: "ESD_HTKT_SCHEDULE_OGL.processInvoiceManual không trả về kết quả hợp lệ."
                };
            }

            // Đảm bảo response luôn có ID/số hóa đơn để NextJS map đúng record,
            // nhưng không thay đổi kết quả business do ESD_HTKT_SCHEDULE_OGL trả về.
            if (!safeHTKTValue(checkResult.id)) {
                checkResult.id = invoiceId;
            }

            if (!safeHTKTValue(checkResult.invoiceNumber)) {
                checkResult.invoiceNumber = safeHTKTValue(target.invoiceNumber || invoiceId);
            }

            if (checkResult.success === true) {
                successCount++;
            } else {
                failedCount++;
            }

            results.push(checkResult);
        } catch (e) {
            failedCount++;

            results.push({
                success: false,
                id: invoiceId,
                invoiceNumber: safeHTKTValue(target.invoiceNumber || invoiceId),
                checkStatus: "CHECKING",
                jobStatus: "MANUAL",
                errorCodes: "",
                message: e && e.toString ? e.toString() : String(e)
            });
        }
    }

    return {
        success: failedCount === 0,
        partialSuccess: successCount > 0 && failedCount > 0,
        mode: "MANUAL",
        currentUser: currentUser,
        totalProcessed: results.length,
        successCount: successCount,
        failedCount: failedCount,
        results: results,
        message:
            "Đã kiểm tra thủ công " +
            results.length +
            " hóa đơn. Thành công " +
            successCount +
            ", chưa thành công " +
            failedCount +
            "."
    };
}


function run() {

    try {
        var input = vars['$L.file'];
        
        if (!input) { return; }

        var name = input.name;
        if (!name) {
            input.queryReturn = JSON.stringify({ success: false, error: 'Missing action "name"' });
            return;
        }

        var result;
        switch (name) {
            case 'base64':
                result = base64(input);
                break;

            case 'deleteInvoices':
                result = deleteInvoices(input);
                break;

            case 'checkInvoices':
                result = checkInvoices(input);
                break;

            default:
                result = { success: false, message: "Hành động (name) không hợp lệ: " + name };
        }

        // Ép kiểu chuỗi JSON gọn gàng trả ra cổng API Gateway
        input.queryReturn = JSON.stringify(result);

    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}



function base64(fileInput) {

    try {
        var rawQueryString = fileInput.queryString;
        if (!rawQueryString) {
            return { success: false, message: "Thiếu dữ liệu trong trường queryString" };
        }

        var dataObj = JSON.parse(rawQueryString);
        if (!dataObj || !dataObj.files || dataObj.files.length === 0) {
            return { success: false, message: "Mảng 'files' trống hoặc cấu trúc JSON không đúng" };
        }
        
        var uploadedCount = 0;
        var ecmResults = [];

        var currentUserContext = dataObj.currentUserContext || {};
        var currentUser = dataObj.currentUser || dataObj.contactId || currentUserContext.currentUser || currentUserContext.contactId || dataObj.userName || "";
        var operatorName = dataObj.operatorName || currentUserContext.operatorName || dataObj.userName || currentUser;
        var fullName = dataObj.fullName || currentUserContext.fullName || "";
        var branchCode = dataObj.branchCode || currentUserContext.branchCode || "1010635";
        var userName = dataObj.userName || operatorName || currentUser || "vtb.htkt.41";

        var uploaderUnitInfo = getContactUnitInfo(currentUser);
        var normalizedUploaderUnit = normalizeHTKTInvoiceUnitsByUploaderScope(
            currentUser,
            uploaderUnitInfo,
            dataObj.unitLv1 || dataObj["unit.lv1"] || currentUserContext.unitLv1 || currentUserContext["unit.lv1"] || "",
            dataObj.unitLv2 || dataObj["unit.lv2"] || currentUserContext.unitLv2 || currentUserContext["unit.lv2"] || "",
            dataObj.unitLv3 || dataObj["unit.lv3"] || currentUserContext.unitLv3 || currentUserContext["unit.lv3"] || ""
        );

        var unitLv1 = normalizedUploaderUnit.lv1 || "";
        var unitLv2 = normalizedUploaderUnit.lv2 || "";
        var unitLv3 = normalizedUploaderUnit.lv3 || "";

        if (!branchCode && uploaderUnitInfo.branchCode) {
            branchCode = uploaderUnitInfo.branchCode;
        }

        print(
            "[HTKT][SM_UPLOAD][USER_UNIT_CONTEXT] currentUser=" + currentUser +
            " | operatorName=" + operatorName +
            " | branchCode=" + branchCode +
            " | unit.lv1=" + unitLv1 +
            " | unit.lv2=" + unitLv2 +
            " | unit.lv3=" + unitLv3
        );

        // --- BẮT ĐẦU VÒNG LẶP GỌI UPLOAD INVOICE ---
        var totalStartTime = new Date().getTime(); // [LOG TIME] Đánh dấu thời điểm bắt đầu toàn bộ vòng lặp

        for (var i = 0; i < dataObj.files.length; i++) {
            var fileItem = dataObj.files[i];
            var base64Data = fileItem.base64Data;
            var fileName = fileItem.fileName || ("attachment_" + i + ".xml");

            if (!base64Data) {
                ecmResults.push({ fileName: fileName, success: false, error: "File trống dữ liệu (base64Data)" });
                continue;
            }
                       
            try {
                // 1. Giải mã dữ liệu base64 sang nội dung text/xml
                var xmlContent = customBase64Decode(base64Data); 

                // 2. Đóng gói payload để truyền vào hàm uploadInvoice
                var uploadPayload = {
                    fileName: fileName,
                    fileContent: xmlContent,
                    branchCode: branchCode,
                    userName: userName
                };
                 
                // 3. Đo thời gian gọi hàm uploadInvoice cho từng file
                var singleStartTime = new Date().getTime(); // [LOG TIME] Bắt đầu gọi API
                
                var responseBody = lib.ESD_HTKT_INVOICE_VATIN_INTEGRATION.uploadInvoice(uploadPayload);
                print("responseBody " + JSON.stringify(responseBody))
                var singleEndTime = new Date().getTime(); // [LOG TIME] Kết thúc gọi API
                var singleDuration = singleEndTime - singleStartTime; // Thời gian xử lý (ms)

                print(
                    "[HTKT][UPLOAD_TIME][SINGLE] Index=" + i +
                    " | File=" + fileName +
                    " | Duration=" + singleDuration + " ms" +
                    " (" + (singleDuration / 1000).toFixed(2) + "s)"
                );

                if (responseBody) {
                    uploadedCount++;
                    ecmResults.push({
                        fileName: fileName,
                        success: true,
                        response: responseBody
                    });
                } else {
                    ecmResults.push({
                        fileName: fileName,
                        success: false,
                        error: "API uploadInvoice phản hồi lỗi hoặc không kết nối được (Null)"
                    });
                }
            } catch (httpError) {
                ecmResults.push({
                    fileName: fileName,
                    success: false,
                    error: "Lỗi trong quá trình upload: " + httpError.toString()
                });
            }
        }

        var totalEndTime = new Date().getTime(); // [LOG TIME] Đánh dấu thời điểm kết thúc toàn bộ vòng lặp
        var totalDuration = totalEndTime - totalStartTime; // Tổng thời gian xử lý (ms)

        print(
            "[HTKT][UPLOAD_TIME][TOTAL] Tong so file=" + dataObj.files.length +
            " | So file thanh cong=" + uploadedCount +
            " | Tong thoi gian upload=" + totalDuration + " ms" +
            " (" + (totalDuration / 1000).toFixed(2) + "s)"
        );
        // --- KẾT THÚC VÒNG LẶP ---
        
        var finalMappedInvoices = mapEcmResponseToInvoices(
            ecmResults,
            dataObj.checked,
            dataObj.isBulk,
            currentUser,
            operatorName,
            branchCode,
            unitLv1,
            unitLv2,
            unitLv3
        );
        
        if (!finalMappedInvoices || finalMappedInvoices.length === 0) {
            return { success: false, message: "Không bóc tách được dữ liệu hóa đơn nào từ hệ thống (Do toàn bộ file upload thất bại hoặc lỗi kết nối)." };
        }
        
        var mockFileInput = {
            "queryString": JSON.stringify(finalMappedInvoices),
            "currentUser": currentUser,
            "operatorName": operatorName,
            "fullName": fullName,
            "branchCode": branchCode,
            "unitLv1": unitLv1,
            "unitLv2": unitLv2,
            "unitLv3": unitLv3,
            "unit.lv1": unitLv1,
            "unit.lv2": unitLv2,
            "unit.lv3": unitLv3
        };

        var invoiceOutput = addInvoice(mockFileInput);
        var finalResult = {
            "invoiceDetail": { 
                "queryReturn": invoiceOutput, 
                "name": "addInvoice",
                "details": mockFileInput 
            }
        };

        return finalResult;

    } catch (error) {
        return { success: false, message: "Lỗi phát sinh tại hàm base64: " + error.toString() };
    }
}

function customBase64Decode(input) {
    if (!input) {
        return null;
    }

    try {

        if (input.indexOf("base64,") !== -1) {
            input = input.split("base64,")[1];
        }

        input = String(input)
            .replace(/\s/g, "")
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        if (typeof funcs !== 'undefined' &&
            typeof funcs.base64decode === 'function') {

            return funcs.base64decode(input);
        }

        if (typeof system !== 'undefined' &&
            system.functions &&
            typeof system.functions.base64decode === 'function') {

            return system.functions.base64decode(input);
        }

        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var output = "";
        var i = 0;

        while (i < input.length) {

            var enc1 = chars.indexOf(input.charAt(i++));
            var enc2 = chars.indexOf(input.charAt(i++));
            var enc3 = chars.indexOf(input.charAt(i++));
            var enc4 = chars.indexOf(input.charAt(i++));

            var chr1 = (enc1 << 2) | (enc2 >> 4);
            var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            var chr3 = ((enc3 & 3) << 6) | enc4;

            output += String.fromCharCode(chr1);

            if (enc3 !== 64 && enc3 !== -1) {
                output += String.fromCharCode(chr2);
            }

            if (enc4 !== 64 && enc4 !== -1) {
                output += String.fromCharCode(chr3);
            }
        }

        try {
            if (typeof decodeURIComponent === "function" &&
                typeof escape === "function") {
                return decodeURIComponent(escape(output));
            }
        } catch (e) {}

        return output;

    } catch (e) {
        throw new Error("Base64 decode failed: " + e);
    }
}

/**
 * Hàm Mapping dữ liệu hóa đơn độc lập (Chuẩn hóa ES5 cho Service Manager)
 */
function mapEcmResponseToInvoices(ecmResults, checked, isBulk, currentUser, operatorName, branchCode, unitLv1, unitLv2, unitLv3) {
    var allMappedInvoices = [];
    if (!ecmResults || !Array.isArray(ecmResults)) {
        return allMappedInvoices;
    }

    // Thiết lập độ ưu tiên
    var priorityLevel;
    if (checked) {
        priorityLevel = 3;
    } else if (isBulk) {
        priorityLevel = 4;
    } else {
        priorityLevel = 2;
    }
    

    for (var d = 0; d < ecmResults.length; d++) {
    
        var fileDetail = ecmResults[d];

        // Xử lý trường hợp đối tượng phản hồi từ API (dựa trên cấu trúc đã cho)
        // Nếu fileDetail là kết quả trả về trực tiếp, ta dùng nó, ngược lại kiểm tra .response
        var resp = fileDetail.response ? fileDetail.response : fileDetail;

        // Xử lý lỗi từ hệ thống
        if (resp.success === false) {
            var originalMsg = resp.message || "Lỗi từ hệ thống VATIN";
            var finalMsg = originalMsg;
            var lowerMsg = originalMsg.toLowerCase();
            var currentErrorType = "GENERAL_ERROR";

            if (lowerMsg.indexOf("không toàn vẹn") !== -1 || lowerMsg.indexOf("chỉnh sửa") !== -1) {
                finalMsg = "File XML không toàn vẹn.";
                currentErrorType = "INCOMPLETE";
            } else if (lowerMsg.indexOf("chữ ký số") !== -1) {
                finalMsg = "File XML lỗi chữ ký số";
                currentErrorType = "SIGNATURE_ERROR";
            }

            allMappedInvoices.push({
                _isApiError: true,
                message: finalMsg,
                errorType: currentErrorType,
                fileName: fileDetail.fileName || "unknown_file"
            });
            continue;
        }

        // Xử lý dữ liệu hóa đơn thành công
        if (resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
            var invoiceList = resp.data;

            for (var j = 0; j < invoiceList.length; j++) {
                var item = invoiceList[j];

                // 1. Map danh sách hàng hóa
                var goods = [];
                
                if (item.items && Array.isArray(item.items)) {
                    for (var k = 0; k < item.items.length; k++) {
                        var g = item.items[k];
                        goods.push({
                            'quantity': Number(g.sLuong || 0),
                            'tax.rate': g.tSuat || null,
                            'unit.price': Number(g.dGia || 0),
                            'amount.after.tax': Number(g.thTien || 0),
                            'discount.amount': Number(g.stCKhau || 0),
                            'unit': g.dvTinh || null,
                            'product.name': g.thhDVu || null,
                 
                            'license.plate': g.bksPTVChuyen || '',
                            'engine.number': String(g.sMay || ''),
                            'chassis.number': String(g.sKhung || ''),
                            'order': null
                        });
                    }
                }
                var fees = [];
                
                if (item.fees && Array.isArray(item.fees)) {
                    for (var f = 0; f < item.fees.length; f++) {
                        var fee = item.fees[f];
                
                        fees.push({
                            'fee.name': fee.tLPhi || null,
                            'fee.amount': Number(fee.tPhi || 0)
                        });
                    }
                }
                var totalFeeAmount = 0;

                for (var x = 0; x < fees.length; x++) {
                    totalFeeAmount += Number(fees[x]['fee.amount'] || 0);
                }
                // 2. Map thông tin hóa đơn
                var invoiceData = {
                    'id': null,
                    'ogl.id': item.id || "",
                    'fileName': fileDetail.fileName || "",
                    'tax.authority.code': item.mcCQT || null,
                    'invoice.name': item.tHDon || null,
                    'invoice.pattern': item.khmshdonTTchung || null,
                    'invoice.serial': item.khhdonTTchung || null,
                    'invoice.number': String(item.soHDonTTchung || ''),
                    'invoice.date': item.nlapTTchung || null,
                    'invoice.type': item.lHDon || null,
                    'seller.tax.code': item.mstNBan || null,
                    'seller.name': item.tenNBan || null,
                    'seller.address': item.dchiNBan || null,
                    'seller.phone': item.sdThoai || null,
                    'seller.account.number': item.stkNHang || null,
                    'seller.bank.name': item.tNHang || null,
                    'seller.signed.at': item.signingTime || null,
                    'buyer.name': item.tenNMua || null,
                    'buyer.tax.code': item.mstNMua || null,
                    'buyer.address': item.dchiNMua || null,
                    'buyer.phone': null,
                    'payment.method': item.htTToan || null,
                    'currency': item.dvTTe || null,
                    'exchange.rate': Number(item.tGia || 0),
                    'statement.number': item.sbKe || null,
                    'statement.date': item.nbKe || null,
                    'total.before.tax': Number(item.tgTCThue || 0),
                    'total.tax': Number(item.tgTThue || 0),
                    'total.discount.amount': Number(item.ttckTMai || 0),
                    'grand.total': Number(item.tgTTTBSo || 0),
                    'process.type': item.tcHDon || null,
                    'accounting.status': null,
                    'lookup.status': null,
                    'last.lookup.date': null,
                    'last.lookup.by': null,
                    'request.id': null,
                    'lookup.priority.level': null,
                    'last.lookup.image.id': null,
                    'ecm.doc.id': item.documentId || null,
                    'check.priority.level': priorityLevel,
                    'note': null,
                    'created.at': null,
                    // User thật lấy từ FE/NextJS, không dùng user service account REST.
                    'created.by': currentUser || null,
                    'operator': currentUser || null,
                    'last.check.by': currentUser || null,
                    'branch.code': branchCode || null,
                    'unit.lv1': unitLv1 || null,
                    'unit.lv2': unitLv2 || null,
                    'unit.lv3': unitLv3 || null,
                    'fees': fees,
                    'total.fee.amount': totalFeeAmount,
                    'goods': goods,
                    'related.invoice.type' : item.lhdCLQuan || null,
                    'related.invoice.number' : item.soHDonTTHDLQuan || null,
                    'related.invoice.serial' : item.khhdonTTHDLQuan || null,
                    'related.invoice.pattern' : item.khmshdonTTHDLQuan || null,
                    'related.invoice.date' : item.nlapTTHDLQuan || null,
                    'related.seller.tax.code' : item.mstNBan || null,
                    'related.statement.number' : item.sbkCLQuan || null,
                    'related.statement.date' : item.nbkCLQuan || null,
                };

                allMappedInvoices.push(invoiceData);
            }
        } else {
            allMappedInvoices.push({
                _isApiError: true,
                message: "Dữ liệu hóa đơn trống hoặc không hợp lệ",
                fileName: fileDetail.fileName || "unknown_file"
            });
        }
    }

    return allMappedInvoices;
}


function addInvoice(fileInput) {
    try {
        var rawData = fileInput['queryString'] || fileInput['details'];
        if (!rawData) {
            return { success: false, message: "Lỗi: Không tìm thấy trường chứa dữ liệu hóa đơn (queryString/details)." };
        }

        var parsedData = JSON.parse(rawData);
        var invoiceArray = Array.isArray(parsedData) ? parsedData : [parsedData];
        var results = [];
        var dbAmountMap = {};
        var memoryProgressMap = {};

        // ==================== VÒNG LẶP XỬ LÝ TỪNG HÓA ĐƠN ====================
        for (var idx = 0; idx < invoiceArray.length; idx++) {
            var queryObj = invoiceArray[idx];

            if (queryObj._isApiError) {
                results.push({
                    success: false,
                    message: queryObj.message,
                    ReturnCode: 1,
                    Messages: [queryObj.message],
                    status: "error",
                    errorType: queryObj.errorType || "API_ERROR",
                    fileName: queryObj.fileName
                });
                continue;
            }

            var itemsArray = queryObj['goods'] || [];
            if (!Array.isArray(itemsArray)) {
                results.push({
                    success: false,
                    message: "Hóa đơn thứ " + (idx + 1) + ": Dữ liệu 'goods' không đúng định dạng Array.",
                    ReturnCode: 1,
                    Messages: ["Dữ liệu 'goods' không đúng định dạng Array."],
                    status: "error",
                    errorType: "INVALID_FORMAT",
                    fileName: queryObj.fileName
                });
                continue;
            }

//            var limitWarningMsg = get5MillionLimitStatus(queryObj, dbAmountMap, memoryProgressMap);
            var checkStatus = 'DangKiemTra';
//            if (limitWarningMsg && typeof limitWarningMsg === "object" && limitWarningMsg.checkStatus) {
//                checkStatus = limitWarningMsg.checkStatus;
//            }

            // 1. Sinh ID tự động
            var processType = queryObj['process.type'] || fileInput['process.type'];
            var invoiceId = generateInvoiceId(processType);

            // =================================================================
            // XỬ LÝ LOGIC PARENT - CHILD
            // =================================================================
            var isAdjustment = (["1", "2", "3", "4"].indexOf(String(processType)) !== -1);
            var isOriginal = !isAdjustment;
            var parentIdToSave = null;
            var shouldSaveRelated = false;

            if (isAdjustment) {
                // Upload hóa đơn điều chỉnh: Tiến hành đối chiếu 5 trường tìm hóa đơn gốc
                var parentTaxCode = queryObj['related.seller.tax.code'];
                var parentPattern = queryObj['related.invoice.pattern'];
                var parentSerial = queryObj['related.invoice.serial'];
                var parentNumber = queryObj['related.invoice.number'];
                var parentDateRange = lib.ESD_HTKT_Utils.getDateRangeForQuery(queryObj['related.invoice.date']);

                if (parentPattern && parentSerial && parentNumber && parentDateRange) {
                    var findParentQuery = "seller.tax.code=\"" + parentTaxCode + "\" " +
                        "and invoice.pattern=\"" + parentPattern + "\" " +
                        "and invoice.serial=\"" + parentSerial + "\" " +
                        "and invoice.number=\"" + parentNumber + "\" " +
                        "and invoice.date >= '" + parentDateRange.startDateStr + "' " +
                        "and invoice.date <= '" + parentDateRange.endDateStr + "'";

                    var fParent = new SCFile("esdHTKTinvoice");
                    if (fParent.doSelect(findParentQuery) === RC_SUCCESS) {
                        // Trùng: Lấy id của hóa đơn gốc và không cần lưu bảng relate (TH1)
                        parentIdToSave = fParent['id'];
                    } else {
                        // Không trùng: Phải lưu xuống 2 bảng relate và invoice (TH2 lúc chưa có hóa đơn gốc)
                        shouldSaveRelated = true;
                    }
                } else {
                    shouldSaveRelated = true;
                }
                
               queryObj['parent.id'] = parentIdToSave;

            } else {
                queryObj['parent.id'] = null;
            }
            
            var validation = validateInvoiceData(queryObj, itemsArray);
            if (!validation.isValid) {
                results.push({
                    success: false,
                    message: validation.message || "Dữ liệu không hợp lệ",
                    ReturnCode: validation.ReturnCode,
                    Messages: validation.Messages,
                    status: validation.status,
                    errorType: validation.errorType,
                    fileName: queryObj.fileName
                });
                continue;
            }

            // 2. Khởi tạo và Lưu dữ liệu vào bảng Master
            var invoiceRec = new SCFile("esdHTKTinvoice");
            mapInvoiceMaster(invoiceRec, queryObj, invoiceId, processType, fileInput, checkStatus);

            var masterResult = invoiceRec.doInsert();
            if (masterResult !== RC_SUCCESS) {
                results.push({
                    success: false,
                    message: "Lỗi lưu bảng hóa đơn master ở hóa đơn thứ " + (idx + 1) + ". Mã lỗi: " + RCtoString(masterResult),
                    ReturnCode: 1,
                    Messages: ["Lỗi lưu bảng hóa đơn master (esdHTKTinvoice) ở hóa đơn thứ " + (idx + 1)],
                    status: "error",
                    errorType: "DB_ERROR",
                    fileName: queryObj.fileName
                });
                continue;
            }

            // 3. Vòng lặp duyệt mảng 'goods' lưu vào bảng Detail
            var savedItemsCount = 0;
            var savedItemIds = [];

            for (var i = 0; i < itemsArray.length; i++) {
                var currentItemId = nextId1("esdHTKTinvoiceItem");
                var itemRec = new SCFile("esdHTKTinvoiceItem");
                mapInvoiceItem(itemRec, itemsArray[i], invoiceId, i, currentItemId);

                var detailResult = itemRec.doInsert();
                if (detailResult === RC_SUCCESS) {
                    savedItemsCount++;
                    savedItemIds.push(itemRec['id']);
                }
            }

            // 4. Khởi tạo và Lưu dữ liệu vào bảng esdHTKTinvoiceRelated (Chỉ lưu khi cần thiết)
            if (isAdjustment && shouldSaveRelated) {
                var relatedId = nextId1("esdHTKTinvoiceRelated");
                var invoiceRelated = new SCFile("esdHTKTinvoiceRelated");

                mapInvoiceRelated(invoiceRelated, queryObj, invoiceId, relatedId);
                var relatedResult = invoiceRelated.doInsert();
            }

            // =================================================================
            // QUÉT NGƯỢC TỪ BẢNG RELATE KHI UPLOAD HÓA ĐƠN GỐC (TH2)
            // =================================================================
            if (isOriginal && masterResult === RC_SUCCESS) {
                var myTaxCode = queryObj['seller.tax.code'];
                var myPattern = queryObj['invoice.pattern'];
                var mySerial = queryObj['invoice.serial'];
                var myNumber = queryObj['invoice.number'];
                var myDateRange = lib.ESD_HTKT_Utils.getDateRangeForQuery(queryObj['invoice.date']);

                if (myPattern && mySerial && myNumber && myDateRange) {
                    var findRelatedQuery = "parent.seller.tax.code=\"" + myTaxCode + "\" " +
                        "and parent.invoice.pattern=\"" + myPattern + "\" " +
                        "and parent.invoice.serial=\"" + mySerial + "\" " +
                        "and parent.invoice.number=\"" + myNumber + "\" " +
                        "and parent.invoice.date >= '" + myDateRange.startDateStr + "' " +
                        "and parent.invoice.date <= '" + myDateRange.endDateStr + "'";
                    var fRelated = new SCFile("esdHTKTinvoiceRelated");
                    var rcRel = fRelated.doSelect(findRelatedQuery);
                    var relatedIdsToDelete = [];

                    // Tìm tất cả các hóa đơn điều chỉnh liên quan
                    while (rcRel === RC_SUCCESS) {
                        var childInvoiceId = fRelated['invoice.id'];
                        relatedIdsToDelete.push(fRelated['id']); // Gom id relate để xóa một lần cho an toàn cursor

                        // Cập nhật parent_id vào hóa đơn điều chỉnh
                        var fChild = new SCFile("esdHTKTinvoice");
                        if (fChild.doSelect("id=\"" + childInvoiceId + "\"") === RC_SUCCESS) {
                            fChild['parent.id'] = invoiceId;
                            fChild.doUpdate();
                        }
                        rcRel = fRelated.getNext();
                    }

                    // Xóa hết thông tin bảng relate trùng với hóa đơn gốc
                    for (var r = 0; r < relatedIdsToDelete.length; r++) {
                        var fDel = new SCFile("esdHTKTinvoiceRelated");
                        if (fDel.doSelect("id=\"" + relatedIdsToDelete[r] + "\"") === RC_SUCCESS) {
                            fDel.doDelete();
                        }
                    }
                }
            }

            // 5. Khởi tạo và Lưu dữ liệu vào bảng esdHTKTinvoiceFee
            var feeArray = queryObj['fees'] || [];
            for (var f = 0; f < feeArray.length; f++) {
                var feeId = nextId1("esdHTKTinvoiceFee");
                var invoiceFee = new SCFile("esdHTKTinvoiceFee");
                mapInvoiceFee(invoiceFee, feeArray[f], invoiceId, feeId);
                invoiceFee.doInsert();
            }

            // 6. Lưu lịch sử
            var currentUser = queryObj['created.by'] || queryObj['operator'] || queryObj['last.check.by'] || fileInput['currentUser'] || vars["$lo.contact.name"] || vars["$lo.user.name"] || null;
            var invoiceName = queryObj['invoice.name'] || "";
            var descriptionMsg = "Đã upload hóa đơn: " + invoiceName;
            
        lib.ESD_HTKT_SCHEDULE_OGL.triggerNextQueueEvent();
            createActivity('activityHTKTinvoice', descriptionMsg, invoiceId, 'Upload Hóa Đơn', currentUser);              

            results.push({
                success: true,
                message: "Lưu thông tin hóa đơn thành công!",
                invoiceId: invoiceId,
                totalItemsExpected: itemsArray.length,
                totalItemsSaved: savedItemsCount,
                itemIds: savedItemIds,
                status: "success",
                fileName: queryObj.fileName
            });
        }
        
        
        // ==================== KẾT THÚC VÒNG LẶP ====================

        return {
            success: true,
            totalProcessed: invoiceArray.length,
            details: results
        };

    } catch (err) {
        return { success: false, message: "Lỗi hệ thống trong hàm addInvoice: " + err.toString() };
    }
}


/**
 * Hàm sinh ID tự tăng - Đã chuẩn hóa cú pháp toán tử và cơ chế sắp xếp giảm dần của Service Manager
 */
function generateInvoiceId(processType) {
    var docType = "IV";
    if (processType === "IVDC" || processType === "2") {
        docType = "IVDC";
    } else if (processType === "IVTT" || processType === "3") {
        docType = "IVTT";
    }

    var currentYear = new Date().getFullYear().toString();
    var prefix = docType + currentYear; // Ví dụ: "IVDC2026"
    var lastSequence = 0;

    var maxInvoice = new SCFile("esdHTKTinvoice");

    // Sử dụng toán tử 'like' chuẩn kết hợp dấu vãng lai '*' của Service Manager
    var sqlFindMax = "id like \"" + prefix + "*\"";

    // Cú pháp setOrderBy chuẩn của SM API: (tên_trường, kiểu_sắp_xếp) -> 1 là giảm dần (DSC), 0 là tăng dần (ASC)
    maxInvoice.setOrderBy(["id"], [1]);

    var findRc = maxInvoice.doSelect(sqlFindMax);

    // Vì đã sắp xếp giảm dần (Mã mới nhất/lớn nhất nằm trên cùng), ta chỉ cần đọc bản ghi đầu tiên
    if (findRc === RC_SUCCESS) {
        var currentId = maxInvoice['id'];
        if (currentId && currentId.length > prefix.length) {
            var seqStr = currentId.substring(prefix.length);
            var seqNum = parseInt(seqStr, 10);
            if (!isNaN(seqNum)) {
                lastSequence = seqNum;
            }
        }
    }

    // Tăng số thứ tự tiếp theo lên 1 đơn vị
    var nextSequence = lastSequence + 1;
    var seqStrWithPadding = nextSequence.toString();
    while (seqStrWithPadding.length < 7) {
        seqStrWithPadding = "0" + seqStrWithPadding;
    }

    return prefix + seqStrWithPadding;
}

/**
 * Hàm mapped dữ liệu Master Invoice (esdHTKTinvoice)
 */
function mapInvoiceMaster(invoiceRec, queryObj, invoiceId, processType, fileInput, checkStatus) {
    invoiceRec['id'] = invoiceId;
    invoiceRec['invoice.name'] = queryObj['invoice.name'];
    invoiceRec['invoice.number'] = queryObj['invoice.number'];
    invoiceRec['invoice.serial'] = queryObj['invoice.serial'];
    invoiceRec['invoice.pattern'] = queryObj['invoice.pattern'];
    invoiceRec['invoice.type'] = queryObj['invoice.type'];
    invoiceRec['tax.authority.code'] = queryObj['tax.authority.code'];
    invoiceRec['statement.number'] = queryObj['statement.number'];
    invoiceRec['note'] = queryObj['note'];

    if (queryObj['invoice.date']) {
        invoiceRec['invoice.date'] = siceConvertDate(queryObj['invoice.date']);
    }
    if (queryObj['seller.signed.at']) {
        invoiceRec['seller.signed.at'] = siceConvertDate(queryObj['seller.signed.at']);
    }
    if (queryObj['statement.date']) {
        invoiceRec['statement.date'] = siceConvertDate(queryObj['statement.date']);
    }

    invoiceRec['seller.name'] = queryObj['seller.name'];
    invoiceRec['seller.tax.code'] = queryObj['seller.tax.code'];
    invoiceRec['seller.address'] = queryObj['seller.address'];
    invoiceRec['seller.phone'] = queryObj['seller.phone'];
    invoiceRec['seller.account.number'] = queryObj['seller.account.number'];
    invoiceRec['seller.bank.name'] = queryObj['seller.bank.name'];

    invoiceRec['buyer.name'] = queryObj['buyer.name'];
    invoiceRec['buyer.tax.code'] = queryObj['buyer.tax.code'];
    invoiceRec['buyer.address'] = queryObj['buyer.address'];
    invoiceRec['buyer.phone'] = queryObj['buyer.phone'];

    invoiceRec['payment.method'] = queryObj['payment.method'];
    invoiceRec['currency'] = queryObj['currency'] || "VND";
    invoiceRec['exchange.rate'] = queryObj['exchange.rate'] ? parseFloat(queryObj['exchange.rate']) : 1;

    invoiceRec['total.fee.amount'] = queryObj['total.fee.amount'] ? parseFloat(queryObj['total.fee.amount']) : 0;
    invoiceRec['total.before.tax'] = queryObj['total.before.tax'] ? parseFloat(queryObj['total.before.tax']) : 0;
    invoiceRec['total.tax'] = queryObj['total.tax'] ? parseFloat(queryObj['total.tax']) : 0;
    invoiceRec['total.discount.amount'] = queryObj['total.discount.amount'] ? parseFloat(queryObj['total.discount.amount']) : 0;
    invoiceRec['grand.total'] = queryObj['grand.total'] ? parseFloat(queryObj['grand.total']) : 0;

    invoiceRec['process.type'] = processType;
    invoiceRec['accounting.status'] = queryObj['accounting.status'] || "PENDING";
    invoiceRec['created.at'] = new Date();
    
    var uploadUser = queryObj['created.by'] || queryObj['operator'] || queryObj['last.check.by'] || fileInput['currentUser'] || vars["$lo.contact.name"] || vars["$lo.user.name"] || "SYSTEM";
    invoiceRec['created.by'] = uploadUser;
    invoiceRec['operator'] = queryObj['operator'] || uploadUser;
    invoiceRec['last.check.by'] = queryObj['last.check.by'] || uploadUser;
    invoiceRec['branch.code'] = queryObj['branch.code'] || fileInput['branchCode'] || "";

    // [HTKT][UNIT_SCOPE] Ghi thêm đơn vị của người upload để phục vụ phân quyền dữ liệu theo scope.
    // Chuẩn hóa theo phạm vi dữ liệu của người upload:
    // - Scope Khối/CN/ĐVSN: chỉ lưu unit.lv1, clear unit.lv2/unit.lv3.
    // - Scope Phòng/Trung tâm: lưu unit.lv1 + unit.lv2, clear unit.lv3.
    // - Scope Cá nhân: lưu đủ unit theo contact để cấp trên nhìn thấy.
    var uploadUserUnitInfo = getContactUnitInfo(uploadUser);
    var normalizedMasterUnitInfo = normalizeHTKTInvoiceUnitsByUploaderScope(
        uploadUser,
        uploadUserUnitInfo,
        queryObj['unit.lv1'] || fileInput['unit.lv1'] || fileInput['unitLv1'] || "",
        queryObj['unit.lv2'] || fileInput['unit.lv2'] || fileInput['unitLv2'] || "",
        queryObj['unit.lv3'] || fileInput['unit.lv3'] || fileInput['unitLv3'] || ""
    );

    var unitLv1ToSave = normalizedMasterUnitInfo.lv1 || "";
    var unitLv2ToSave = normalizedMasterUnitInfo.lv2 || "";
    var unitLv3ToSave = normalizedMasterUnitInfo.lv3 || "";

    invoiceRec['unit.lv1'] = unitLv1ToSave;
    invoiceRec['unit.lv2'] = unitLv2ToSave;
    invoiceRec['unit.lv3'] = unitLv3ToSave;

    print(
        "[HTKT][SM_UPLOAD][MAP_MASTER_UNIT] invoiceId=" + invoiceId +
        " | uploadUser=" + uploadUser +
        " | scope=" + normalizedMasterUnitInfo.scope +
        " | unit.lv1=" + unitLv1ToSave +
        " | unit.lv2=" + unitLv2ToSave +
        " | unit.lv3=" + unitLv3ToSave
    );
    
    invoiceRec['check.status'] = checkStatus || "DangKiemTra";
    invoiceRec['job.status'] = "CHECKING";
    invoiceRec['ogl.id'] = queryObj['ogl.id'];
    invoiceRec['check.priority.level'] = parseFloat(queryObj['check.priority.level']);
    invoiceRec['ecm.doc.id'] = queryObj['ecm.doc.id'];
    invoiceRec["last.check.date"] = new Date();
    invoiceRec['parent.id'] = queryObj['parent.id'];
    invoiceRec['parent.invoice.number'] = queryObj['related.invoice.number'];
}

/**
 * Hàm mapped dữ liệu lien quan (esdHTKTinvoiceRelated)
 */

function mapInvoiceRelated(itemRec, itemData, invoiceId, relatedId) {
        itemRec['id'] = relatedId;

    itemRec['invoice.id'] = invoiceId;

    itemRec['parent.invoice.type'] =
        itemData['related.invoice.type'] || '';

    itemRec['parent.invoice.number'] =
        itemData['related.invoice.number'] || '';

    itemRec['parent.invoice.serial'] =
        itemData['related.invoice.serial'] || '';

    itemRec['parent.invoice.pattern'] =
        itemData['related.invoice.pattern'] || '';

    if (itemData['related.invoice.date']) {
        itemRec['parent.invoice.date'] =
            siceConvertDate(itemData['related.invoice.date']);
    }

    itemRec['parent.statement.number'] =
        itemData['related.statement.number'] || '';

    if (itemData['related.statement.date']) {
        itemRec['parent.statement.date'] =
            siceConvertDate(itemData['related.statement.date']);
    }
    itemRec['parent.seller.tax.code'] =
        itemData['related.seller.tax.code'] || '';
}

/**
 * Hàm mapped dữ liệu lien quan (esdHTKTinvoiceFee)
 */

function mapInvoiceFee(itemRec, feeData, invoiceId, feeId) {

    itemRec['id'] = feeId;
    itemRec['invoice.id'] = invoiceId;

    itemRec['fee.name'] = feeData['fee.name'] || "";

    itemRec['fee.amount'] = feeData['fee.amount']
        ? parseFloat(feeData['fee.amount'])
        : 0;
}

/**
 * Hàm mapped dữ liệu chi tiết mặt hàng (esdHTKTinvoiceItem)
 */
function mapInvoiceItem(itemRec, itemData, invoiceId, index, currentItemId) {

    itemRec['id'] = currentItemId;
    itemRec['invoice.id'] = invoiceId;
    itemRec['order'] = itemData['order'] ? parseFloat(itemData['order']) : (index + 1);
    itemRec['product.name'] = itemData['product.name'] || "";
    itemRec['unit'] = itemData['unit'] || "";
    itemRec['ogl.id'] = itemData['ogl.id'] || "";
    itemRec['license.plate'] = itemData['license.plate'] || "";
    itemRec['engine.number'] = itemData['engine.number'] || "";
    itemRec['chassis.number'] = itemData['chassis.number'] || "";

    itemRec['quantity'] = itemData['quantity'] ? parseFloat(itemData['quantity']) : 0;
    itemRec['unit.price'] = itemData['unit.price'] ? parseFloat(itemData['unit.price']) : 0;
    itemRec['discount.amount'] = itemData['discount.amount'] ? parseFloat(itemData['discount.amount']) : 0;
    itemRec['tax.rate'] = itemData['tax.rate'] ? parseFloat(itemData['tax.rate']) : 0;
    itemRec['amount.after.tax'] = itemData['amount.after.tax'] ? parseFloat(itemData['amount.after.tax']) : 0;
}

function validateInvoiceData(queryObj, itemsArray) {
    var rawDate = queryObj['invoice.date'];
    
    var dateRange = lib.ESD_HTKT_Utils.getDateRangeForQuery(rawDate);

    if (!dateRange || !dateRange.startDateStr || !dateRange.endDateStr) {
        return { isValid: false, ReturnCode: 1, Messages: ["Lỗi định dạng ngày"], status: "error", errorType: "INVALID_DATE" };
    }

    var fCheck = new SCFile("esdHTKTinvoice");
    var dupQuery = "seller.tax.code=\"" + queryObj['seller.tax.code'] + "\" " +
        "and invoice.pattern=\"" + queryObj['invoice.pattern'] + "\" " +
        "and invoice.serial=\"" + queryObj['invoice.serial'] + "\" " +
        "and invoice.number=\"" + queryObj['invoice.number'] + "\" " +
        "and invoice.date >= '" + dateRange.startDateStr + "' " +
        "and invoice.date <= '" + dateRange.endDateStr + "'";

    var rc = fCheck.doSelect(dupQuery);
    if (rc === RC_SUCCESS) {
        var duplicateMsg = "Hóa đơn trùng ID hóa đơn: " + fCheck['id'] + " - Người Upload: " + (fCheck['created.by'] || "Không xác định");
        return { isValid: false, ReturnCode: 1, Messages: [duplicateMsg], message: duplicateMsg, status: "error", errorType: "DUPLICATE" };
    }

    return { isValid: true };
}
function siceConvertDate(dateStr) {
    if (!dateStr) return null;

    if (typeof dateStr === "string" && dateStr.length === 10 && dateStr.indexOf("-") !== -1) {
        var parts = dateStr.split("-");
        var year = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10) - 1; // Trong JS, tháng bắt đầu từ 0 (0 = Tháng 1, 11 = Tháng 12)
        var day = parseInt(parts[2], 10);
        
        // Khởi tạo ngày theo múi giờ Local (Việt Nam)
        var localDate = new Date(year, month, day);
        return isNaN(localDate.getTime()) ? null : localDate;
    }

    // Xử lý cho các định dạng ngày tháng khác (có chứa giờ/phút/giây)
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Hàm gọi API kiểm tra hóa đơn của nhà cung cấp trên 5 triệu
 * Trả về: errorCode từ API nếu thành công (ví dụ: "00"), hoặc mã lỗi hệ thống nếu thất bại
 */
function check5Tr(queryObj, totalAmountInDb) {
    try {

        // 2. Tạo object payload đơn lẻ
        var singlePayload = {
            "id": String(queryObj["id"] || ""),
            "invoiceDate": queryObj["invoice.date"],
            "mst": String(queryObj["seller.tax.code"] || ""),
            "totalAmount": Number(totalAmountInDb || 0),
            "currency": String(queryObj["currency"] || "VND"),
            "exchangeRate": Number(queryObj["exchange.rate"] || 1)
        };

        // 3. Bọc object vào mảng theo đúng yêu cầu tham số của hàm checkAmount
        var checkAmountList = [singlePayload];

        // 4. Gọi hàm hệ thống checkAmount để thực hiện API request
        var responseObj = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.checkAmount(checkAmountList);

        // 5. Kiểm tra và phân tích kết quả trả về
        if (!responseObj) {
            return "API_FAILED"; 
        }

        // Kiểm tra cấu trúc JSON response từ API trả về thông qua hàm hệ thống
        if (responseObj.success === true && responseObj.data && responseObj.data.errors) {
            var errorsArray = responseObj.data.errors;

            if (errorsArray.length > 0) {
                return String(errorsArray[0].errorCode);
            }
            
            
        }

        return "BAD_JSON_STRUCTURE";

    } catch (e) {
        return "API_ERROR";
    }
}
/**
 * Hàm kiểm tra tổng tiền và trả về thông tin cảnh báo (Không chặn lưu nữa)
 * @returns {Object|string} Đối tượng thông tin cảnh báo trạng thái hạn mức hoặc chuỗi lỗi
 */
function get5MillionLimitStatus(queryObj) {
    try {
        var taxCode = String(queryObj["seller.tax.code"] || "");
        var currentAmount = Number(queryObj["grand.total"] || 0);
        var invDate = queryObj["invoice.date"];

        if (!taxCode || !invDate) return "Thống kê hạn mức bỏ qua do thiếu thông tin đầu vào (Tax Code/Date).";

        var dateRange = lib.ESD_HTKT_Utils.getDateRangeForQuery(invDate);

        // Kiểm tra nếu hàm utils trả về kết quả hợp lệ hoặc bị lỗi định dạng
        if (dateRange === null || !dateRange.startDateStr) {
            return "Lỗi xử lý định dạng ngày tháng đầu vào.";
        }

        // Bốc đầu ngày và cuối ngày ra để dùng
        var strStartDate = dateRange.startDateStr;
        var strEndDate = dateRange.endDateStr;

        // --- THỰC HIỆN TRUY VẤN THEO KHOẢNG ---
        var f = new SCFile("esdHTKTinvoice");
        var query = "seller.tax.code=\"" + taxCode + "\" " +
            "and invoice.date >= '" + strStartDate + "' " +
            "and invoice.date <= '" + strEndDate + "'";

        var totalAmountInDb = 0;
        var rc = f.doSelect(query);

        while (rc == RC_SUCCESS) {

            totalAmountInDb += Number(f["grand.total"] || 0);
            rc = f.getNext();
        }

        var finalTotalAmount = totalAmountInDb + currentAmount;

        // Cấu trúc message mặc định theo yêu cầu của bạn
        var warningMessage = "Hóa đơn từ 05 triệu trở lên hoặc Tổng trong ngày của 01 NCC từ 05 triệu trở lên phải có chứng từ thanh toán không dùng tiền mặt";

        // 5. Kiểm tra hạn mức 5 triệu
        if (finalTotalAmount > 5000000) {
            return {
                message: warningMessage,
                checkStatus: "E06"
            };

        } else {
            var apiResult = check5Tr(queryObj, finalTotalAmount);


            // SỬA ĐỔI CHÍNH: Kiểm tra xem kết quả trả về có đúng là Object và có chứa errorCode không
            if (apiResult && typeof apiResult === "object" && apiResult.errorCode !== undefined) {
                return {
                    message: warningMessage,
                    checkStatus: apiResult.errorCode
                };
            } else {
                return {
                    message: warningMessage,
                    checkStatus: "E99"
                };
            }

        }

    } catch (e) {
        return "Lỗi tính toán hạn mức: " + e.toString();
    }
}

function nextId1(name) {
    var nextNumber = new SCDatum();
    funcs.rtecall("getnumber", 1, nextNumber, name);
    return nextNumber;
}