// ScriptLibrary: ESD_ECM_API
// Version: 2.0.0
// ECM operations: upload, download by DOC_ID, download by OBJECT_ID, delete

//uat
//var CONFIG_ECM = lib.ESD_ENV_CONFIG.esdEcmService();
//var CONFIG_ECM_ACTIONS = lib.ESD_ENV_CONFIG.esdActionsIntegrationsHD();

var CONFIG_ECM = lib.ESD_ENV_CONFIG_EXAMPLE.esdEcmService();
var CONFIG_ECM_ACTIONS = lib.ESD_ENV_CONFIG_EXAMPLE.esdActionsIntegrationsHD();

var ECM_BASE_URL = CONFIG_ECM && CONFIG_ECM.BASE_URL ? String(CONFIG_ECM.BASE_URL) : "";
var ECM_AUTHORIZATION = CONFIG_ECM && CONFIG_ECM.AUTHORIZATION ? String(CONFIG_ECM.AUTHORIZATION) : "";
var ECM_USER_ID = CONFIG_ECM && CONFIG_ECM.USER_ID ? String(CONFIG_ECM.USER_ID) : "";

var ECM_APP_ID = CONFIG_ECM_ACTIONS && CONFIG_ECM_ACTIONS.ECM_APP_ID ? String(CONFIG_ECM_ACTIONS.ECM_APP_ID) : "";
var ECM_SESSION_ID = CONFIG_ECM_ACTIONS && CONFIG_ECM_ACTIONS.ECM_SESSION_ID ? String(CONFIG_ECM_ACTIONS.ECM_SESSION_ID) : "";
var ECM_SOURCE_ID = CONFIG_ECM_ACTIONS && CONFIG_ECM_ACTIONS.ECM_SOURCE_ID ? String(CONFIG_ECM_ACTIONS.ECM_SOURCE_ID) : "";

var config = {
    URL: {
        DOCUMENT: ECM_BASE_URL + "/CDM/service/document"
    }
};

/**
 * Build HTTP headers dùng chung khi gọi ECM
 */
function buildHeaders() {
    var headers = [];
    headers.push(new Header("Content-Type", "application/json"));

    if (ECM_AUTHORIZATION) {
        headers.push(new Header("Authorization", ECM_AUTHORIZATION));
    }

    return headers;
}

/**
 * Build endpoint ECM
 */
function buildDocumentUrl(action) {
    var url = config.URL.DOCUMENT + "/" + action;
    if (ECM_USER_ID) {
        url += "?userid=" + encodeURIComponent(ECM_USER_ID);
    }
    return url;
}

/**
 * Parse JSON an toàn cho SM
 */
function parseEcmResponse(response) {
    if (response == null) return null;
    if (typeof response === "object") return response;

    var responseStr = String(response);
    try {
        return JSON.parse(responseStr);
    } catch (e1) {
        try {
            return rteJSONParse(responseStr);
        } catch (e2) {
            return { rawResponse: responseStr };
        }
    }
}

/**
 * Validate config tối thiểu trước khi gọi ECM
 */
function validateEcmConfig() {
    if (!ECM_BASE_URL) return { success: false, message: "Thiếu cấu hình ECM BASE_URL." };
    if (!ECM_AUTHORIZATION) return { success: false, message: "Thiếu cấu hình ECM AUTHORIZATION." };
    if (!ECM_APP_ID) return { success: false, message: "Thiếu cấu hình ECM APP_ID." };
    if (!ECM_SESSION_ID) return { success: false, message: "Thiếu cấu hình ECM SESSION_ID." };
    return { success: true };
}

/**
 * Upload file lên ECM
 */
function upload(filesArray) {
    var validateConfig = validateEcmConfig();
    if (!validateConfig.success) return validateConfig;

    if (!filesArray || !Array.isArray(filesArray) || filesArray.length === 0) {
        return { success: false, message: "Danh sách file upload trống." };
    }

    var url = buildDocumentUrl("upload");
    var finalPayload = [];

    for (var i = 0; i < filesArray.length; i++) {
        var fileInfo = filesArray[i] || {};

        if (!fileInfo.fileBytes) return { success: false, message: "File thứ " + (i + 1) + " không có fileBytes." };
        if (!fileInfo.fileName) return { success: false, message: "File thứ " + (i + 1) + " không có fileName." };

        finalPayload.push({
            "DOC_CAT": fileInfo.docCat || "File HTKT upload ECM",
            "DOC_NAME": fileInfo.docName || fileInfo.fileName,
            "CIF_NUM": fileInfo.cifNum || "",
            "ACC_NUM": fileInfo.accNum || "",
            "DOC_CREATED": fileInfo.docCreated || system.functions.tod(),
            "SOURCE_ID": fileInfo.sourceId || ECM_SOURCE_ID,
            "SESSION_ID": fileInfo.sessionId || ECM_SESSION_ID,
            "APP_ID": fileInfo.appId || ECM_APP_ID,
            "FILE_BYTES": fileInfo.fileBytes,
            "FILE_NAME": fileInfo.fileName,
            "SEQ": fileInfo.seq != null ? fileInfo.seq : (i + 1)
        });
    }

    var headers = buildHeaders();

    try {
        var respRaw = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(finalPayload), headers);
        var resp = parseEcmResponse(respRaw);

        if (resp && resp.Code && resp.Code !== "OK") {
            return {
                success: false,
                message: resp.Msg || "ECM trả về lỗi khi upload tài liệu.",
                data: resp
            };
        }

        return {
            success: true,
            message: "Upload tài liệu lên ECM thành công.",
            data: resp
        };
    } catch (e) {
        return {
            success: false,
            message: "Không thể upload tài liệu lên ECM.",
            error: e && e.message ? e.message : String(e),
            request: { url: url, payload: finalPayload }
        };
    }
}


/**
 * Download theo DOC_ID
 */
function downloadDocId(docIdsArray) {
    var validateConfig = validateEcmConfig();
    if (!validateConfig.success) return validateConfig;
    if (!docIdsArray) return { success: false, message: "Thiếu DOC_ID." };

    if (!Array.isArray(docIdsArray)) {
        docIdsArray = [docIdsArray];
    }

    if (docIdsArray.length === 0) {
        return { success: false, message: "Danh sách DOC_ID trống." };
    }

    var url = buildDocumentUrl("download");
    var payload = [];

    for (var i = 0; i < docIdsArray.length; i++) {
        var docId = docIdsArray[i];
        if (docId == null || String(docId).replace(/^\s+|\s+$/g, "") === "") continue;

        payload.push({
            "DOC_ID": String(docId),
            "APP_ID": ECM_APP_ID,
            "SESSION_ID": ECM_SESSION_ID
        });
    }

    if (payload.length === 0) {
        return { success: false, message: "Không có DOC_ID hợp lệ." };
    }

    var headers = buildHeaders();

    try {
        var respRaw = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(payload), headers);
        var resp = parseEcmResponse(respRaw);

        if (resp && resp.Code && resp.Code !== "OK") {
            return {
                success: false,
                message: resp.Msg || "ECM trả về lỗi khi tải tài liệu.",
                data: resp
            };
        }

        return {
            success: true,
            message: "Tải tài liệu từ ECM thành công.",
            data: resp
        };
    } catch (e) {
        return {
            success: false,
            message: "Lỗi hệ thống ECM khi download theo DOC_ID.",
            error: e && e.message ? e.message : String(e),
            request: { url: url, payload: payload }
        };
    }
}

/**
 * Download tài liệu theo DOC_OBJECTID
 */
function downloadObjectId(objectIdsArray) {
    var validateConfig = validateEcmConfig();
    if (!validateConfig.success) return validateConfig;
    if (!objectIdsArray) return { success: false, message: "Thiếu DOC_OBJECTID." };

    if (!Array.isArray(objectIdsArray)) {
        objectIdsArray = [objectIdsArray];
    }

    if (objectIdsArray.length === 0) {
        return { success: false, message: "Danh sách DOC_OBJECTID trống." };
    }

    var url = buildDocumentUrl("download");
    var payload = [];

    for (var i = 0; i < objectIdsArray.length; i++) {
        var objectId = objectIdsArray[i];
        if (objectId == null || String(objectId).replace(/^\s+|\s+$/g, "") === "") continue;

        payload.push({
            "DOC_OBJECTID": String(objectId),
            "APP_ID": ECM_APP_ID,
            "SESSION_ID": ECM_SESSION_ID
        });
    }

    if (payload.length === 0) {
        return { success: false, message: "Không có DOC_OBJECTID hợp lệ." };
    }

    var headers = buildHeaders();

    try {
        var respRaw = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(payload), headers);
        var resp = parseEcmResponse(respRaw);

        if (resp && resp.Code && resp.Code !== "OK") {
            return {
                success: false,
                message: resp.Msg || "ECM trả về lỗi khi tải tài liệu.",
                data: resp
            };
        }

        return {
            success: true,
            message: "Tải tài liệu từ ECM thành công.",
            data: resp
        };
    } catch (e) {
        return {
            success: false,
            message: "Lỗi hệ thống ECM khi download theo DOC_OBJECTID.",
            error: e && e.message ? e.message : String(e),
            request: { url: url, payload: payload }
        };
    }
}

/**
 * Delete tài liệu theo DOC_ID
 */
function deleteDocId(docId) {
    var validateConfig = validateEcmConfig();
    if (!validateConfig.success) return validateConfig;

    if (docId == null || String(docId).replace(/^\s+|\s+$/g, "") === "") {
        return { success: false, message: "Thiếu DOC_ID cần xóa." };
    }

    var url = buildDocumentUrl("delete");
    var payload = [{
        "DOC_ID": String(docId),
        "APP_ID": ECM_APP_ID,
        "SESSION_ID": ECM_SESSION_ID
    }];

    var headers = buildHeaders();

    try {
        var respRaw = lib.ESD_COMMON_HTTP.deleteJson(url, payload, headers);
        var resp = parseEcmResponse(respRaw);

        if (resp && resp.Code === "OK") {
            return {
                success: true,
                message: resp.Msg || "Xóa tài liệu trên ECM thành công.",
                data: resp
            };
        }

        return {
            success: false,
            message: resp && resp.Msg ? resp.Msg : "ECM trả về lỗi khi xóa tài liệu.",
            error: resp
        };
    } catch (e) {
        return {
            success: false,
            message: "Lỗi hệ thống SM khi xóa tài liệu ECM.",
            error: e && e.message ? e.message : String(e),
            request: { url: url, payload: payload }
        };
    }
}

/**
 * Delete V2 - Hàm legacy dùng sysExec + curl
 */
function deleteDocIdv2(docId) {
    var validateConfig = validateEcmConfig();
    if (!validateConfig.success) return validateConfig;

    if (docId == null || String(docId).replace(/^\s+|\s+$/g, "") === "") {
        return { success: false, message: "Thiếu DOC_ID cần xóa." };
    }

    var targetUrl = buildDocumentUrl("delete");
    var requestBody = [{
        "DOC_ID": String(docId),
        "APP_ID": ECM_APP_ID,
        "SESSION_ID": ECM_SESSION_ID
    }];

    var jsonStr = JSON.stringify(requestBody);
    var safeJsonStr = jsonStr.replace(/"/g, "\\\"");

    var command =
        "env -i " +
        "LD_LIBRARY_PATH=/usr/lib64:/lib64 " +
        "PATH=/usr/bin:/bin " +
        "curl -s -X DELETE '" + targetUrl + "' " +
        "-H 'Content-Type: application/json' " +
        "-H 'Accept: application/json' " +
        "-H 'Authorization: " + ECM_AUTHORIZATION + "' " +
        "-d '" + safeJsonStr + "'";

    try {
        var rawResult = sysExec(command);

        if (rawResult != null) {
            var rawResultStr = String(rawResult);
            var firstComma = rawResultStr.indexOf(",");
            var secondComma = rawResultStr.indexOf(",", firstComma + 1);
            var cleanJsonStr;

            if (firstComma >= 0 && secondComma >= 0) {
                cleanJsonStr = rawResultStr.substring(secondComma + 1);
            } else {
                cleanJsonStr = rawResultStr;
            }

            var resp = parseEcmResponse(cleanJsonStr);

            if (resp && (resp.Code === "OK" || resp.Code === "ORA")) {
                return {
                    success: true,
                    message: resp.Msg || "Xóa tài liệu trên ECM thành công.",
                    data: resp
                };
            }

            return {
                success: false,
                message: resp && resp.Msg ? resp.Msg : "Lỗi hệ thống ECM.",
                error: resp
            };
        }

        return {
            success: false,
            message: "Không nhận được phản hồi từ lệnh cURL.",
            error: "Lỗi hệ thống SM."
        };
    } catch (e) {
        return {
            success: false,
            message: "Lỗi hệ thống SM khi thực thi cURL.",
            error: e && e.message ? e.message : String(e)
        };
    }
}