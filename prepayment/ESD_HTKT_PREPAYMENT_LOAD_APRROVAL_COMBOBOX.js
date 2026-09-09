function getPrepaymentRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040001000001";
    var RIGHT_VIEW_PREPAYMENT = "0040040002000001";
    var RIGHT_CREATE_PREPAYMENT = "0040040002000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040002000003";
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

    var canCreatePrepayment = rightMap[RIGHT_VIEW_INVOICE] &&
                              rightMap[RIGHT_VIEW_PREPAYMENT] &&
                              rightMap[RIGHT_CREATE_PREPAYMENT];

    if (!canCreatePrepayment) {
        return "";
    }

    return rightMap[RIGHT_ACCOUNTING_INPUT] ? "kttc" : "dmms";
}

function loadPrepaymentApprovalComboBoxes() {
    var HTKT_SUB_MODULE = "00401";
    var ALLOW_GLOBAL_SCOPE_IN_COMBO = false;

    var RIGHT_VIEW_INVOICE_CREATE = "0040040001000001";
    var RIGHT_VIEW_INVOICE_APPROVAL = "0040040001000004";
    var RIGHT_VIEW_PREPAYMENT_CREATE = "0040040002000001";
    var RIGHT_VIEW_PREPAYMENT_APPROVAL = "0040040002000009";

    var RIGHT_CREATE_PREPAYMENT = "0040040002000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040002000003";
    var RIGHT_CHECK_1 = "0040040002000004";
    var RIGHT_APPROVE_1 = "0040040002000005";
    var RIGHT_APPROVE_2 = "0040040002000006";
    var RIGHT_CHECK_2 = "0040040002000007";
    var RIGHT_APPROVE_3 = "0040040002000008";

    var RIGHTS_VIEW_CREATE = [RIGHT_VIEW_INVOICE_CREATE, RIGHT_VIEW_PREPAYMENT_CREATE];
    var RIGHTS_VIEW_APPROVAL = [RIGHT_VIEW_INVOICE_APPROVAL, RIGHT_VIEW_PREPAYMENT_APPROVAL];

    var RIGHTS_FULL = [
        RIGHT_VIEW_INVOICE_CREATE,
        RIGHT_VIEW_INVOICE_APPROVAL,
        RIGHT_VIEW_PREPAYMENT_CREATE,
        RIGHT_VIEW_PREPAYMENT_APPROVAL,
        RIGHT_CREATE_PREPAYMENT,
        RIGHT_ACCOUNTING_INPUT,
        RIGHT_CHECK_1,
        RIGHT_APPROVE_1,
        RIGHT_APPROVE_2,
        RIGHT_CHECK_2,
        RIGHT_APPROVE_3
    ];

    var configs = [
        {
            key: "kttc",
            label: "KTTC tiếp nhận",
            saveField: "user.checker.kttc",
            includeRights: RIGHTS_VIEW_CREATE.concat([RIGHT_CREATE_PREPAYMENT, RIGHT_ACCOUNTING_INPUT]),
            excludeRights: [
            RIGHT_CHECK_1, 
            RIGHT_APPROVE_1, 
//            RIGHT_APPROVE_2, 
//            RIGHT_CHECK_2, 
//            RIGHT_APPROVE_3
            ],
            seedRights: [RIGHT_ACCOUNTING_INPUT],
            valueList: "$L.kttc.ids",
            displayList: "$L.kttc.names"
        },
        {
            key: "dmmsRs1",
            label: "DMMS rà soát 1",
            saveField: "user.checker.dmms",
            includeRights: RIGHTS_VIEW_APPROVAL.concat([RIGHT_CHECK_1]),
            excludeRights: [RIGHT_APPROVE_1, RIGHT_APPROVE_2, RIGHT_CHECK_2, RIGHT_APPROVE_3],
            seedRights: [RIGHT_CHECK_1],
            valueList: "$L.dmms.ids",
            displayList: "$L.dmms.rs1"
        },
        {
            key: "dmmsApproval1",
            label: "DMMS phê duyệt cấp 1",
            saveField: "user.approver.dmms",
            includeRights: RIGHTS_VIEW_APPROVAL.concat([RIGHT_APPROVE_1]),
            excludeRights: [RIGHT_APPROVE_2, RIGHT_CHECK_2, RIGHT_APPROVE_3],
            seedRights: [RIGHT_APPROVE_1],
            valueList: "$L.dmms.approval1.ids",
            displayList: "$L.dmms.approval1"
        },
        {
            key: "kttcApprove2",
            label: "KTTC phê duyệt cấp 2",
            saveField: "user.approver.kttc",
            includeRights: RIGHTS_VIEW_APPROVAL.concat([RIGHT_CHECK_1, RIGHT_APPROVE_1, RIGHT_APPROVE_2]),
            excludeRights: [RIGHT_CHECK_2, RIGHT_APPROVE_3],
            seedRights: [RIGHT_APPROVE_2],
            valueList: "$L.kttc.approve2.ids",
            displayList: "$L.kttc.approve2"
        },
        {
            key: "kttcCheck2",
            label: "KTTC rà soát 2",
            saveField: "user.checker.final",
            includeRights: RIGHTS_VIEW_APPROVAL.concat([RIGHT_CHECK_2]),
            excludeRights: [RIGHT_APPROVE_3],
            seedRights: [RIGHT_CHECK_2],
            valueList: "$L.kttc.check2.ids",
            displayList: "$L.kttc.check2"
        },
        {
            key: "approveAll",
            label: "Phê duyệt cấp có thẩm quyền",
            saveField: "user.approver.final",
            includeRights: RIGHTS_VIEW_APPROVAL.concat([RIGHT_APPROVE_3]),
            excludeRights: [],
            seedRights: [RIGHT_APPROVE_3],
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

    // Cache trong một lần load form để tránh truy vấn lặp cùng user/role/unit.
    var userRightsCache = {};
    var userScopeCache = {};
    var contactPoolCache = {};
    var contactDataCache = {};
    var orgUnitCache = {};

    var file = vars["$L.file"];
    var targetInfo = getPrepaymentTargetLv1(file);

    output.targetLv1 = targetInfo.lv1;
    output.targetLv1Source = targetInfo.source;

    if (!output.targetLv1) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được lv1 của hồ sơ tạm ứng.";
        return output;
    }

    var currentUser = normalizeValue(safeVarGet("$lo.contact.name", ""));
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
        output.message = "User đăng nhập không có phân quyền dữ liệu " + HTKT_SUB_MODULE + " trong lv1 của hồ sơ: " + output.targetLv1;
        return output;
    }

    for (var i = 0; i < configs.length; i++) {
        var config = configs[i];
        var result = loadOneComboBox(config, output.targetLv1);

        output[config.key] = result;
        output.configs.push({
            key: config.key,
            label: config.label,
            valueList: config.valueList,
            displayList: config.displayList,
            saveField: config.saveField,
            count: result.count
        });

        if (!result.success) {
            output.success = false;
        }
    }

    output.message = output.success ? "Load danh sách combobox thành công." : "Có combobox load không thành công.";
    return output;

    function clearAllComboBoxes(configs) {
        for (var i = 0; i < configs.length; i++) {
            vars[configs[i].valueList] = [];
            vars[configs[i].displayList] = [];
        }
    }

    function loadOneComboBox(config, targetLv1) {
        var result = {
            success: false,
            label: config.label,
            saveField: config.saveField,
            targetLv1: targetLv1,
            count: 0,
            ids: [],
            names: [],
            message: "",
            debug: { poolCount: 0, passedCount: 0, rejectedCount: 0 }
        };

        vars[config.valueList] = [];
        vars[config.displayList] = [];

        try {
            var contactIds = getContactsForRoleInLv1(config, targetLv1);
            result.debug.poolCount = contactIds.poolCount;
            result.debug.rejectedCount = contactIds.rejectedCount;

            var comboData = readContactData(contactIds.ids);
            if (comboData.ids.length !== comboData.names.length) {
                throw new Error(config.valueList + " và " + config.displayList + " không cùng số phần tử.");
            }

            vars[config.valueList] = comboData.ids;
            vars[config.displayList] = comboData.names;

            result.success = true;
            result.count = comboData.ids.length;
            result.ids = comboData.ids;
            result.names = comboData.names;
            result.debug.passedCount = comboData.ids.length;
            result.message = result.count > 0 ? "Load danh sách thành công." : "Không tìm thấy cán bộ phù hợp.";
        } catch (e) {
            vars[config.valueList] = [];
            vars[config.displayList] = [];
            result.success = false;
            result.message = String(e.message || e);
        }
        return result;
    }

    function getContactsForRoleInLv1(config, targetLv1) {
        var output = { ids: [], poolCount: 0, rejectedCount: 0 };
        var seedRights = normalizeArray(config.seedRights);
        var includeRights = normalizeArray(config.includeRights);
        var excludeRights = normalizeArray(config.excludeRights);

        var pool = getContactPoolByRights(seedRights.length > 0 ? seedRights : includeRights);
        pool = normalizeArray(pool);
        output.poolCount = pool.length;

        var result = [];
        for (var i = 0; i < pool.length; i++) {
            var contactId = normalizeValue(pool[i]);
            
            if (!contactId) {
                output.rejectedCount++;
                continue;
            }

            if (!contactHasRightRule(contactId, includeRights, excludeRights)) {
                output.rejectedCount++;
                continue;
            }

            if (!contactDataPermissionInLv1(contactId, targetLv1)) {
                output.rejectedCount++;
                continue;
            }
            result.push(contactId);
        }
        output.ids = normalizeArray(result);
        return output;
    }

    function getContactPoolByRights(rightIds) {
        rightIds = normalizeArray(rightIds);
        if (rightIds.length === 0) return [];

        var cacheKey = rightIds.slice(0).sort().join("|");
        if (contactPoolCache.hasOwnProperty(cacheKey)) {
            return contactPoolCache[cacheKey].slice(0);
        }

        try {
            if (lib.ESD_PERMS_RIGHTS && lib.ESD_PERMS_RIGHTS.listContactsByRights) {
                var contactsByRights = normalizeArray(
                    lib.ESD_PERMS_RIGHTS.listContactsByRights(rightIds) || []
                );
                contactPoolCache[cacheKey] = contactsByRights;
                return contactsByRights.slice(0);
            }
        } catch (e1) {}

        try {
            if (lib.ESD_PERMS_RIGHTS && lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter) {
                var contactsByFilter = normalizeArray(
                    lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(rightIds, {}) || []
                );
                contactPoolCache[cacheKey] = contactsByFilter;
                return contactsByFilter.slice(0);
            }
        } catch (e2) {}

        contactPoolCache[cacheKey] = [];
        return [];
    }

    function getCachedUserRights(contactId) {
        contactId = normalizeValue(contactId);
        if (!contactId) return [];

        if (!userRightsCache.hasOwnProperty(contactId)) {
            try {
                userRightsCache[contactId] = normalizeArray(
                    lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
                );
            } catch (e) {
                userRightsCache[contactId] = [];
            }
        }

        return userRightsCache[contactId];
    }

    function contactHasRightRule(contactId, includeRights, excludeRights) {
        var userRights = getCachedUserRights(contactId);

        var map = {};
        for (var i = 0; i < userRights.length; i++) {
            map[userRights[i]] = true;
        }

        var isFullRights = true;
        for (var f = 0; f < RIGHTS_FULL.length; f++) {
            if (!map[RIGHTS_FULL[f]]) {
                isFullRights = false;
                break;
            }
        }
        if (isFullRights) return true;

        for (var j = 0; j < includeRights.length; j++) {
            if (!map[includeRights[j]]) return false;
        }

        for (var k = 0; k < excludeRights.length; k++) {
            if (map[excludeRights[k]]) return false;
        }

        return true;
    }

    function contactDataPermissionInLv1(contactId, targetLv1) {
        var ctx = getUserScopeContext(contactId, targetLv1);
        return ctx.canAccessTargetLv1 === true;
    }

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
            return result;
        }

        var dp = null;
        try {
            dp = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(contactId, HTKT_SUB_MODULE) || {};
        } catch (e) {
            result.message = String(e.message || e);
            return result;
        }

        result.scope = normalizeValue(dp.scope || dp.dataScopeList || dp["permission.scope"] || "");
        if (!result.scope) {
            result.scope = "QT_PQDL_01";
        }

        result.rawUnits = normalizeArray(dp.unit || dp.arrUnitRights || dp.units || []);

        if (result.scope === "QT_PQDL_06") {
            result.canAccessTargetLv1 = ALLOW_GLOBAL_SCOPE_IN_COMBO === true;
            result.message = result.canAccessTargetLv1 
                ? "User có scope toàn hàng và hệ thống cho phép dùng toàn hàng." 
                : "User có scope toàn hàng nhưng nghiệp vụ đang chặn mở dữ liệu khác lv1.";
            return result;
        }

        if (result.scope === "QT_PQDL_01") {
            result.canAccessTargetLv1 = false;
            result.message = "User chỉ có scope cá nhân, không được load combobox theo lv1.";
            return result;
        }

        if (result.rawUnits.length === 0) {
            result.canAccessTargetLv1 = false;
            result.message = "User có scope đơn vị nhưng không có unit phân quyền dữ liệu.";
            return result;
        }

        result.resolvedLv1List = resolveLv1ListFromUnits(result.rawUnits);
        for (var i = 0; i < result.resolvedLv1List.length; i++) {
            if (normalizeUnitCode(result.resolvedLv1List[i]) === targetLv1) {
                result.canAccessTargetLv1 = true;
                result.message = "User có data permission 00401 trong lv1 của hồ sơ.";
                return result;
            }
        }

        result.canAccessTargetLv1 = false;
        result.message = "User không có data permission 00401 trùng lv1 của hồ sơ.";
        return result;
    }

    function getPrepaymentTargetLv1(file) {
        var result = { lv1: "", source: "" };

        var lv1 = normalizeUnitCode(safeFileGet(file, ["unit.lv1", "unit_lv1", "lv1.id", "lv1_id"]));
        if (lv1) {
            result.lv1 = lv1;
            result.source = "$L.file.unit.lv1";
            return result;
        }

        var unitId = normalizeUnitCode(safeFileGet(file, ["unit.id", "unit_id", "unit"]));
        if (unitId) {
            result.lv1 = resolveLv1FromUnit(unitId);
            result.source = "$L.file.unit.id";
            return result;
        }

        var currentContactLv1 = normalizeUnitCode(safeVarGet("$G.contacts.lv1", ""));
        if (currentContactLv1) {
            result.lv1 = currentContactLv1;
            result.source = "$G.contacts.lv1";
            return result;
        }

        var currentUnit = normalizeUnitCode(safeVarGet("$unit", ""));
        if (currentUnit) {
            result.lv1 = resolveLv1FromUnit(currentUnit);
            result.source = "$unit";
            return result;
        }

        return result;
    }

    function resolveLv1ListFromUnits(unitArr) {
        var result = [];
        var units = normalizeArray(unitArr);

        for (var i = 0; i < units.length; i++) {
            var lv1 = resolveLv1FromUnit(units[i]);
            if (lv1) {
                result.push(lv1);
            }
        }
        return normalizeArray(result);
    }

    function resolveLv1FromUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);
        if (!unitCode) return "";

        var currentUnit = unitCode;
        var seen = {};
        var maxLoop = 10;

        for (var i = 0; i < maxLoop; i++) {
            if (!currentUnit || seen[currentUnit]) return "";
            seen[currentUnit] = true;

            var detail = lookupOrgUnit(currentUnit);
            if (!detail.found) return currentUnit;
            if (isLevel1(detail.level)) return detail.unitId;
            if (detail.lv1Id) return detail.lv1Id;
            if (!detail.parentId || detail.parentId === currentUnit) return currentUnit;
            
            currentUnit = detail.parentId;
        }
        return currentUnit;
    }

    function lookupOrgUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);

        if (orgUnitCache.hasOwnProperty(unitCode)) {
            return orgUnitCache[unitCode];
        }

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

        if (!unitCode) return result;
        var f = null;
        try {
            f = new SCFile("esdQTorgUnit", SCFILE_READONLY);
            var rc = f.doSelect('unit.id="' + escapeQueryValue(unitCode) + '"');
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
                if (f) f.doClose();
            } catch (eClose) {}
        }

        orgUnitCache[unitCode] = result;
        return result;
    }

    function isLevel1(level) {
        level = normalizeValue(level);
        return level.indexOf("lv1") === 0;
    }

    function readContactData(contactIds) {
        var ids = normalizeArray(contactIds);
        var cacheKey = ids.slice(0).sort().join("|");
        var data = { ids: [], names: [] };

        if (ids.length === 0) return data;

        if (contactDataCache.hasOwnProperty(cacheKey)) {
            return {
                ids: contactDataCache[cacheKey].ids.slice(0),
                names: contactDataCache[cacheKey].names.slice(0)
            };
        }

        var conditions = [];
        for (var i = 0; i < ids.length; i++) {
            conditions.push('contact.name="' + escapeQueryValue(ids[i]) + '"');
        }

        var rows = [];
        var seen = {};
        var contactFile = null;

        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);
            contactFile.setFields(["contact.name", "full.name", "position", "status"]);
            
            var rc = contactFile.doSelect("(" + conditions.join(" or ") + ")");
            while (rc === RC_SUCCESS) {
                var contactId = normalizeValue(contactFile["contact.name"]);
                var status = normalizeValue(contactFile["status"]);

                if (contactId && !seen[contactId] && (!status || status === "Dang hoat dong")) {
                    seen[contactId] = true;
                    var fullName = normalizeValue(contactFile["full.name"]);
                    var position = normalizeValue(contactFile["position"]);
                    var display = "";

                    if (fullName && position) {
                        display = fullName + " - " + position;
                    } else if (fullName) {
                        display = fullName;
                    } else {
                        display = contactId;
                    }

                    rows.push({ id: contactId, display: display });
                }
                rc = contactFile.getNext();
            }
        } finally {
            try {
                if (contactFile) contactFile.doClose();
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

    function normalizeValue(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeArray(source) {
        var array = source || [];
        var result = [];
        var seen = {};

        try {
            if (array.toArray) array = array.toArray();
        } catch (eToArray) {
            array = [];
        }

        if (!array || typeof array.length === "undefined") return result;

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
        if (!s) return "";
        s = s.replace(/\.0$/, "");
        
        if (/^[0-9]+$/.test(s) && s.length === 8) {
            s = "0" + s;
        }
        return s;
    }

    function escapeQueryValue(value) {
        return normalizeValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function safeFileGet(file, fields) {
        if (!file || !fields) return "";

        for (var i = 0; i < fields.length; i++) {
            try {
                var value = file[fields[i]];
                if (value != null && value !== "") return String(value).trim();
            } catch (e1) {}

            try {
                var alt = fields[i].replace(/\./g, "_");
                var value2 = file[alt];
                if (value2 != null && value2 !== "") return String(value2).trim();
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