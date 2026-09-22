/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tải danh sách người duyệt hợp lệ (Reviewer, Approver, Kế toán trưởng, Ban Giám đốc, v.v.).
 * - Áp dụng ma trận phân quyền phê duyệt dựa trên đơn vị người tạo, hạn mức số tiền và quy trình.
 * - Hỗ trợ tải dữ liệu động cho các Combobox chọn người phê duyệt trên giao diện đề nghị thanh toán.
 * -----------------------------------------------------------------------------
 */

// trưởng thêm
function getPaymentRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040001000001";
    var RIGHT_VIEW_PAYMENT = "0040040003000001";
    var RIGHT_CREATE_PAYMENT = "0040040003000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040003000003";
    var rights = [];

    contactId = String(contactId == null ? "" : contactId).trim();

    if (!contactId) {
        return "";
    }

    try {
        rights = lib.ESD_PERMS_RIGHTS.permsRight(contactId) || [];

        if (rights.toArray) {
            rights = rights.toArray();
        }
    } catch (e) {
        return "";
    }

    if (!rights || typeof rights.length === "undefined") {
        return "";
    }

    var rightMap = {};

    for (var i = 0; i < rights.length; i++) {
        var rightId = String(rights[i] == null ? "" : rights[i]).trim();

        if (rightId) {
            rightMap[rightId] = true;
        }
    }

    var canCreatePayment =
            rightMap[RIGHT_VIEW_INVOICE] &&
            rightMap[RIGHT_VIEW_PAYMENT] &&
            rightMap[RIGHT_CREATE_PAYMENT];

    if (!canCreatePayment) {
        return "";
    }

    return rightMap[RIGHT_ACCOUNTING_INPUT] ? "kttc" : "dmms";
}

/*
 * Hàm dùng chung cho cả Thanh toán và Tạm ứng.
 * Lọc contact theo quyền và lv1 ngay từ truy vấn đầu tiên, sau đó xác minh
 * data permission 00401 theo toàn bộ unit thuộc target lv1 bằng batch query.
 */
function listContactsByRightsAndLv1(rightIds, targetLv1, subModuleId) {
    var normalizedLv1 = String(targetLv1 == null ? "" : targetLv1).trim().replace(/\.0$/, "");
    var normalizedRights = rightIds || [];
    var units = [];
    var seenUnits = {};
    var orgFile = null;

    if (!normalizedLv1 || !normalizedRights.length) {
        return [];
    }

    function addUnit(unitId) {
        var value = String(unitId == null ? "" : unitId).trim().replace(/\.0$/, "");
        if (value && !seenUnits[value]) {
            seenUnits[value] = true;
            units.push(value);
        }
    }

    addUnit(normalizedLv1);

    try {
        orgFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
        orgFile.setFields(["unit.id", "lv1.id"]);
        var orgRc = orgFile.doSelect(
                'unit.id="' + normalizedLv1.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
                '" or lv1.id="' + normalizedLv1.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
        );

        while (orgRc === RC_SUCCESS) {
            addUnit(orgFile["unit.id"]);
            orgRc = orgFile.getNext();
        }
    } finally {
        try { if (orgFile) orgFile.doClose(); } catch (closeError) {}
    }

    if (!lib.ESD_PERMS_RIGHTS || !lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter) {
        return [];
    }

    /*
     * Không lấy toàn bộ người có quyền trên toàn hàng rồi mới lọc từng người.
     * Hàm chung đã lọc group/contact active và hiệu lực ngày; bổ sung lv1.id
     * tại chính query đó để chỉ trả người thuộc lv1 của hồ sơ.
     */
    var contacts = lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(
            normalizedRights,
            { "lv1.id": [normalizedLv1] }
    ) || [];
    if (contacts.toArray) contacts = contacts.toArray();
    if (!contacts.length) return [];

    var contactConditions = [];
    var unitConditions = [];
    var permissionIds = [];
    var contactByPermissionId = {};
    var acceptedContacts = {};

    for (var contactIndex = 0; contactIndex < contacts.length; contactIndex++) {
        contactConditions.push(
                'contact.id="' + String(contacts[contactIndex]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
        );
    }
    for (var unitIndex = 0; unitIndex < units.length; unitIndex++) {
        unitConditions.push(
                'unit.id="' + String(units[unitIndex]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
        );
    }

    var permissionFile = null;
    try {
        permissionFile = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
        permissionFile.setFields(["id", "contact.id", "permission.scope"]);
        var permissionRc = permissionFile.doSelect(
                "(" + contactConditions.join(" or ") + ")" +
                ' and sub.module="' + String(subModuleId || "00401").replace(/"/g, '\\"') + '"' +
                ' and permission.scope~="QT_PQDL_01"' +
                ' and permission.scope~="QT_PQDL_06"'
        );

        while (permissionRc === RC_SUCCESS) {
            var permissionId = String(permissionFile["id"] == null ? "" : permissionFile["id"]).trim();
            var contactId = String(permissionFile["contact.id"] == null ? "" : permissionFile["contact.id"]).trim();
            var scope = String(permissionFile["permission.scope"] == null ? "" : permissionFile["permission.scope"]).trim();

            /*
             * QT_PQDL_01 = chỉ cá nhân; QT_PQDL_06 = toàn hàng nhưng đang bị
             * chặn ở combobox. Hai scope này không được mở rộng sang lv1 hồ sơ.
             */
            if (permissionId && contactId && scope !== "QT_PQDL_01" && scope !== "QT_PQDL_06") {
                permissionIds.push(permissionId);
                contactByPermissionId[permissionId] = contactId;
            }

            permissionRc = permissionFile.getNext();
        }
    } finally {
        try { if (permissionFile) permissionFile.doClose(); } catch (permissionCloseError) {}
    }

    permissionIds = uniqueStrings(permissionIds);
    if (!permissionIds.length) return [];

    /* Một query theo batch thay cho countFile() lặp cho từng permission. */
    var BATCH_SIZE = 100;
    for (var offset = 0; offset < permissionIds.length; offset += BATCH_SIZE) {
        var permissionConditions = [];
        var permissionBatch = permissionIds.slice(offset, offset + BATCH_SIZE);
        for (var permissionIndex = 0; permissionIndex < permissionBatch.length; permissionIndex++) {
            permissionConditions.push(
                    'data.permission.id="' + escapeSmQueryValue(permissionBatch[permissionIndex]) + '"'
            );
        }

        var unitFile = null;
        try {
            unitFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
            unitFile.setFields(["data.permission.id", "unit.id", "status"]);
            var unitRc = unitFile.doSelect(
                    "(" + permissionConditions.join(" or ") + ') and status="Dang hoat dong" and (' +
                    unitConditions.join(" or ") + ")"
            );
            while (unitRc === RC_SUCCESS) {
                var mappedPermissionId = String(
                        unitFile["data.permission.id"] || unitFile.data_permission_id || ""
                ).trim();
                var mappedContactId = contactByPermissionId[mappedPermissionId];
                if (mappedContactId) acceptedContacts[mappedContactId] = true;
                unitRc = unitFile.getNext();
            }
        } finally {
            try { if (unitFile) unitFile.doClose(); } catch (unitCloseError) {}
        }
    }

    var result = [];
    for (var resultIndex = 0; resultIndex < contacts.length; resultIndex++) {
        var resultContactId = String(contacts[resultIndex] == null ? "" : contacts[resultIndex]).trim();
        if (resultContactId && acceptedContacts[resultContactId]) result.push(resultContactId);
    }
    return uniqueStrings(result);
}

function uniqueStrings(source) {
    var result = [];
    var seen = {};
    for (var i = 0; source && i < source.length; i++) {
        var value = String(source[i] == null ? "" : source[i]).trim();
        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }
    return result;
}

function escapeSmQueryValue(value) {
    return String(value == null ? "" : value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}


function loadPaymentApprovalComboBoxes(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "");
}

// Event checkbox Yêu cầu Rà soát 1: chỉ tải user.checker.dmms.
function loadPaymentDmmsCheckerComboBox(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "user.checker.dmms");
}

// Event checkbox Yêu cầu Rà soát 2: chỉ tải user.checker.final.
function loadPaymentFinalCheckerComboBox(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "user.checker.final");
}

function loadPaymentApprovalComboBoxesInternal(paymentFile, requestedField) {
    var HTKT_SUB_MODULE = "00401";

    /*
     * Chặn tuyệt đối việc scope toàn hàng mở combobox cho mọi lv1.
     * Nghiệp vụ hiện tại yêu cầu gói chặt trong lv1:
     * CN Hà Nội không được xem/chọn người của CN khác, dù có quyền cao nhất.
     */
    var ALLOW_GLOBAL_SCOPE_IN_COMBO = false;

    /*
     * ===== Rights constants =====
     */
    /*
     * Quyền xem hóa đơn:
     * - 0040040001000001: quyền khởi tạo
     * - 0040040001000004: quyền xử lý/phê duyệt
     */
    var RIGHT_VIEW_INVOICE_CREATE = "0040040001000001";
    var RIGHT_VIEW_INVOICE_APPROVAL = "0040040001000004";

    /*
     * Quyền xem danh sách đề nghị thanh toán:
     * - 0040040003000001: quyền khởi tạo
     * - 0040040003000009: quyền xử lý/phê duyệt
     */
    var RIGHT_VIEW_PAYMENT_CREATE = "0040040003000001";
    var RIGHT_VIEW_PAYMENT_APPROVAL = "0040040003000009";

    var RIGHT_CREATE_PAYMENT = "0040040003000002"; //Lập đề nghị thanh toán
    var RIGHT_ACCOUNTING_INPUT = "0040040003000003"; //Nhập liệu hạch toán
    var RIGHT_CHECK_1 = "0040040003000004"; //Rà soát đề nghị thanh toán 1
    var RIGHT_APPROVE_1 = "0040040003000005"; //Phê duyệt đề nghị thanh toán cấp 1
    var RIGHT_APPROVE_2 = "0040040003000006"; //Phê duyệt đề nghị thanh toán cấp 2
    var RIGHT_CHECK_2 = "0040040003000007"; //Rà soát đề nghị thanh toán 2
    var RIGHT_APPROVE_3 = "0040040003000008"; //Phê duyệt đề nghị thanh toán cấp 3

    /*
     * Quyền view dùng cho role khởi tạo và KTTC tiếp nhận.
     */
    var RIGHTS_VIEW_CREATE = [
        RIGHT_VIEW_INVOICE_CREATE,
        RIGHT_VIEW_PAYMENT_CREATE
    ];

    /*
     * Quyền view dùng cho các combobox xử lý/phê duyệt sau KTTC tiếp nhận.
     *
     * Không dùng quyền view khởi tạo tại đây:
     * - RIGHT_VIEW_INVOICE_CREATE
     * - RIGHT_VIEW_PAYMENT_CREATE
     *
     * Các role DMMS RS1, DMMS phê duyệt, KTTC phê duyệt,
     * KTTC rà soát 2 và cấp có thẩm quyền dùng bộ quyền view phê duyệt.
     */
    var RIGHTS_VIEW_APPROVAL = [
        RIGHT_VIEW_INVOICE_APPROVAL,
        RIGHT_VIEW_PAYMENT_APPROVAL
    ];

    // Mỗi seedRights xác định nhóm ứng viên. Không kiểm tra include/exclude.
    // Vẫn kiểm tra phân quyền dữ liệu theo lv1 hồ sơ sau khi lấy ứng viên.
    var configs = [{
        key: "kttc",
        label: "KTTC tiếp nhận",
        saveField: "user.checker.kttc",

        /*
         * KTTC tiếp nhận dùng bộ quyền của khởi tạo:
         * - 0040040001000001: Xem danh sách & chi tiết hóa đơn - Khởi tạo
         * - 0040040003000001: Xem danh sách đề nghị thanh toán - Khởi tạo
         * - 0040040003000002: Lập đề nghị thanh toán
         * - 0040040003000003: Nhập liệu hạch toán
         */

        seedRights: [
            RIGHT_ACCOUNTING_INPUT
        ],
        valueList: "$L.kttc.ids",
        displayList: "$L.kttc.names"
    },

    {
        key: "dmmsRs1",
        label: "DMMS rà soát 1",
        saveField: "user.checker.dmms",
        seedRights: [
            RIGHT_CHECK_1
        ],
        valueList: "$L.dmms.ids",
        displayList: "$L.dmms.rs1"
    },

    {
        key: "dmmsApproval1",
        label: "DMMS phê duyệt cấp 1",
        saveField: "user.approver.dmms",
        seedRights: [
            RIGHT_APPROVE_1
        ],
        valueList: "$L.dmms.approval1.ids",
        displayList: "$L.dmms.approval1"
    },

    {
        key: "kttcApprove2",
        label: "KTTC phê duyệt cấp 2",
        saveField: "user.approver.kttc",
        seedRights: [
            RIGHT_APPROVE_2
        ],
        valueList: "$L.kttc.approve2.ids",
        displayList: "$L.kttc.approve2"
    },

    {
        key: "kttcCheck2",
        label: "KTTC rà soát 2",
        saveField: "user.checker.final",
        seedRights: [
            RIGHT_CHECK_2
        ],
        valueList: "$L.kttc.check2.ids",
        displayList: "$L.kttc.check2"
    },

    {
        key: "approveAll",
        label: "Phê duyệt cấp có thẩm quyền",
        saveField: "user.approver.final",

        /*
         * Cấp có thẩm quyền chỉ cần:
         * - 0040040001000004: Xem danh sách & chi tiết hóa đơn - Phê duyệt
         * - 0040040003000009: Xem danh sách đề nghị thanh toán - Phê duyệt
         * - 0040040003000008: Phê duyệt đề nghị thanh toán cấp 3
         */

        seedRights: [
            RIGHT_APPROVE_3
        ],
        valueList: "$L.approve.all.ids",
        displayList: "$L.approve.all"
    }
    ];

    var output = {
        success: true,
        message: "",
        currentUser: "",
        currentUserScope: null,
        targetLv1: "",
        targetLv1Source: "",
        configs: []
    };

    /* Cache trong một lần load form để không truy vấn lặp cùng user/role. */
    var userScopeCache = {};
    var contactDataCache = {};
    var orgUnitCache = {};

    // Lọc trước mọi thao tác gán/xóa biến: gọi riêng không ảnh hưởng 5 ô còn lại.
    if (requestedField) {
        var requestedConfigs = [];
        for (var requestedIndex = 0; requestedIndex < configs.length; requestedIndex++) {
            if (configs[requestedIndex].saveField === requestedField) {
                requestedConfigs.push(configs[requestedIndex]);
            }
        }
        configs = requestedConfigs;
    }

    var file = paymentFile || vars["$L.file"];
    var phase = normalizeValue(safeFileGet(file, ["current.phase"]));
    var loadDmmsGroup = phase === "initial_dmms" || phase === "approval_dmms";
    var loadKttcGroup = phase === "initial_kttc" || phase === "approval_kttc";
    var candidateConfigs = [];
    output.phase = phase;
    for (var configIndex = 0; configIndex < configs.length; configIndex++) {
        var phaseConfig = configs[configIndex];
        // Checker chỉ tải ứng viên khi checkbox bật và thuộc nhóm phase đang tải.
        // Checkbox tắt hoặc phase khác: chỉ tra người đã lưu.
        var dmmsGroup = phaseConfig.saveField === "user.checker.kttc" ||
                (phaseConfig.saveField === "user.checker.dmms" &&
                    safeFileGet(file, ["require.check.level1"]) === "true") ||
                phaseConfig.saveField === "user.approver.dmms";
        var kttcGroup = phaseConfig.saveField === "user.approver.kttc" ||
                (phaseConfig.saveField === "user.checker.final" &&
                    safeFileGet(file, ["require.check.level2"]) === "true") ||
                phaseConfig.saveField === "user.approver.final";
        phaseConfig.mode = ((dmmsGroup && loadDmmsGroup) || (kttcGroup && loadKttcGroup)) ? "candidates" : "selected";
        if (phase === "approval_kttc" && phaseConfig.saveField === "user.checker.kttc") {
            phaseConfig.mode = "candidates";
        }
        // Hàm riêng được caller kích hoạt từ checkbox, luôn tải ứng viên của ô đó.
        if (requestedField) phaseConfig.mode = "candidates";
        if (phaseConfig.mode === "candidates") candidateConfigs.push(phaseConfig);
    }

    var targetInfo = getPaymentTargetLv1(file);

    output.targetLv1 = targetInfo.lv1;
    output.targetLv1Source = targetInfo.source;

    if (!output.targetLv1) {
        clearAllComboBoxes(configs);

        output.success = false;
        output.message = "Không xác định được lv1 của hồ sơ thanh toán.";

        return output;
    }

    /*
     * ===== Guard quan trọng nhất =====
     * Người đăng nhập phải có data permission 00401 trong đúng lv1 của hồ sơ.
     * Nếu không có, clear toàn bộ combobox và dừng.
     */
    var currentUser = normalizeValue(
            safeVarGet("$lo.contact.name", "")
    );

    output.currentUser = currentUser;

    if (!currentUser) {

        clearAllComboBoxes(configs);

        output.success = false;
        output.message = "Không xác định được user đăng nhập.";

        return output;
    }

    var currentUserScope = getUserScopeContext(currentUser, output.targetLv1);

    output.currentUserScope = currentUserScope;

    if (!currentUserScope.canAccessTargetLv1) {
        clearAllComboBoxes(configs);

        output.success = false;
        output.message =
                "User đăng nhập không có phân quyền dữ liệu " +
                HTKT_SUB_MODULE +
                " trong lv1 của hồ sơ: " +
                output.targetLv1;
        return output;
    }


    /*
     * User đăng nhập hợp lệ thì mới load danh sách combobox.
     */
    for (var i = 0; i < configs.length; i++) {
        var config = configs[i];

        var result = loadOneComboBox(config, output.targetLv1);
//        if (config.mode === "candidates") {
//            print("[ApprovalCombo] " + config.saveField + ": " +
//                    (result.success ? result.count + " nguoi" : "LOI: " + result.message));
//        }

        output[config.key] = result;
        output.configs.push({
            key: config.key,
            label: config.label,
            valueList: config.valueList,
            displayList: config.displayList,
            saveField: config.saveField,
            count: result.count,
            mode: result.mode
        });

        if (!result.success) {
            output.success = false;
        }
    }

    output.message = output.success ?
            "Load danh sách combobox thành công." :
            "Có combobox load không thành công.";

    return output;

    /* =========================================================
     * LOAD COMBO
     * ========================================================= */

    function clearAllComboBoxes(configs) {
        for (var i = 0; i < configs.length; i++) {
            vars[configs[i].valueList] = [];
            vars[configs[i].displayList] = [];
        }
    }

    function loadOneComboBox(config, targetLv1) {
        var result = {
            success: false,
            mode: config.mode,
            label: config.label,
            saveField: config.saveField,
            targetLv1: targetLv1,
            count: 0,
            ids: [],
            names: [],
            message: "",
            debug: {
                poolCount: 0,
                passedCount: 0,
                rejectedCount: 0
            }
        };

        vars[config.valueList] = [];
        vars[config.displayList] = [];

        try {

            var selectedOnly = config.mode === "selected";
            var selectedId = "";
            var contactIds;
            if (selectedOnly) {
                selectedId = normalizeValue(safeFileGet(file, [config.saveField]));
                contactIds = { ids: selectedId ? [selectedId] : [], poolCount: 0, rejectedCount: 0 };
            } else {
                contactIds = getContactsForRoleInLv1(config, targetLv1);
            }

            result.debug.poolCount = contactIds.poolCount;
            result.debug.rejectedCount = contactIds.rejectedCount;

            // Tra chính xác contact.name đã lưu, không tìm lại pool ứng viên.
            // Người đã chọn vẫn được hiển thị nếu hiện đã ngừng hoạt động.
            var comboData = readContactData(contactIds.ids, selectedOnly);
            if (selectedOnly && selectedId && !comboData.ids.length) {
                comboData = { ids: [selectedId], names: [selectedId] };
            }


            if (comboData.ids.length !== comboData.names.length) {
                throw new Error(
                        config.valueList +
                        " và " +
                        config.displayList +
                        " không cùng số phần tử."
                );
            }

            vars[config.valueList] = comboData.ids;
            vars[config.displayList] = comboData.names;

            result.success = true;
            result.count = comboData.ids.length;
            result.ids = comboData.ids;
            result.names = comboData.names;
            result.debug.passedCount = comboData.ids.length;

            result.message = result.count > 0 ?
                    "Load danh sách thành công." :
                    "Không tìm thấy cán bộ phù hợp.";

        } catch (e) {
            vars[config.valueList] = [];
            vars[config.displayList] = [];

            result.success = false;
            result.message = String(e.message || e);
        }

        return result;
    }

    function getContactsForRoleInLv1(config, targetLv1) {
        var ids = normalizeArray(listContactsByRightsAndLv1(config.seedRights, targetLv1, HTKT_SUB_MODULE));
        return { ids: ids, poolCount: ids.length, rejectedCount: 0 };
    }

    /* =========================================================
     * CURRENT USER / CANDIDATE USER SCOPE
     * ========================================================= */

    function getUserScopeContext(contactId, targetLv1) {
        var normalizedContactId = normalizeValue(contactId);
        var normalizedTargetLv1 = normalizeUnitCode(targetLv1);
        var cacheKey = normalizedContactId + "|" + normalizedTargetLv1;

        if (!userScopeCache.hasOwnProperty(cacheKey)) {
            userScopeCache[cacheKey] = buildUserScopeContext(
                    normalizedContactId,
                    normalizedTargetLv1
            );
        }

        return userScopeCache[cacheKey];
    }

    function buildUserScopeContext(contactId, targetLv1) {

        targetLv1 = normalizeUnitCode(targetLv1);

        var result = {
            contactId: contactId,
            targetLv1: targetLv1,
            scope: "",
            rawUnits: [],
            resolvedLv1List: [],
            canAccessTargetLv1: false,
            message: ""
        };

        if (!contactId || !targetLv1) {
            result.message = "Thiếu contactId hoặc targetLv1.";
            // print("[ERROR] " + result.message);
            return result;
        }

        var dp = null;

        try {
            dp = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
                    contactId,
                    HTKT_SUB_MODULE
            ) || {};


        } catch (e) {
            result.message = String(e.message || e);

            // print("[EXCEPTION] " + result.message);

            return result;
        }

        result.scope = normalizeValue(
                dp.scope ||
                dp.dataScopeList ||
                dp["permission.scope"] ||
                ""
        );


        if (!result.scope) {
            result.scope = "QT_PQDL_01";
            // print("[SCOPE] Không có scope -> mặc định QT_PQDL_01");
        }

        result.rawUnits = normalizeArray(
                dp.unit ||
                dp.arrUnitRights ||
                dp.units ||
                []
        );


        /*
         * Scope toàn hàng
         */
        if (result.scope === "QT_PQDL_06") {

            result.canAccessTargetLv1 =
                    ALLOW_GLOBAL_SCOPE_IN_COMBO === true;

            result.message =
                    result.canAccessTargetLv1 ?
                            "User có scope toàn hàng và hệ thống cho phép dùng toàn hàng." :
                            "User có scope toàn hàng nhưng nghiệp vụ đang chặn mở dữ liệu khác lv1.";

            return result;
        }

        /*
         * Scope cá nhân
         */
        if (result.scope === "QT_PQDL_01") {

            result.canAccessTargetLv1 = false;
            result.message =
                    "User chỉ có scope cá nhân, không được load combobox theo lv1.";

            return result;
        }

        if (result.rawUnits.length === 0) {

            result.canAccessTargetLv1 = false;
            result.message =
                    "User có scope đơn vị nhưng không có unit phân quyền dữ liệu.";

            return result;
        }


        /*
         * Resolve từng unit và dừng ngay khi gặp đúng lv1 hồ sơ.
         * Trước đây resolve toàn bộ danh sách trước khi so sánh, làm phát sinh
         * nhiều SCFile.doSelect không cần thiết đối với mỗi ứng viên.
         */
        var resolvedLv1Map = {};

        for (var i = 0; i < result.rawUnits.length; i++) {
            var rawUnit = normalizeUnitCode(result.rawUnits[i]);
            var currentLv1 = rawUnit === targetLv1 ? rawUnit : resolveLv1FromUnit(rawUnit);

            if (currentLv1 && !resolvedLv1Map[currentLv1]) {
                resolvedLv1Map[currentLv1] = true;
                result.resolvedLv1List.push(currentLv1);
            }

            if (currentLv1 === targetLv1) {
                result.canAccessTargetLv1 = true;
                result.message =
                        "User có data permission 00401 trong lv1 của hồ sơ.";

                return result;
            }
        }

        result.canAccessTargetLv1 = false;
        result.message =
                "User không có data permission 00401 trùng lv1 của hồ sơ.";

        return result;
    }

    /* =========================================================
     * TARGET LV1
     * ========================================================= */

    function getPaymentTargetLv1(file) {
        var result = {
            lv1: "",
            source: ""
        };

        /*
         * Ưu tiên lv1 của hồ sơ.
         */
        var lv1 = normalizeUnitCode(
                safeFileGet(file, [
                    "unit.lv1",
                    "unit_lv1",
                    "lv1.id",
                    "lv1_id"
                ])
        );

        if (lv1) {
            result.lv1 = lv1;
            result.source = "$L.file.unit.lv1";
            return result;
        }

        /*
         * Nếu hồ sơ chỉ có unit.id thì resolve ngược lên lv1.
         */
        var unitId = normalizeUnitCode(
                safeFileGet(file, [
                    "unit.id",
                    "unit_id",
                    "unit"
                ])
        );

        if (unitId) {
            result.lv1 = resolveLv1FromUnit(unitId);
            result.source = "$L.file.unit.id";
            return result;
        }

        /*
         * Fallback cho màn add/new nếu hồ sơ chưa có unit.lv1.
         * Dùng lv1 của user đăng nhập.
         * Sau đó vẫn có guard currentUserScope để đảm bảo hợp lệ.
         */
        var currentContactLv1 = normalizeUnitCode(
                safeVarGet("$G.contacts.lv1", "")
        );

        if (currentContactLv1) {
            result.lv1 = currentContactLv1;
            result.source = "$G.contacts.lv1";
            return result;
        }

        var currentUnit = normalizeUnitCode(
                safeVarGet("$unit", "")
        );

        if (currentUnit) {
            result.lv1 = resolveLv1FromUnit(currentUnit);
            result.source = "$unit";
            return result;
        }

        return result;
    }

    /* =========================================================
     * ORG UNIT RESOLVE
     * ========================================================= */

    function resolveLv1FromUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);

        if (!unitCode) {
            return "";
        }

        var currentUnit = unitCode;
        var seen = {};
        var maxLoop = 10;

        for (var i = 0; i < maxLoop; i++) {
            if (!currentUnit) {
                return "";
            }

            if (seen[currentUnit]) {
                return "";
            }

            seen[currentUnit] = true;

            var detail = lookupOrgUnit(currentUnit);

            if (!detail.found) {
                /*
                 * Fallback: giữ lại unit hiện tại để không làm rỗng dữ liệu.
                 * Nếu gặp case này trong test thì cần kiểm tra lại esdQTorgUnit.
                 */
                return currentUnit;
            }

            if (isLevel1(detail.level)) {
                return detail.unitId;
            }

            if (detail.lv1Id) {
                return detail.lv1Id;
            }

            if (!detail.parentId || detail.parentId === currentUnit) {
                return currentUnit;
            }

            currentUnit = detail.parentId;
        }

        return currentUnit;
    }

    function lookupOrgUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);

        var result = {
            found: false,
            recordId: "",
            unitId: unitCode,
            unitName: "",
            level: "",
            status: "",
            parentId: "",
            orgUnit: "",
            lv1Id: ""
        };

        if (!unitCode) {
            return result;
        }

        if (orgUnitCache.hasOwnProperty(unitCode)) {
            return orgUnitCache[unitCode];
        }

        var f = null;

        try {
            f = new SCFile("esdQTorgUnit", SCFILE_READONLY);

            /*
             * Quan trọng:
             * esdQTorgUnit.id là mã record nội bộ.
             * esdQTorgUnit.unit.id mới là mã đơn vị nghiệp vụ.
             */
            var rc = f.doSelect(
                    'unit.id="' + escapeQueryValue(unitCode) + '"'
            );

            if (rc === RC_SUCCESS) {
                result.found = true;
                result.recordId = normalizeValue(f["id"]);
                result.unitId = normalizeUnitCode(f["unit.id"]);
                result.unitName = normalizeValue(f["unit.name"]);
                result.level = normalizeValue(f["level"]);
                result.status = normalizeValue(f["status"]);
                result.parentId = normalizeUnitCode(f["parent.id"]);
                result.orgUnit = normalizeValue(f["org.unit"]);
                result.lv1Id = normalizeUnitCode(f["lv1.id"]);

                if (!result.lv1Id && isLevel1(result.level)) {
                    result.lv1Id = result.unitId;
                }
            }
        } finally {
            try {
                if (f) {
                    f.doClose();
                }
            } catch (eClose) {}
        }

        orgUnitCache[unitCode] = result;
        return result;
    }

    function isLevel1(level) {
        level = normalizeValue(level);

        /*
         * Hệ thống có các dạng lv1c/lv1d nên không so sánh cứng bằng "lv1".
         */
        return level.indexOf("lv1") === 0;
    }

    /* =========================================================
     * CONTACT DISPLAY
     * ========================================================= */

    function readContactData(contactIds, includeInactive) {
        var ids = normalizeArray(contactIds);
        var cacheKey = (includeInactive ? "selected|" : "candidates|") + ids.slice(0).sort().join("|");

        var data = {
            ids: [],
            names: []
        };
        if (ids.length === 0) {
            return data;
        }

        if (contactDataCache.hasOwnProperty(cacheKey)) {
            return {
                ids: contactDataCache[cacheKey].ids.slice(0),
                names: contactDataCache[cacheKey].names.slice(0)
            };
        }

        var conditions = [];

        for (var i = 0; i < ids.length; i++) {
            conditions.push(
                    'contact.name="' +
                    escapeQueryValue(ids[i]) +
                    '"'
            );
        }

        var rows = [];
        var seen = {};
        var contactFile = null;

        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);

            contactFile.setFields([
                "contact.name",
                "full.name",
                "position",
                "status"
            ]);

            var rc = contactFile.doSelect(
                    "(" + conditions.join(" or ") + ")"
            );

            while (rc === RC_SUCCESS) {
                var contactId = normalizeValue(
                        contactFile["contact.name"]
                );

                var status = normalizeValue(
                        contactFile["status"]
                );

                /*
                 * Chỉ lấy user đang hoạt động.
                 */
                if (
                        contactId &&
                        !seen[contactId] &&
                        (includeInactive || !status || status === "Dang hoat dong")
                ) {
                    seen[contactId] = true;

                    var fullName = normalizeValue(
                            contactFile["full.name"]
                    );

                    var position = normalizeValue(
                            contactFile["position"]
                    );

                    var display = "";

                    if (fullName && position) {
                        display = fullName + " - " + position;
                    } else if (fullName) {
                        display = fullName;
                    } else {
                        display = contactId;
                    }

                    rows.push({
                        id: contactId,
                        display: display
                    });
                }

                rc = contactFile.getNext();
            }
        } finally {
            try {
                if (contactFile) {
                    contactFile.doClose();
                }
            } catch (eClose) {}
        }

        rows.sort(function(a, b) {
            var da = normalizeValue(a.display).toLowerCase();
            var db = normalizeValue(b.display).toLowerCase();

            if (da < db) return -1;
            if (da > db) return 1;
            return 0;
        });


        for (var j = 0; j < rows.length; j++) {
            data.ids.push(rows[j].id);
            data.names.push(rows[j].display);
        }

        contactDataCache[cacheKey] = {
            ids: data.ids.slice(0),
            names: data.names.slice(0)
        };

        return data;
    }

    /* =========================================================
     * BASIC UTILS
     * ========================================================= */

    function normalizeValue(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeArray(source) {
        var array = source || [];
        var result = [];
        var seen = {};

        try {
            if (array.toArray) {
                array = array.toArray();
            }
        } catch (eToArray) {
            array = [];
        }

        if (!array || typeof array.length === "undefined") {
            return result;
        }

        for (var i = 0; i < array.length; i++) {
            var value = normalizeValue(array[i]);

            if (value && !seen[value]) {
                seen[value] = true;
                result.push(value);
            }
        }

        return result;
    }

    function normalizeUnitCode(code) {
        var s = normalizeValue(code);

        if (!s) {
            return "";
        }

        s = s.replace(/\.0$/, "");

        /*
         * Excel bỏ số 0 đầu:
         * 10639000 -> 010639000
         */
        if (/^[0-9]+$/.test(s) && s.length === 8) {
            s = "0" + s;
        }

        return s;
    }

    function escapeQueryValue(value) {
        return normalizeValue(value)
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"');
    }

    function safeFileGet(file, fields) {
        if (!file || !fields) {
            return "";
        }

        for (var i = 0; i < fields.length; i++) {
            try {
                var value = file[fields[i]];

                if (value != null && value !== "") {
                    return String(value).trim();
                }
            } catch (e1) {}

            try {
                var alt = fields[i].replace(/\./g, "_");
                var value2 = file[alt];

                if (value2 != null && value2 !== "") {
                    return String(value2).trim();
                }
            } catch (e2) {}
        }

        return "";
    }

    function safeVarGet(name, defaultValue) {
        try {
            return vars[name] == null ? defaultValue : vars[name];
        } catch (e) {
            return defaultValue;
        }
    }

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return String(obj);
        }
    }
}
