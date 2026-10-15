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
            case 'getListReportPayment':
                var data = getListReportPayment(input);
                result = { success: true, data: data };
                break;
            case 'getListLiabilities':
                var data = getListLiabilities(input);
                result = { success: true, data: data };
                break;

                // danh sach nha cung cap
            case 'getListVendor':
                getListVendor(input);
                break;
                // danh sach nha cung cap
            case 'getListContract':
                getListContract(input);
                break;

            case 'saveReportHistory':
                saveReportHistoryAndSchedule(input);
                break;

            case 'getListReportHistory':
                getListReportHistory(input);
                break;
            case 'getListBranchTH':
                result = getListBranchTH(input);
                break;
                //---------------------------------------------
            case 'createReportHistory':
                var data = createReportHistory(input);
                result = { success: true, data: data };
                break;
            case 'uploadReportBase64':
                uploadReportBase64(input);
                break;
                //---------------------------------------------    
            default:
                result = { success: false, error: 'Hanh dong (name) khong hop le: ' + name };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}

//

/**
 * Chỉ phục vụ action getListBranchTH.
 *
 * Xác định chính xác một ps.code có phải LV1 hay không bằng field level
 * của esdQTorgUnit.
 *
 * Hệ thống thực tế có:
 * - lv1c: LV1 Trụ sở chính
 * - lv1d: LV1 Chi nhánh
 * - lv2c/lv2d...: cấp dưới
 *
 * Vì vậy chỉ cần kiểm tra level bắt đầu bằng "lv1".
 */
function isHTKTReportLv1Code(psCode) {
    var safeCode = String(psCode == null ? "" : psCode).trim();

    if (!safeCode) {
        return false;
    }

    var unitFile = null;

    try {
        unitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);

        var rc = unitFile.doSelect(
            'unit.id="' +
            safeCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
            '"'
        );

        if (rc != RC_SUCCESS) {
            return false;
        }

        var unitId = String(unitFile["unit.id"] || "").trim();
        var level = String(unitFile["level"] || "").trim().toLowerCase();

        return unitId === safeCode && level.indexOf("lv1") === 0;
    } catch (e) {
        print("[ERROR isHTKTReportLv1Code] " + e.toString());
        return false;
    } finally {
        if (unitFile) {
            try { unitFile.doClose(); } catch (eClose) {}
        }
    }
}

/**
 * Master LV1 cho combobox báo cáo.
 *
 * Nguồn:
 * - esdDMentity: ps.code, branch.name, entity.code, status
 * - esdQTorgUnit: xác định chính xác level của ps.code
 *
 * Rule:
 * - status = ACTIVE
 * - id có giá trị: lọc entity.code = id (QT_PQDL_04 + TSC)
 * - id rỗng: không giới hạn entity.code (QT_PQDL_06)
 * - DISTINCT theo ps.code
 * - chỉ trả record có level bắt đầu bằng "lv1" (lv1c/lv1d)
 */
//function getListBranchTH(input) {
//    var params = {};
//
//    try {
//        var rawData = input ? (input.queryString || input.details) : null;
//
//        if (rawData) {
//            params = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
//        }
//
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (eParse) {
//        return {
//            success: false,
//            error: "Du lieu dau vao khong hop le.",
//            data: [],
//            total: 0
//        };
//    }
//
//    var entityCode = String(params.id == null ? "" : params.id).trim();
//    var keyword = String(params.keyword == null ? "" : params.keyword).trim();
//    var psCodeFilter = String(params.psCode == null ? "" : params.psCode).trim();
//    var orderBy = String(params.orderBy == null ? "" : params.orderBy).trim();
//
//    var start = parseInt(params.start, 10) || 1;
//    var count = parseInt(params.count, 10) || 10;
//
//    if (start < 1) start = 1;
//    if (count < 1) count = 10;
//
//    var entityFile = null;
//    var rows = [];
//    var seen = {};
//
//    try {
//        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
//
//        var conditions = ['status="ACTIVE"'];
//
//        if (entityCode) {
//            conditions.push(
//                'entity.code="' +
//                entityCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
//                '"'
//            );
//            print("conditions: "+conditions);
//        }
//
//        if (psCodeFilter) {
//            conditions.push(
//                'ps.code="' +
//                psCodeFilter.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
//                '"'
//            );
//        }
//
//        var rc = entityFile.doSelect(conditions.join(" and "));
//
//        while (rc == RC_SUCCESS) {
//            var psCode = String(entityFile["ps.code"] || "").trim();
//
//            if (
//                psCode &&
//                isHTKTReportLv1Code(psCode) &&
//                !seen[psCode]
//            ) {
//                var branchName = String(
//                    entityFile["branch.name"] ||
//                    entityFile["name"] ||
//                    ""
//                ).trim();
//
//                var matchedKeyword = true;
//
//                if (keyword) {
//                    var searchText = keyword.toLowerCase();
//
//                    matchedKeyword =
//                        psCode.toLowerCase().indexOf(searchText) >= 0 ||
//                        branchName.toLowerCase().indexOf(searchText) >= 0;
//                }
//
//                if (matchedKeyword) {
//                    seen[psCode] = true;
//
//                    rows.push({
//                        "ps.code": psCode,
//                        "branch.name": branchName,
//                        "entity.code": String(entityFile["entity.code"] || "").trim()
//                    });
//                }
//            }
//
//            rc = entityFile.getNext();
//        }
//
//        var total = rows.length;
//        var startIndex = start - 1;
//        var page = rows.slice(startIndex, startIndex + count);
//
//        return {
//            success: true,
//            data: page,
//            total: total,
//            start: start,
//            count: page.length
//        };
//    } catch (e) {
//        return {
//            success: false,
//            error: e && e.message ? String(e.message) : String(e),
//            data: [],
//            total: 0
//        };
//    } finally {
//        if (entityFile) {
//            try { entityFile.doClose(); } catch (eCloseEntity) {}
//        }
//    }
//}

//
//function getListBranchTH(input) {
//
//    var params = {};
//    try {
//        var rawData = input ? (input.queryString || input.details) : null;
//
//        if (rawData) {
//            params = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
//        }
//
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (eParse) {
//        return {
//            success: false,
//            error: "Du lieu dau vao khong hop le.",
//            data: [],
//            total: 0
//        };
//    }
//
//    var entityCode = String(params.id == null ? "" : params.id).trim();
//    var keyword = String(params.keyword == null ? "" : params.keyword).trim();
//    var psCodeFilter = String(params.psCode == null ? "" : params.psCode).trim();
//    // Mặc định orderBy theo ps.code nếu client không truyền
//    var orderBy = String(params.orderBy == null ? "ps.code" : params.orderBy).trim() || "ps.code";
//
//    var start = parseInt(params.start, 10) || 1;
//    var count = parseInt(params.count, 10) || 10;
//
//    if (start < 1) start = 1;
//    if (count < 1) count = 10;
//
//    var entityFile = null;
//    var rows = [];
//    var seen = {};
//    
//    
//
//    try {
//        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
//
//        var conditions = ['status="ACTIVE"'];
//
//        if (entityCode) {
//            conditions.push(
//                'entity.code="' +
//                entityCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
//                '"'
//            );
//        }
//
//        if (psCodeFilter) {
//            conditions.push(
//                'ps.code="' +
//                psCodeFilter.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
//                '"'
//            );
//        }
//        print("conditions: " + JSON.stringify(conditions));
//
//        var rc = entityFile.doSelect(conditions.join(" and "));
//        
//        while (rc == RC_SUCCESS) {
//            var psCode = String(entityFile["ps.code"] || "").trim();
//            
//            if (
//                psCode &&
//                isHTKTReportLv1Code(psCode) &&
//                !seen[psCode]
//            ) {
//                var branchName = String(
//                    entityFile["branch.name"] ||
//                    entityFile["name"] ||
//                    ""
//                ).trim();
//
//                var matchedKeyword = true;
//
//                if (keyword) {
//                    var searchText = keyword.toLowerCase();
//                    matchedKeyword =
//                        psCode.toLowerCase().indexOf(searchText) >= 0 ||
//                        branchName.toLowerCase().indexOf(searchText) >= 0;
//                }
//
//                if (matchedKeyword) {
//                    seen[psCode] = true;
//
//                    rows.push({
//                        "ps.code": psCode,
//                        "branch.name": branchName,
//                        "entity.code": String(entityFile["entity.code"] || "").trim()
//                    });
//                }
//                print("rows: " + JSON.stringify(rows));
//            }
//
//            rc = entityFile.getNext();
//        }
//
//        // =========================================================
//        // SẮP XẾP ƯU TIÊN KẾT QUẢ GẦN ĐÚNG & ĐƠN VỊ MẶC ĐỊNH LÊN ĐẦU
//        // =========================================================
//        rows.sort(function(a, b) {
//            var codeA = String(a["ps.code"] || "").trim();
//            var codeB = String(b["ps.code"] || "").trim();
//
//            // 1. TỰ ĐỘNG PHÁT HIỆN: Nếu orderBy chứa toàn chữ số, 
//            var targetCode = "";
//            if (orderBy && /^\d+$/.test(orderBy)) {
//                targetCode = orderBy;
//            }
//
//            if (targetCode) {
//                if (codeA === targetCode && codeB !== targetCode) return -1; // A lên đầu
//                if (codeB === targetCode && codeA !== targetCode) return 1;  // B lên đầu
//            }
//
//            // 2. NẾU CÓ KEYWORD: So sánh điểm tương quan
//            if (keyword) {
//                var kw = keyword.toLowerCase();
//
//                function getScore(item) {
//                    var code = (item["ps.code"] || "").toLowerCase();
//                    var name = (item["branch.name"] || "").toLowerCase();
//
//                    if (code === kw || name === kw) return 100;
//                    if (code.indexOf(kw) === 0) return 80;
//                    if (name.indexOf(kw) === 0) return 60;
//                    return 30;
//                }
//
//                var scoreA = getScore(a);
//                var scoreB = getScore(b);
//
//                if (scoreB !== scoreA) {
//                    return scoreB - scoreA;
//                }
//            }
//
//            // 3. SẮP XẾP MẶC ĐỊNH THEO PS.CODE TĂNG DẦN (ASC)
//            var numA = Number(codeA) || 0;
//            var numB = Number(codeB) || 0;
//
//            if (numA !== numB) {
//                return numA - numB;
//            }
//
//            return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
//        });
//
//        // =========================================================
//        // PHÂN TRANG KẾT QUẢ
//        // =========================================================
//        var total = rows.length;
//        var startIndex = start - 1;
//        var page = rows.slice(startIndex, startIndex + count);
//
//        return {
//            success: true,
//            data: page,
//            total: total,
//            start: start,
//            count: page.length
//        };
//    } catch (e) {
//        return {
//            success: false,
//            error: e && e.message ? String(e.message) : String(e),
//            data: [],
//            total: 0
//        };
//    } finally {
//        if (entityFile) {
//            try { entityFile.doClose(); } catch (eCloseEntity) {}
//        }
//    }
//}

function getListBranchTH(input) {
    var params = {};
    try {
        var rawData = input ? (input.queryString || input.details) : null;

        if (rawData) {
            params = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        }

        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (eParse) {
        return {
            success: false,
            error: "Du lieu dau vao khong hop le.",
            data: [],
            total: 0
        };
    }

    var entityCode = String(params.id == null ? "" : params.id).trim();
    var keyword = String(params.keyword == null ? "" : params.keyword).trim();
    var psCodeFilter = String(params.psCode == null ? "" : params.psCode).trim();
    var orderBy = String(params.orderBy == null ? "ps.code" : params.orderBy).trim() || "ps.code";

    var start = parseInt(params.start, 10) || 1;
    var count = parseInt(params.count, 10) || 10;

    if (start < 1) start = 1;
    if (count < 1) count = 10;

    var entityFile = null;
    var rawRows = [];
    var seen = {};

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);

        var conditions = ['status="ACTIVE"'];

        if (entityCode) {
            conditions.push(
                'entity.code="' +
                entityCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
                '"'
            );
        }

        if (psCodeFilter) {
            conditions.push(
                'ps.code="' +
                psCodeFilter.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
                '"'
            );
        }

        var rc = entityFile.doSelect(conditions.join(" and "));

        while (rc == RC_SUCCESS) {
            var psCode = String(entityFile["ps.code"] || "").trim();

            if (
                psCode &&
                isHTKTReportLv1Code(psCode) &&
                !seen[psCode]
            ) {
                var entCode = String(entityFile["entity.code"] || "").trim();
                var branchName = String(
                    entityFile["branch.name"] ||
                    entityFile["name"] ||
                    ""
                ).trim();

                if (entCode === "1010098") {
                    branchName = "Trụ sở chính";
                }

                var matchedKeyword = true;

                if (keyword) {
                    var searchText = keyword.toLowerCase();
                    matchedKeyword =
                        psCode.toLowerCase().indexOf(searchText) >= 0 ||
                        branchName.toLowerCase().indexOf(searchText) >= 0;
                }

                if (matchedKeyword) {
                    seen[psCode] = true;

                    rawRows.push({
                        "ps.code": psCode,
                        "branch.name": branchName,
                        "entity.code": entCode
                    });
                }
            }

            rc = entityFile.getNext();
        }

        // =========================================================
        // GOM NHÓM: Nếu là Trụ sở chính (entity.code === "1010098"), gộp thành 1 dòng duy nhất
        // =========================================================
        var headquartersCodes = [];
        var rows = [];

        for (var i = 0; i < rawRows.length; i++) {
            var item = rawRows[i];
            if (item["entity.code"] === "1010098") {
                headquartersCodes.push(item["ps.code"]);
            } else {
                rows.push(item);
            }
        }

        // Nếu có dữ liệu Trụ sở chính, gom lại thành 1 phần tử duy nhất đẩy lên đầu hoặc vào danh sách
        if (headquartersCodes.length > 0) {
            rows.unshift({
                "ps.code": "TSC",
                //                "ps.code": "099901000",
                "ps.code2": headquartersCodes.join(","),
                "branch.name": "Trụ sở chính",
                "entity.code": "1010098"
            });
        }

        // =========================================================
        // PHÂN TRANG KẾT QUẢ
        // =========================================================
        var total = rows.length;
        var startIndex = start - 1;
        var page = rows.slice(startIndex, startIndex + count);

        return {
            success: true,
            data: page,
            total: total,
            start: start,
            count: page.length
        };
    } catch (e) {
        return {
            success: false,
            error: e && e.message ? String(e.message) : String(e),
            data: [],
            total: 0
        };
    } finally {
        if (entityFile) {
            try { entityFile.doClose(); } catch (eCloseEntity) {}
        }
    }
}
//
function getListReportPayment(input) {
    var invoiceList = [];
    var branch = "",
        documentType = "",
        fromDate = "",
        status = "",
        toDate = "";

    try {
        if (input && input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            branch = queryObjOld.branch || "";
            documentType = queryObjOld.documentType || "";
            fromDate = queryObjOld.fromDate || "";
            toDate = queryObjOld.toDate || "";
            status = queryObjOld.status || "";
        }
    } catch (ex) {
        return invoiceList;
    }

    // 1. XÂY DỰNG MỆNH ĐỀ WHERE
    var whereClause = "WHERE 1=1 ";
    if (branch && branch.trim() !== "" && branch.trim().toUpperCase() !== "ALL") {
        var branchArray = branch.split(",");
        var branchConditions = [];
        for (var i = 0; i < branchArray.length; i++) {
            var b = branchArray[i].trim();
            if (b) branchConditions.push("p.unit.lv1=\"" + b + "\"");
        }
        if (branchConditions.length > 0) whereClause += " AND (" + branchConditions.join(" OR ") + ")";
    }

    if (status && status.trim() !== "" && status.trim().toUpperCase() !== "ALL") {
        var statusArray = status.split(",");
        var statusConditions = [];
        for (var i = 0; i < statusArray.length; i++) {
            var b = statusArray[i].trim();
            if (b) statusConditions.push("p.status=\"" + b + "\"");
        }
        if (statusConditions.length > 0) whereClause += " AND (" + statusConditions.join(" OR ") + ")";
    }

    if (fromDate && fromDate.trim() !== "" && fromDate !== "null") {
        var parentFromDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(fromDate);
        whereClause += " AND p.created.at >= '" + parentFromDate.startDateStr + "' ";
    }
    if (toDate && toDate.trim() !== "" && toDate !== "null") {
        var parentToDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(toDate);
        whereClause += " AND p.created.at <= '" + parentToDate.endDateStr + "' ";
    }

    var fieldMappings = [
        ['id', 'id', 'S'],
        ['transaction.type', 'transaction_type', 'S'],
        ['created.at', 'created_at', 'D'],
        ['completed.date', 'completed_date', 'D'],
        ['contract.id', 'contract_id', 'S'],
        ['vendor.number', 'vendor_number', 'S'],
        ['vendor.name', 'vendor_name', 'S'],
        ['currency', 'currency', 'S'],
        ['description', 'description', 'S'],
        ['status', 'status', 'S'],
        ['created.by', 'created_by', 'S'],
        ['branch.name', 'department', 'S'],
        ['user.checker.kttc', 'user_checker_kttc', 'S'],
        ['user.approver.final', 'user_approver_final', 'S'],
        ['initial.role', 'initial_role', 'S'],
    ];

    var sqlFields = fieldMappings.map(function(item) { return item[0]; }).join(", ");

    var isQueryPrepayment = false,
        isQueryPayment = false;
    var docTypeUpper = documentType ? documentType.trim().toUpperCase() : "";

    if (!docTypeUpper || docTypeUpper === "ALL") {
        isQueryPrepayment = true;
        isQueryPayment = true;
    } else {
        var docTypes = docTypeUpper.split(",");
        for (var d = 0; d < docTypes.length; d++) {
            var itemType = docTypes[d].trim();
            if (itemType === "PREPAYMENT") isQueryPrepayment = true;
            if (itemType === "PAYMENT") isQueryPayment = true;
        }
    }

    // 2. LẤY DỮ LIỆU BẢNG CHÍNH VÀ GOM TẤT CẢ ID VÀO 1 MẢNG DÙNG CHUNG
    var allIds = [];

    // --- Query Prepayment ---
    if (isQueryPrepayment) {
        try {
            var fPre = new SCFile('esdHTKTprepayment', SCFILE_READONLY);
            var sqlPre = "SELECT " + sqlFields + ", p.amount FROM esdHTKTprepayment p " +
                " JOIN esdHTKTprepaymentVendor pv ON (p.id = pv.prepayment.id) " +
                " JOIN esdDMentity e ON (p.unit.lv1 = e.ps.code) " +
                " JOIN esdHTKTvendor v ON (v.id = pv.vendor.id) " + whereClause;

            var rcPre = fPre.doSelect(sqlPre);
            while (rcPre == RC_SUCCESS) {

                var itemPre = mapRowToObjectCustom(fPre, fieldMappings);
                var rawAmountPre = fPre[fieldMappings.length] || fPre['p.amount'] || fPre['amount'];
                itemPre.amount = rawAmountPre ? String(rawAmountPre) : "0";

                itemPre.record_type = "PREPAYMENT";
                itemPre.ap_code = "";
                itemPre.hostRefNum = "";

                invoiceList.push(itemPre);
                allIds.push(itemPre.id);
                rcPre = fPre.getNext();
            }
            print("itemPre: " + itemPre);
            if (fPre) fPre.doClose();
        } catch (ePre) { print("Loi query prepayment: " + ePre.toString()); }
    }

    // --- Query Payment ---
    if (isQueryPayment) {
        try {
            var fPay = new SCFile('esdHTKTpayment', SCFILE_READONLY);
            // ĐÃ SỬA: pv.payment.id thay vì pv.prepayment.id
            var sqlPay = "SELECT " + sqlFields + ", p.total.amount.paid FROM esdHTKTpayment p " +
                " JOIN esdHTKTpaymentVendor pv ON (p.id = pv.payment.id) " +
                " JOIN esdDMentity e ON (p.unit.lv1 = e.ps.code) " +
                " JOIN esdHTKTvendor v ON (v.id = pv.vendor.id) " + whereClause;

            var rcPay = fPay.doSelect(sqlPay);
            while (rcPay == RC_SUCCESS) {
                var itemPay = mapRowToObjectCustom(fPay, fieldMappings);
                var rawAmountPay = fPay[fieldMappings.length] || fPay['p.total.amount.paid'] || fPay['total.amount.paid'];
                itemPay.amount = rawAmountPay ? String(rawAmountPay) : "0";
                itemPay.record_type = "PAYMENT";
                itemPay.ap_code = "";
                itemPay.hostRefNum = "";

                invoiceList.push(itemPay);
                allIds.push(itemPay.id);
                rcPay = fPay.getNext();
            }
            if (fPay) fPay.doClose();
        } catch (ePay) { print("Loi query payment: " + ePay.toString()); }
    }

    // 3. QUERY BẢNG ACCOUNTING (BATCH QUERY TRÊN TRƯỜNG "prepayment.id")
    var aiMap = {};

    function populateAiMap(idList) {
        if (!idList || idList.length === 0) return;

        var chunkSize = 500;
        for (var i = 0; i < idList.length; i += chunkSize) {
            var chunk = idList.slice(i, i + chunkSize);
            // Luôn dùng trường prepayment.id làm FK
            var queryAi = "prepayment.id isin {\"" + chunk.join("\",\"") + "\"}";

            try {
                var fAi = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
                var rcAi = fAi.doSelect(queryAi);
                while (rcAi == RC_SUCCESS) {
                    var recId = String(fAi['prepayment.id']);
                    if (!aiMap[recId]) aiMap[recId] = { ap_code: "", hostRefNum: "" };

                    var aiType = fAi['type'] ? String(fAi['type']).toUpperCase() : "";
                    if (aiType === "AP") {
                        aiMap[recId].ap_code = fAi['ap.code'] ? String(fAi['ap.code']) : "";
                    } else if (aiType === "CORE") {
                        aiMap[recId].hostRefNum = fAi['host.res.num'] ? String(fAi['host.res.num']) : "";
                    }
                    rcAi = fAi.getNext();
                }
                if (fAi) fAi.doClose();
            } catch (e) { print("Loi batch query AI: " + e.toString()); }
        }
    }

    // Gọi 1 lần duy nhất cho toàn bộ ID thu được
    populateAiMap(allIds);

    // 4. MERGE DỮ LIỆU VÀO KẾT QUẢ
    for (var k = 0; k < invoiceList.length; k++) {
        var item = invoiceList[k];
        if (aiMap[item.id]) {
            item.ap_code = aiMap[item.id].ap_code;
            item.hostRefNum = aiMap[item.id].hostRefNum;
        }

        var role = item.initial_role ? String(item.initial_role).trim().toUpperCase() : "";
        if (role === "DMMS") {
            item.user_checker_kttc = item.user_checker_kttc || "";
        } else if (role === "KTTC") {
            item.user_checker_kttc = item.created_by || "";
        }
    }

    return invoiceList;
}

//
//function getListReportPayment(input) {
//    var invoiceList = [];
//    var branch = "",
//        documentType = "",
//        fromDate = "",
//        status = "",
//        toDate = "";
//
//    try {
//        if (input && input.queryString) {
//            var queryObjOld = JSON.parse(input.queryString);
//            branch = queryObjOld.branch || "";
//            documentType = queryObjOld.documentType || "";
//            fromDate = queryObjOld.fromDate || "";
//            toDate = queryObjOld.toDate || "";
//            status = queryObjOld.status || "";
//        }
//    } catch (ex) {
//        return invoiceList;
//    }
//
//    // 1. MỆNH ĐỀ WHERE BẢNG CHÍNH (Dùng tiền tố p. hoặc trực tiếp tên field)
//    var whereClause = "1=1 ";
//    if (branch && branch.trim() !== "" && branch.trim().toUpperCase() !== "ALL") {
//        var branchArray = branch.split(",");
//        var branchConditions = [];
//        for (var i = 0; i < branchArray.length; i++) {
//            var b = branchArray[i].trim();
//            if (b) branchConditions.push("unit.lv1=\"" + b + "\"");
//        }
//        if (branchConditions.length > 0) whereClause += " AND (" + branchConditions.join(" OR ") + ")";
//    }
//
//    if (status && status.trim() !== "" && status.trim().toUpperCase() !== "ALL") {
//        var statusArray = status.split(",");
//        var statusConditions = [];
//        for (var i = 0; i < statusArray.length; i++) {
//            var b = statusArray[i].trim();
//            if (b) statusConditions.push("status=\"" + b + "\"");
//        }
//        if (statusConditions.length > 0) whereClause += " AND (" + statusConditions.join(" OR ") + ")";
//    }
//
//    if (fromDate && fromDate.trim() !== "" && fromDate !== "null") {
//        var parentFromDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(fromDate);
//        whereClause += " AND created.at >= '" + parentFromDate.startDateStr + "' ";
//    }
//    if (toDate && toDate.trim() !== "" && toDate !== "null") {
//        var parentToDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(toDate);
//        whereClause += " AND created.at <= '" + parentToDate.endDateStr + "' ";
//    }
//
//    var isQueryPrepayment = false,
//        isQueryPayment = false;
//    var docTypeUpper = documentType ? documentType.trim().toUpperCase() : "";
//
//    if (!docTypeUpper || docTypeUpper === "ALL") {
//        isQueryPrepayment = true;
//        isQueryPayment = true;
//    } else {
//        var docTypes = docTypeUpper.split(",");
//        for (var d = 0; d < docTypes.length; d++) {
//            var itemType = docTypes[d].trim();
//            if (itemType === "PREPAYMENT") isQueryPrepayment = true;
//            if (itemType === "PAYMENT") isQueryPayment = true;
//        }
//    }
//
//    var rawRecords = [];
//    var allIds = [];
//    var vendorIds = [];
//    var unitCodes = [];
//
//    // --- Query Prepayment ---
//    if (isQueryPrepayment) {
//        try {
//            var fPre = new SCFile('esdHTKTprepayment', SCFILE_READONLY);
//            if (fPre.doSelect(whereClause) == RC_SUCCESS) {
//                while (fPre.getNext() == RC_SUCCESS || fPre.id) {
//                    var rec = {
//                        id: String(fPre['id'] || ""),
//                        transaction_type: String(fPre['transaction.type'] || ""),
//                        created_at: fPre['created.at'] ? fPre['created.at'].toISOString() : "",
//                        completed_date: fPre['completed.date'] ? fPre['completed.date'].toISOString() : "",
//                        contract_id: String(fPre['contract.id'] || ""),
//                        currency: String(fPre['currency'] || ""),
//                        description: String(fPre['description'] || ""),
//                        status: String(fPre['status'] || ""),
//                        created_by: String(fPre['created.by'] || ""),
//                        user_checker_kttc: String(fPre['user.checker.kttc'] || ""),
//                        user_approver_final: String(fPre['user.approver.final'] || ""),
//                        initial_role: String(fPre['initial.role'] || ""),
//                        amount: fPre['amount'] ? String(fPre['amount']) : "0",
//                        record_type: "PREPAYMENT",
//                        unit_code: String(fPre['unit.lv1'] || ""),
//                        vendor_id: String(fPre['vendor.id'] || "") // Hoặc trường FK trỏ tới vendor
//                    };
//
//                    rawRecords.push(rec);
//                    if (rec.id) allIds.push(rec.id);
//                    if (rec.vendor_id) vendorIds.push(rec.vendor_id);
//                    if (rec.unit_code) unitCodes.push(rec.unit_code);
//
//                    if (fPre.getNext() != RC_SUCCESS) break;
//                }
//            }
//            if (fPre) fPre.doClose();
//        } catch (ePre) { print("Loi query prepayment: " + ePre.toString()); }
//    }
//
//    // --- Query Payment ---
//    if (isQueryPayment) {
//        try {
//            var fPay = new SCFile('esdHTKTpayment', SCFILE_READONLY);
//            if (fPay.doSelect(whereClause) == RC_SUCCESS) {
//                while (fPay.getNext() == RC_SUCCESS || fPay.id) {
//                    var recPay = {
//                        id: String(fPay['id'] || ""),
//                        transaction_type: String(fPay['transaction.type'] || ""),
//                        created_at: fPay['created.at'] ? fPay['created.at'].toISOString() : "",
//                        completed_date: fPay['completed.date'] ? fPay['completed.date'].toISOString() : "",
//                        contract_id: String(fPay['contract.id'] || ""),
//                        currency: String(fPay['currency'] || ""),
//                        description: String(fPay['description'] || ""),
//                        status: String(fPay['status'] || ""),
//                        created_by: String(fPay['created.by'] || ""),
//                        user_checker_kttc: String(fPay['user.checker.kttc'] || ""),
//                        user_approver_final: String(fPay['user.approver.final'] || ""),
//                        initial_role: String(fPay['initial.role'] || ""),
//                        amount: fPay['total.amount.paid'] ? String(fPay['total.amount.paid']) : "0",
//                        record_type: "PAYMENT",
//                        unit_code: String(fPay['unit.lv1'] || ""),
//                        vendor_id: String(fPay['vendor.id'] || "")
//                    };
//
//                    rawRecords.push(recPay);
//                    if (recPay.id) allIds.push(recPay.id);
//                    if (recPay.vendor_id) vendorIds.push(recPay.vendor_id);
//                    if (recPay.unit_code) unitCodes.push(recPay.unit_code);
//
//                    if (fPay.getNext() != RC_SUCCESS) break;
//                }
//            }
//            if (fPay) fPay.doClose();
//        } catch (ePay) { print("Loi query payment: " + ePay.toString()); }
//    }
//
//    // 2. BATCH LOOKUP BẢNG VENDOR & ENTITY (DEPARTMENT)
//    var vendorMap = {};
//    if (vendorIds.length > 0) {
//    
//        var fVen = new SCFile('esdHTKTvendor', SCFILE_READONLY);
//        if (fVen.doSelect("id isin {\"" + vendorIds.join("\",\"") + "\"}") == RC_SUCCESS) {
//            do {
//            
//                vendorMap[String(fVen['id'])] = {
//                    number: String(fVen['vendor.number'] || ""),
//                    name: String(fVen['vendor.name'] || "")
//                };
//            } while (fVen.getNext() == RC_SUCCESS);
//        }
//        if (fVen) fVen.doClose();
//    }
//
//    var deptMap = {};
//    if (unitCodes.length > 0) {
//        var fEnt = new SCFile('esdDMentity', SCFILE_READONLY);
//        if (fEnt.doSelect("ps.code isin {\"" + unitCodes.join("\",\"") + "\"}") == RC_SUCCESS) {
//            do {
//                deptMap[String(fEnt['ps.code'])] = String(fEnt['branch.name'] || "");
//            } while (fEnt.getNext() == RC_SUCCESS);
//        }
//        if (fEnt) fEnt.doClose();
//    }
//
//    // 3. BATCH LOOKUP ACCOUNTING
//    var aiMap = {};
//    if (allIds.length > 0) {
//        var chunkSize = 500;
//        for (var i = 0; i < allIds.length; i += chunkSize) {
//            var chunk = allIds.slice(i, i + chunkSize);
//            var fAi = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
//            if (fAi.doSelect("prepayment.id isin {\"" + chunk.join("\",\"") + "\"}") == RC_SUCCESS) {
//                do {
//                    var recId = String(fAi['prepayment.id']);
//                    if (!aiMap[recId]) aiMap[recId] = { ap_code: "", hostRefNum: "" };
//                    var aiType = fAi['type'] ? String(fAi['type']).toUpperCase() : "";
//                    if (aiType === "AP") aiMap[recId].ap_code = String(fAi['ap.code'] || "");
//                    else if (aiType === "CORE") aiMap[recId].hostRefNum = String(fAi['host.res.num'] || "");
//                } while (fAi.getNext() == RC_SUCCESS);
//            }
//            if (fAi) fAi.doClose();
//        }
//    }
//
//    // 4. MAP KẾT QUẢ CUỐI CÙNG
//    for (var k = 0; k < rawRecords.length; k++) {
//        var item = rawRecords[k];
//        var vInfo = vendorMap[item.vendor_id] || { number: "", name: "" };
//
//        var finalObj = {
//            id: item.id,
//            transaction_type: item.transaction_type,
//            created_at: item.created_at,
//            completed_date: item.completed_date,
//            contract_id: item.contract_id,
//            vendor_number: vInfo.number,
//            vendor_name: vInfo.name,
//            currency: item.currency,
//            description: item.description,
//            status: item.status,
//            created_by: item.created_by,
//            department: deptMap[item.unit_code] || "",
//            user_checker_kttc: item.user_checker_kttc,
//            user_approver_final: item.user_approver_final,
//            initial_role: item.initial_role,
//            amount: item.amount,
//            record_type: item.record_type,
//            ap_code: aiMap[item.id] ? aiMap[item.id].ap_code : "",
//            hostRefNum: aiMap[item.id] ? aiMap[item.id].hostRefNum : ""
//        };
//
//        var role = finalObj.initial_role ? finalObj.initial_role.trim().toUpperCase() : "";
//        if (role === "KTTC") {
//            finalObj.user_checker_kttc = finalObj.created_by || "";
//        }
//
//        invoiceList.push(finalObj);
//    }
//
//    return invoiceList;
//}
//
//getListLiabilities

function getListLiabilities(input) {
    var resultList = [];
    var branch = "",
        fromDate = "",
        toDate = "",
        vendor = "",
        contractId = "",
        contractValueParam = "";

    try {
        if (input && input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            branch = queryObjOld.branch || "";
            fromDate = queryObjOld.fromDate || "";
            toDate = queryObjOld.toDate || "";
            vendor = queryObjOld.vendor || "";
            contractId = queryObjOld.contractId || "";
            contractValueParam = queryObjOld.contractValueParam || "";
        }
    } catch (ex) {
        return resultList;
    }

    var whereClause = "WHERE 1=1 ";

    if (branch && branch.trim() !== "" && branch.trim().toUpperCase() !== "ALL") {
        var branchArray = branch.split(",");
        var branchConditions = [];
        for (var i = 0; i < branchArray.length; i++) {
            var b = branchArray[i].trim();
            if (b) branchConditions.push("c.unit.lv1=\"" + b + "\"");
        }
        if (branchConditions.length > 0) whereClause += " AND (" + branchConditions.join(" OR ") + ")";
    }

    if (vendor && vendor.trim() !== "" && vendor.trim().toUpperCase() !== "ALL") {
        var vendorArray = vendor.split(",");
        var vendorConditions = [];
        for (var i = 0; i < vendorArray.length; i++) {
            var b = vendorArray[i].trim().replace(/"/g, '\\"');
            if (b) vendorConditions.push('r.vendor.number="' + b + '"');
        }
        if (vendorConditions.length > 0) whereClause += " AND (" + vendorConditions.join(" OR ") + ")";
    }

    if (fromDate && typeof fromDate === 'string' && fromDate.trim() !== "" && fromDate !== "null") {
        var parentFromDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(fromDate);
        if (parentFromDate && parentFromDate.startDateStr) {
            whereClause += " AND c.signed.date >= '" + parentFromDate.startDateStr + "' ";
        }
    }

    if (toDate && typeof toDate === 'string' && toDate.trim() !== "" && toDate !== "null") {
        var parentToDate = lib.ESD_HTKT_Utils.getDateRangeForQuery(toDate);
        if (parentToDate && parentToDate.endDateStr) {
            whereClause += " AND c.signed.date <= '" + parentToDate.endDateStr + "' ";
        }
    }

    if (contractId && typeof contractId === 'string' && contractId.trim() !== "" && contractId.trim().toUpperCase() !== "ALL") {
        var cleanContractId = contractId.trim().replace(/"/g, '\\"');
        whereClause += " AND r.contract.id=\"" + cleanContractId + "\"";
    }
   
    whereClause += " AND (d.category.id =\"dmhd_loai_hd\") ";
    print("whereClause: " + whereClause);

    // Thứ tự SELECT quyết định index truy cập [0], [1], [2]...
    var sqlFields = [
        "r.id", // [0]
        "r.contract.id", // [1]
        "r.vendor.number", // [2]
        "r.vendor.name", // [3]
        //        "r.total.payable.amount", // [4]
        "c.total.paid.amount", // [4]
        "r.total.advance.amount", // [5]
        "r.total.refund.amount", // [6]
        "r.total.paid.amount", // [7]
        "d.item.name", // [8]
        "c.signed.date", // [9]
        "c.start.date", // [10]
        "c.expected.end.date", // [11]
        "c.category", // [12]
        "c.contract.value.after.tax", // [13]
        "c.total.budget" // [14]

    ].join(", ");

    try {
        var fReport = new SCFile('esdHTKTreportVendorDebt', SCFILE_READONLY);
        var sqlReport = "SELECT " + sqlFields + " FROM esdHTKTreportVendorDebt r " +
            "LEFT JOIN esdHDcontract c ON (r.contract.id = c.id) " +
            "LEFT JOIN esdDMcategoryItems d ON (c.contract.type = d.item.id) " +
            whereClause;

        var rcReport = fReport.doSelect(sqlReport);
        while (rcReport == RC_SUCCESS) {

            // Đọc dữ liệu theo mảng chỉ số (Index)
            var category = fReport[12] || "";
            var valAfterTax = Number(fReport[13]) || 0;
            var totalBudget = Number(fReport[14]) || 0;

            var contractValue = 0;
            if (category === "HD_GT" || category === "HD_GT_TTMS") {
                contractValue = valAfterTax;
            } else if (category === "HD_KMS" || category === "HD_KMS_TTMS") {
                contractValue = totalBudget;
            } else {
                contractValue = valAfterTax || totalBudget;
            }

            var totalPayableAmount = Number(fReport[4]) || 0;
            var totalAdvanceAmount = Number(fReport[5]) || 0;
            var totalRefundAmount = Number(fReport[6]) || 0;
            var totalPaidAmount = Number(fReport[7]) || 0;

            var remainingContractValue = contractValue - totalPayableAmount;
            var remainingAdvanceAmount = totalAdvanceAmount - totalRefundAmount;
            var remainingUnpaidAmount = totalPayableAmount - totalRefundAmount - totalPaidAmount;

            var isMatchFilter = true;
            if (contractValueParam === "SETTLED") {
                // Đã tất toán: Giá trị còn lại phải BẰNG 0
                if (remainingContractValue !== 0) {
                    isMatchFilter = false;
                }
            } else if (contractValueParam === "DEBT") {
                // Còn công nợ: Giá trị còn lại phải LỚN HƠN 0
                if (remainingContractValue <= 0) {
                    isMatchFilter = false;
                }
            }

            if (isMatchFilter) {
                var itemReport = {
                    "id": fReport[0] || "",
                    "contractId": fReport[1] || "",
                    "signedDate": fReport[9] || null,
                    "startDate": fReport[10] || null,
                    "expectedEndDate": fReport[11] || null,
                    "contractType": fReport[8] || "",
                    "contractValue": contractValue,
                    "totalPayableAmount": totalPayableAmount,
                    "remainingContractValue": remainingContractValue,
                    "vendorNumber": fReport[2] || "",
                    "vendorName": fReport[3] || "",
                    "liabilityPayableAmount": totalPayableAmount,
                    "totalAdvanceAmount": totalAdvanceAmount,
                    "totalRefundAmount": totalRefundAmount,
                    "totalPaidAmount": totalPaidAmount,
                    "remainingAdvanceAmount": remainingAdvanceAmount,
                    "remainingUnpaidAmount": remainingUnpaidAmount,
                    "currency": "VND"
                };

                resultList.push(itemReport);
            }
            rcReport = fReport.getNext();
        }

        if (fReport) fReport.doClose();
    } catch (eReport) {
        print("Lỗi query report vendor debt & contract: " + eReport.toString());
    }

    return resultList;
}
//


function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};
    for (var j = 0; j < fieldMappings.length; j++) {
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[j];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

function formatToSqlDateTime(isoString) {
    if (!isoString) return null;
    return isoString.replace('T', ' ').replace('Z', '').split('.')[0];
}

function extractHostRefNum(rawResponseStr) {
    if (!rawResponseStr) return "";

    try {
        var resObj = typeof rawResponseStr === 'string' ? JSON.parse(rawResponseStr) : rawResponseStr;

        if (resObj && resObj.data) {
            var data = resObj.data;

            var val = data.hostRefNum;

            if (val !== undefined && val !== null) {
                return String(val);
            }
        }
    } catch (e) {
        // Trường hợp chuỗi response không đúng định dạng JSON
    }

    return "";
}

//
//function getListVendor(input) {
//
//    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
//    var rawData = input ? (input.details || input.queryString) : null;
//    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };
//
//    var params = {};
//    try {
//        params = JSON.parse(rawData);
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (e) {
//        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
//    }
//
//    // Mapping fields cho câu SQL JOIN: [SQL Field, JSON key, Kiểu dữ liệu]
//    var fieldMappings = [
//        ['cs.contract.id', 'contractId', 'S'],
//        ['cs.supplier.id', 'supplierId', 'S'],
//        ['cs.supplier.name', 'supplierName', 'S'],
//        ['s.tax.code', 'taxCode', 'S']
//    ];
//
//    // 2. Xây dựng điều kiện lọc WHERE
//    var conditions = [];
//
//    // Lọc theo Contract ID
//    var contractId = params.contractId || params["contract.id"];
//
//    if (contractId && contractId.trim() !== "" && contractId.trim().toUpperCase() !== "ALL") {
//        var contractArray = contractId.split(",");
//        var contractConditions = [];
//        for (var i = 0; i < contractArray.length; i++) {
//            var b = contractArray[i].trim();
//            if (b) contractConditions.push('cs.contract.id="' + b + '"');
//        }
//        if (contractConditions.length > 0) {
//            // Push nhóm điều kiện OR vào mảng conditions
//            conditions.push("(" + contractConditions.join(" OR ") + ")");
//        }
//    }
//
//    // Khai báo và khởi tạo câu lệnh WHERE hoàn chỉnh
//    var whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
//
//    var sqlFields = fieldMappings.map(function(item) {
//        return item[0];
//    }).join(", ");
//
//    var querySQL = " SELECT " + sqlFields + " FROM esdHDcontractSupplier cs JOIN esdDMSupplier s ON (cs.supplier.id = s.id)" + whereClause;
//
//    var dataArray = [];
//    var f = new SCFile('esdHDcontractSupplier', SCFILE_READONLY);
//
//    try {
//        var rc = f.doSelect(querySQL);
//
//        while (rc == RC_SUCCESS) {
//            var itemData = mapRowByOrder(f, fieldMappings);
//
//            var wrappedItem = {
//                "getListVendor": itemData
//            };
//            dataArray.push(JSON.stringify(wrappedItem));
//
//            rc = f.getNext();
//        }
//    } catch (e) {
//        print("[ERROR getListVendor] Lỗi doSelect: " + e);
//    } finally {
//        try { if (f) f.doClose(); } catch (e) {}
//    }
//
//    // Trả mảng kết quả
//    input.queryReturnArray = system.functions.denull(dataArray);
//}

function getListVendor(input) {

    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = JSON.parse(rawData);
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    // Mapping fields cho câu SQL JOIN: [SQL Field, JSON key, Kiểu dữ liệu]
    var fieldMappings = [
        ['cs.contract.id', 'contractId', 'S'],
        ['cs.supplier.id', 'supplierId', 'S'],
        ['cs.supplier.name', 'supplierName', 'S'],
        ['s.tax.code', 'taxCode', 'S']
    ];

    // 2. Xây dựng điều kiện lọc WHERE
    var conditions = [];

    // Lọc theo Contract ID
    var contractId = params.contractId || params["contract.id"];

    if (contractId && contractId.trim() !== "" && contractId.trim().toUpperCase() !== "ALL") {
        var contractArray = contractId.split(",");
        var contractConditions = [];
        for (var i = 0; i < contractArray.length; i++) {
            var b = contractArray[i].trim();
            if (b) contractConditions.push('cs.contract.id="' + b + '"');
        }
        if (contractConditions.length > 0) {
            conditions.push("(" + contractConditions.join(" OR ") + ")");
        }
    }


    // Khai báo và khởi tạo câu lệnh WHERE hoàn chỉnh
    var whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    var sqlFields = fieldMappings.map(function(item) {
        return item[0];
    }).join(", ");

    var querySQL = " SELECT " + sqlFields + " FROM esdHDcontractSupplier cs JOIN esdDMSupplier s ON (cs.supplier.id = s.id)" + whereClause;

    var dataArray = [];
    var seenTaxCodes = {}; // Bảng băm kiểm tra trùng lặp taxCode
    var f = new SCFile('esdHDcontractSupplier', SCFILE_READONLY);

    try {
        var rc = f.doSelect(querySQL);

        while (rc == RC_SUCCESS) {
            var itemData = mapRowByOrder(f, fieldMappings);

            // Lấy MST từ itemData hoặc trực tiếp từ field
            var currentTaxCode = itemData.taxCode || f['s.tax.code'];

            // Nếu chưa có taxCode này (hoặc rỗng) thì lấy 1 lần duy nhất
            if (currentTaxCode && !seenTaxCodes[currentTaxCode]) {
                seenTaxCodes[currentTaxCode] = true; // Đánh dấu MST đã tồn tại

                var wrappedItem = {
                    "getListVendor": itemData
                };
                dataArray.push(JSON.stringify(wrappedItem));
            }

            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR getListVendor] Lỗi doSelect: " + e);
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }

    // Trả mảng kết quả
    input.queryReturnArray = system.functions.denull(dataArray);
}

function getListContract(input) {
    // 1. Lấy và parse dữ liệu đầu vào
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    // Đọc các thông số truyền từ FE
    var branch = params.branch || "";
    var keyword = params.keyword || "";
    var start = parseInt(params.start, 10) || 1;
    var count = parseInt(params.count, 10) || 10;

    // Mapping fields cho bảng esdHDcontract
    var fieldMappings = [
        ['id', 'contractId', 'S'],
        ['name', 'contractName', 'S'],
        ['unit.lv1', 'unitLv1', 'S'],
        ['unit.lv2', 'unitLv2', 'S'],
        ['unit.lv3', 'unitLv3', 'S']
    ];

    // 2. Xây dựng điều kiện lọc WHERE
    var conditions = [];

    // Lọc theo Branch (Đơn vị / Chi nhánh)
    if (branch && branch.trim() !== "" && branch.trim().toUpperCase() !== "ALL") {
        var branchArray = branch.split(",");
        var branchConditions = [];

        for (var i = 0; i < branchArray.length; i++) {
            var b = branchArray[i].trim();
            if (b) {
                // Kiểm tra mã branch nằm trong unit.lv1, unit.lv2 hoặc unit.lv3
                branchConditions.push('(unit.lv1="' + b + '" or unit.lv2="' + b + '" or unit.lv3="' + b + '")');
            }
        }
        if (branchConditions.length > 0) {
            conditions.push("(" + branchConditions.join(" or ") + ")");
        }
    }

    conditions.push('status="Dang thuc hien"');

    // Lọc theo từ khóa tìm kiếm (Keyword: Mã hợp đồng hoặc Tên hợp đồng)
    if (keyword && keyword.trim() !== "") {
        var cleanKw = keyword.trim().replace(/'/g, "''").replace(/"/g, '\\"');
        conditions.push('(id like "*' + cleanKw + '*" or name like "*' + cleanKw + '*")');
    }

    var whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" and ") : "";

    var sqlFields = fieldMappings.map(function(item) {
        return item[0];
    }).join(", ");

    // 3. Truy vấn dữ liệu từ bảng esdHDcontract
    var querySQL = "SELECT " + sqlFields + " FROM esdHDcontract" + whereClause;

    var dataArray = [];
    var f = new SCFile('esdHDcontract', SCFILE_READONLY);

    try {
        var rc = f.doSelect(querySQL);
        var currentIndex = 1;
        var endIndex = start + count - 1;

        while (rc == RC_SUCCESS) {
            // Phân trang bằng con trỏ doSelect
            if (currentIndex >= start && currentIndex <= endIndex) {
                var itemData = mapRowByOrder(f, fieldMappings);

                var wrappedItem = {
                    "getListContract": itemData
                };
                dataArray.push(JSON.stringify(wrappedItem));
            }
            if (currentIndex > endIndex) {
                break;
            }
            currentIndex++;
            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR getListContract] Lỗi doSelect: " + e);
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }

    // Trả mảng kết quả vào tham số input
    input.queryReturnArray = system.functions.denull(dataArray);
}

/**
 * Hàm map dữ liệu record theo thứ tự cột (Index) chuẩn Service Manager
 */
function mapRowByOrder(record, mappings) {
    var obj = {};
    for (var i = 0; i < mappings.length; i++) {
        var jsonKey = mappings[i][1];
        var dataType = mappings[i][2];

        var val = record[i];

        if (val === undefined || val === null) {
            var fieldName = mappings[i][0];
            var plainField = fieldName.replace(/^cs\./, '');
            val = record[fieldName] !== undefined ? record[fieldName] : record[plainField];
        }

        if (val !== null && val !== undefined) {
            if (dataType === "D" && val instanceof Date) {
                obj[jsonKey] = val.toISOString();
            } else {
                obj[jsonKey] = val;
            }
        } else {
            obj[jsonKey] = "";
        }
    }
    return obj;
}
//------------------------------------------------------------------
/**
 * API lưu file Base64 báo cáo vào esdHTKTreportHistory và khởi tạo Schedule 20s
 * @param {Object} param - { id, fileName, reportType, base64Value, createdBy }
 */
function saveReportHistoryAndSchedule(param) {
    var base64File = "",
        fileName = "",
        reportType = "DEBT_DETAIL";

    // 1. Giải mã param từ queryString hoặc Object
    try {
        if (param && param.queryString) {
            var queryObj = (typeof param.queryString === 'string') ?
                JSON.parse(param.queryString) :
                param.queryString;

            base64File = queryObj.base64Value || queryObj.base64File || queryObj.base64 || "";
            fileName = queryObj.fileName || queryObj.file_name || "";
            reportType = queryObj.reportType || queryObj.report_type || "DEBT_DETAIL";
        } else if (param) {
            base64File = param.base64Value || param.base64File || "";
            fileName = param.fileName || "";
            reportType = param.reportType || "DEBT_DETAIL";
        }
    } catch (ex) {
        print("Lỗi parse queryString trong saveReportHistoryAndSchedule: " + ex);
        return { success: false, message: "Dữ liệu queryString không hợp lệ." };
    }

    // Sanitize các chuỗi đầu vào
    fileName = sanitizeString(fileName);
    reportType = sanitizeString(reportType) || "DEBT_DETAIL";
    base64File = sanitizeString(base64File);

    // 2. Kiểm tra bắt buộc phải có chuỗi Base64
    if (!base64File) {
        return { success: false, message: "Thiếu chuỗi Base64 của file Excel." };
    }

    // 3. Tự sinh ID và khởi tạo bản ghi mới trong bảng esdHTKTreportHistory
    var idHistory = nextId1("esdHTKTreportHistory");
    var rptHistory = new SCFile('esdHTKTreportHistory');

    rptHistory['id'] = idHistory;
    rptHistory['file.name'] = fileName;
    rptHistory['report.type'] = reportType;
    rptHistory['base64.value'] = base64File;
    rptHistory['status'] = "PROCESSING";
    rptHistory['created.at'] = funcs.tod();
    rptHistory['updated.at'] = funcs.tod();

    var insertResult = rptHistory.doInsert();
    if (insertResult !== RC_SUCCESS) {
        try { if (rptHistory) rptHistory.doClose(); } catch (e) {}
        return { success: false, message: "Không thể chèn bản ghi mới vào esdHTKTreportHistory." };
    }

    try { if (rptHistory) rptHistory.doClose(); } catch (e) {}

    // 4. Khởi tạo Schedule hoãn 20 giây (Sử dụng đúng biến idHistory)
    var workerName = "ESD HTKT UPDATE REPORT STATUS == " + idHistory;

    lib.ESD_HTKT_Utils.createSchedule({
        name: workerName,
        script: 'lib.ESD_HTKT_REPORT.updateReportStatusAfterExport("' + idHistory + '");',
        actionDelaySeconds: 120
    });

    return { success: true, id: idHistory, message: "Đã lưu bản ghi lịch sử và khởi tạo Schedule 120 giây thành công." };
}

function updateReportStatusAfterExport(reportId) {

    if (!reportId) return;

    var rptHistory = new SCFile('esdHTKTreportHistory');
    var result = rptHistory.doSelect('id = "' + reportId + '"');

    if (result === RC_SUCCESS) {
        if (rptHistory['base64.value']) {
            rptHistory['status'] = "COMPLETED";
        } else {
            rptHistory['status'] = "ERROR";
        }
        rptHistory['updated.at'] = funcs.tod();
        rptHistory.doUpdate();
    }

    try { if (rptHistory) rptHistory.doClose(); } catch (e) {}
}

function getListReportHistory(input) {
    var reportType = "",
        createdBy = "";

    // 1. Giải mã param từ queryString hoặc details/Object
    try {
        var rawData = input ? (input.queryString || input.details) : null;
        if (rawData) {
            var queryObj = (typeof rawData === 'string') ? JSON.parse(rawData) : rawData;
            reportType = queryObj.reportType || "";
            createdBy = queryObj.createdBy || "";
        }
    } catch (ex) {
        print("[ERROR getListReportHistory] Lỗi parse input: " + ex);
        input.queryReturnArray = system.functions.denull([]);
        return;
    }

    // Mapping fields (Tên trường trong SM, JSON key, Kiểu dữ liệu)
    var fieldMappings = [
        ["id", "id", "S"],
        ["file.name", "fileName", "S"],
        ["report.type", "reportType", "S"],
        //        ["base64.value", "base64Value", "S"],
        ["status", "status", "S"],
        ["created.at", "createdAt", "D"],
        ["created.by", "createdBy", "S"],
        ["updated.at", "updatedAt", "D"]
    ];

    // 2. Xây dựng câu điều kiện Query
    var queryConditions = [];

    if (createdBy && createdBy.trim() !== "") {
        var cleanCreatedBy = createdBy.trim().replace(/"/g, '\\"');
        queryConditions.push('created.by="' + cleanCreatedBy + '"');
    }

    if (reportType && reportType.trim() !== "") {
        var cleanReportType = reportType.trim().replace(/"/g, '\\"');
        queryConditions.push('report.type="' + cleanReportType + '"');
    }

    // Ghép các điều kiện bằng ngoặc và toán tử AND
    var querySQL = queryConditions.length > 0 ? queryConditions.join(" and ") : "true";

    var dataArray = [];
    var f = new SCFile('esdHTKTreportHistory', SCFILE_READONLY);

    try {
        // Sắp xếp lấy bản ghi mới nhất lên đầu
        f.setOrderBy(['created.at'], [SCFILE_DSC]);

        var rc = f.doSelect(querySQL);
        var count = 0;

        while (rc == RC_SUCCESS && count < 5) {
            // Hàm mapping giá trị từ SCFile sang Object
            var itemData = mapRowToObject(f, fieldMappings);

            var wrappedItem = {
                "getListReportHistory": itemData
            };

            dataArray.push(JSON.stringify(wrappedItem));

            count++;
            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR getListReportHistory] Lỗi doSelect: " + e);
    } finally {
        if (f) {
            try { f.doClose(); } catch (e) {}
        }
    }

    // Gán mảng kết quả vào input.queryReturnArray
    input.queryReturnArray = system.functions.denull(dataArray);
}

function getReportHistoryDetail(input) {
    var recordId = "";

    // 1. Parse param đầu vào (lấy recordId từ queryString hoặc details/Object)
    try {
        var rawData = input ? (input.queryString || input.details) : null;
        if (rawData) {
            var queryObj = (typeof rawData === 'string') ? JSON.parse(rawData) : rawData;
            recordId = queryObj.id || queryObj.reportHistoryId || "";
        }
    } catch (ex) {
        print("[ERROR getReportHistoryDetail] Lỗi parse input: " + ex);
        input.queryReturnArray = system.functions.denull([]);
        return;
    }

    if (!recordId || recordId.trim() === "") {
        print("[WARN getReportHistoryDetail] Dữ liệu id truyền vào rỗng.");
        input.queryReturnArray = system.functions.denull([]);
        return;
    }

    // Mapping đầy đủ các field bao gồm base64.value
    var fieldMappings = [
        ["id", "id", "S"],
        ["file.name", "fileName", "S"],
        ["report.type", "reportType", "S"],
        ["base64.value", "base64Value", "S"]
    ];

    var dataArray = [];
    var f = new SCFile('esdHTKTreportHistory', SCFILE_READONLY);

    try {
        // Query chính xác theo id bản ghi
        var cleanId = recordId.trim().replace(/"/g, '\\"');
        var querySQL = 'id="' + cleanId + '"';

        var rc = f.doSelect(querySQL);

        if (rc == RC_SUCCESS) {
            var itemData = mapRowToObject(f, fieldMappings);

            var wrappedItem = {
                "getReportHistoryDetail": itemData
            };

            dataArray.push(JSON.stringify(wrappedItem));
        }
    } catch (e) {
        print("[ERROR getReportHistoryDetail] Lỗi query bản ghi: " + e);
    } finally {
        if (f) {
            try { f.doClose(); } catch (e) {}
        }
    }

    // Gán mảng kết quả trả về cho client
    input.queryReturnArray = system.functions.denull(dataArray);
}

// Hàm phụ trợ mapping trường dữ liệu từ SCFile sang Object (bổ sung nếu chưa có)
function mapRowToObjectCustom(record, mappings) {
    var obj = {};
    for (var i = 0; i < mappings.length; i++) {
        var smField = mappings[i][0];
        var jsonKey = mappings[i][1];
        var dataType = mappings[i][2];

        var val = record[i];
        if (val === undefined || val === null) {
            val = record[smField];
        }
        if (val !== null && val !== undefined) {
            if (dataType === "D") {
                if (val instanceof Date && typeof val.toISOString === "function") {
                    obj[jsonKey] = val.toISOString();
                } else {
                    obj[jsonKey] = String(val);
                }
            } else {
                obj[jsonKey] = String(val);
            }
        } else {
            obj[jsonKey] = "";
        }
    }
    return obj;
}

function mapRowToObject(record, mappings) {

    var obj = {};
    for (var i = 0; i < mappings.length; i++) {
        var smField = mappings[i][0];
        var jsonKey = mappings[i][1];
        var dataType = mappings[i][2];
        var val = record[smField];

        if (val !== null && val !== undefined) {
            if (dataType === "D" && val instanceof Date) {
                obj[jsonKey] = val.toISOString(); // Hoặc định dạng Date phù hợp với hệ thống
            } else {
                obj[jsonKey] = val;
            }
        } else {
            obj[jsonKey] = "";
        }
    }
    return obj;
}


///

function sanitizeString(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/\0/g, '').trim();
}

function nextId1(name) {
    var nextNumber = new SCDatum();
    funcs.rtecall("getnumber", 1, nextNumber, name);
    return funcs.str(nextNumber);
}
//------------------------------------------------------------------
//1.Hàm khởi tạo bản ghi lịch sử
function createReportHistory(param) {
    var fileName = "",
        reportType = "DEBT_DETAIL",
        createdBy = "";

    // 1. Parse dữ liệu đầu vào
    try {
        var queryObj = (param && param.queryString) ?
            (typeof param.queryString === 'string' ? JSON.parse(param.queryString) : param.queryString) :
            param;

        if (queryObj) {
            fileName = queryObj.fileName || queryObj.file_name || "";
            reportType = queryObj.reportType || queryObj.report_type || "DEBT_DETAIL";
            createdBy = queryObj.createdBy || queryObj.created_by || "";
        }
    } catch (ex) {
        print("Lỗi parse param trong createReportHistory: " + ex);
        return { success: false, message: "Dữ liệu tham số không hợp lệ." };
    }

    fileName = sanitizeString(fileName);
    reportType = sanitizeString(reportType) || "DEBT_DETAIL";

    // 2. Sinh ID mới và chèn bản ghi khởi tạo
    var idHistory = nextId1("esdHTKTreportHistory");
    var rptHistory = new SCFile('esdHTKTreportHistory');

    rptHistory['id'] = idHistory;
    rptHistory['file.name'] = fileName;
    rptHistory['report.type'] = reportType;
    rptHistory['status'] = "PROCESSING";
    rptHistory['base64.value'] = ""; // Để trống, chờ FE đẩy lên sau khi build file thành công
    rptHistory['created.at'] = funcs.tod();
    rptHistory['updated.at'] = funcs.tod();
    rptHistory['created.by'] = createdBy;

    var insertResult = rptHistory.doInsert();
    if (insertResult !== RC_SUCCESS) {
        try { if (rptHistory) rptHistory.doClose(); } catch (e) {}
        return { success: false, message: "Không thể chèn bản ghi lịch sử vào esdHTKTreportHistory." };
    }

    try { if (rptHistory) rptHistory.doClose(); } catch (e) {}

    // 3. Khởi tạo Schedule Timeout (phòng trường hợp FE bị crash/tắt trình duyệt giữa chừng)
    var workerName = "ESD HTKT REPORT TIMEOUT CHECK == " + idHistory;
    lib.ESD_HTKT_Utils.createSchedule({
        name: workerName,
        script: 'lib.ESD_HTKT_REPORT.checkReportTimeout("' + idHistory + '");',
        actionDelaySeconds: 300 // Sau 5 phút (300 giây) nếu chưa ghi Base64 thì đánh dấu FAILED
    });

    return {
        success: true,
        id: idHistory,
        message: "Khởi tạo bản ghi lịch sử xuất file thành công."
    };
}

//2.Hàm lưu Base64 và cập nhật trạng thái
function uploadReportBase64(param) {
    var reportId = "",
        base64File = "",
        reportType = "";

    // 1. Parse dữ liệu đầu vào
    try {
        var queryObj = (param && param.queryString) ?
            (typeof param.queryString === 'string' ? JSON.parse(param.queryString) : param.queryString) :
            param;

        if (queryObj) {
            reportId = queryObj.id || queryObj.reportId || "";
            base64File = queryObj.base64Value || queryObj.base64File || queryObj.base64 || "";
            reportType = queryObj.reportType || queryObj.report_type || "";
        }
    } catch (ex) {
        print("Lỗi parse param trong uploadReportBase64: " + ex);
        return { success: false, message: "Dữ liệu tham số không hợp lệ." };
    }

    reportId = sanitizeString(reportId);
    base64File = sanitizeString(base64File);

    if (!reportId) {
        return { success: false, message: "Thiếu ID bản ghi lịch sử (reportId)." };
    }

    if (!base64File) {
        return { success: false, message: "Thiếu chuỗi Base64 của file Excel." };
    }

    // 2. Tra cứu bản ghi theo ID và cập nhật
    var rptHistory = new SCFile('esdHTKTreportHistory');
    var result = rptHistory.doSelect('id = "' + reportId + '"');

    if (result === RC_SUCCESS) {
        rptHistory['base64.value'] = base64File;
        rptHistory['status'] = "COMPLETED";
        if (reportType) rptHistory['report.type'] = sanitizeString(reportType);
        rptHistory['updated.at'] = funcs.tod();

        var updateResult = rptHistory.doUpdate();
        try { if (rptHistory) rptHistory.doClose(); } catch (e) {}

        if (updateResult === RC_SUCCESS) {
            return { success: true, id: reportId, message: "Cập nhật file và chuyển trạng thái COMPLETED thành công." };
        } else {
            return { success: false, message: "Lỗi khi cập nhật bản ghi trong esdHTKTreportHistory." };
        }
    } else {
        try { if (rptHistory) rptHistory.doClose(); } catch (e) {}
        return { success: false, message: "Không tìm thấy bản ghi lịch sử với ID: " + reportId };
    }
}
//3.Hàm Schedule kiểm tra Timeout
function checkReportTimeout(reportId) {
    if (!reportId) return;

    var rptHistory = new SCFile('esdHTKTreportHistory');
    var result = rptHistory.doSelect('id = "' + reportId + '"');

    if (result === RC_SUCCESS) {
        // Nếu đã qua thời gian chờ mà bản ghi vẫn chưa nhận được Base64 (trạng thái vẫn là PROCESSING)
        if (rptHistory['status'] === "PROCESSING" && !rptHistory['base64.value']) {
            rptHistory['status'] = "FAILED";
            rptHistory['error.detail'] = "Hệ thống tự động hủy: Quá thời gian chờ tải file lên từ phía Client (Timeout).";
            rptHistory['updated.at'] = funcs.tod();
            rptHistory.doUpdate();
        }
    }

    try { if (rptHistory) rptHistory.doClose(); } catch (e) {}
}