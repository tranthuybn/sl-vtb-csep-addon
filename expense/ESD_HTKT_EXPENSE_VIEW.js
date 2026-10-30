/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VIEW
 * Module        : HTKT - De nghi du chi
 *
 * Khoi tao context cho man hinh danh sach Du chi theo cung contract initData
 * voi man hinh Thanh toan, bao gom ca pham vi du lieu cua role Hau kiem.
 */

function htktExpenseView_escapeQueryValue(value) {
    return (value == null ? "" : String(value))
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function htktExpenseView_uniqueArray(source) {
    var values = source || [];
    var result = [];
    var seen = {};

    try {
        if (values.toArray) {
            values = values.toArray();
        }
    } catch (eToArray) {
        values = [];
    }

    for (var i = 0; i < values.length; i++) {
        var value = String(values[i] == null ? "" : values[i]).replace(/^\s+|\s+$/g, "");
        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }

    return result;
}

function htktExpenseView_readContact(currentUser) {
    var result = {
        fullName: "",
        branchCode: "",
        lv1: "",
        lv2: "",
        lv3: "",
        orgUnit: "",
        position: "",
        positionName: ""
    };
    var contactFile = null;

    if (!currentUser) {
        return result;
    }

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect(
            'contact.name="' + htktExpenseView_escapeQueryValue(currentUser) + '"'
        );

        if (rcContact == RC_SUCCESS) {
            result.fullName = contactFile["full.name"] || contactFile["contact.full.name"] || contactFile["contact.name"] || "";
            result.branchCode = contactFile["branch.code"] || contactFile.branch_code || "";
            result.lv1 = contactFile["lv1.id"] || contactFile.lv1_id || "";
            result.lv2 = contactFile["lv2.id"] || contactFile.lv2_id || "";
            result.lv3 = contactFile["lv3.id"] || contactFile.lv3_id || "";
            result.orgUnit = contactFile["org.unit"] || contactFile.org_unit || "";
            result.position = contactFile.position || "";
            result.positionName = contactFile["position.name"] || contactFile.position_name || "";
        }
    } catch (eContact) {
        return result;
    } finally {
        if (contactFile) {
            try {
                contactFile.doClose();
            } catch (eCloseContact) {}
        }
    }

    return result;
}

function htktExpenseView_getRights() {
    var rights = [];

    try {
        rights = vars['$G.rights'] ? vars['$G.rights'].toArray() : [];
    } catch (eRights) {
        rights = [];
    }

    return htktExpenseView_uniqueArray(rights);
}

function htktExpenseView_getDataPermission(currentUser) {
    var result = {
        scope: "QT_PQDL_01",
        unit: []
    };

    try {
        var permission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(currentUser, "00401") || {};
        result.scope = String(
            permission.scope ||
            permission.dataScopeList ||
            permission["permission.scope"] ||
            "QT_PQDL_01"
        ).replace(/^\s+|\s+$/g, "");
        result.unit = htktExpenseView_uniqueArray(
            permission.unit || permission.arrUnitRights || permission.units || []
        );
    } catch (eDataPermission) {}

    return result;
}

function htktExpenseView_buildRelatedUserFilter(currentUser, hasView) {
    if (!hasView || !currentUser) {
        return "(1=0)";
    }

    var fields = [
        "created.by",
        "user.checker.kttc",
        "user.checker.dmms",
        "user.approver.dmms",
        "user.approver.kttc",
        "user.checker.final",
        "user.approver.final"
    ];
    var conditions = [];

    for (var i = 0; i < fields.length; i++) {
        conditions.push(fields[i] + '="' + htktExpenseView_escapeQueryValue(currentUser) + '"');
    }

    return "(" + conditions.join(" OR ") + ")";
}


/** Lãnh đạo xem sớm theo cùng Data Permission và initial.role như Thanh toán. */
function htktExpenseView_buildLeadershipFilter(currentUser, isApprovalDmms, isApprovalKttc, dataPermission) {
    if (!currentUser || (!isApprovalDmms && !isApprovalKttc)) return "";

    var permissionQuery = "";
    try {
        permissionQuery = lib.ESD_HTKT_PAYMENT_VIEW.buildHTKTCommonPermissionQuery(
                dataPermission.scope, dataPermission.unit,
                ["unit.lv1", "unit.lv2", "unit.lv3"], "created.by", currentUser
        );
    } catch (ePermissionQuery) {
        return "";
    }
    permissionQuery = String(permissionQuery || "").trim();
    if (!permissionQuery || permissionQuery === "false" || permissionQuery === "(1=0)") return "";

    var initialRoleClause = isApprovalKttc
            ? '(initial.role="dmms" OR initial.role="kttc")'
            : 'initial.role="dmms"';
    return permissionQuery === "true" ? "(" + initialRoleClause + ")"
            : "((" + permissionQuery + ") AND (" + initialRoleClause + "))";
}


function htktExpenseView_buildLeadershipFilter(currentUser, isApprovalDmms, isApprovalKttc, dataPermission) {
    if (!currentUser || (!isApprovalDmms && !isApprovalKttc)) {
        return "";
    }

    // Reuse the common HTKT data-permission query; leadership does not require assignment.
    var permissionQuery = "";
    try {
        permissionQuery = lib.ESD_HTKT_PAYMENT_VIEW.buildHTKTCommonPermissionQuery(
            dataPermission.scope,
            dataPermission.unit,
            ["unit.lv1", "unit.lv2", "unit.lv3"],
            "created.by",
            currentUser
        );
    } catch (eLeadershipPermission) {}

    permissionQuery = String(permissionQuery || "").replace(/^\s+|\s+$/g, "");
    if (!permissionQuery || permissionQuery === "false" || permissionQuery === "(1=0)") {
        return "";
    }

    var initialRoleClause = isApprovalKttc
        ? '(initial.role="dmms" OR initial.role="kttc")'
        : 'initial.role="dmms"';

    return permissionQuery === "true"
        ? "(" + initialRoleClause + ")"
        : "((" + permissionQuery + ") AND (" + initialRoleClause + "))";
}


//function htktExpenseView_buildLeadershipScope(currentUser, isApprovalDmms, isApprovalKttc, contactInfo) {
//    var result = {
//        defaultFilter: "(1=0)",
//        dataScope: "Khong co quyen xem",
//        dataScopeCode: "HTKT_EXPENSE_LEADERSHIP_LV1",
//        dataScopeField: "unit.lv1",
//        dataScopeUnits: []
//    };
//    var lv1 = String(contactInfo && contactInfo.lv1 || "").replace(/^\s+|\s+$/g, "");
//    if (!currentUser || (!isApprovalDmms && !isApprovalKttc) || !lv1) {
//        return result;
//    }
//
//    // Same organization domain as ESD_HTKT_PAYMENT_LIST: TSC entity or the current branch LV1.
//    if (htktExpenseView_getActiveEntityCodeByPsCode(lv1) === "1010098") {
//        result.dataScopeUnits = htktExpenseView_getActivePsCodesByEntityCode("1010098", "");
//        result.dataScope = "Tru so chinh - Lanh dao DMMS/KTTC";
//    } else {
//        result.dataScopeUnits = [lv1];
//        result.dataScope = "Chi nhanh - Lanh dao DMMS/KTTC";
//    }
//
//    if (result.dataScopeUnits.length > 0) {
//        // NextJS applies the LV1 scope in short REST queries, as in the Payment list.
//        result.leadershipFilter = isApprovalKttc
//            ? '(initial.role="dmms" OR initial.role="kttc")'
//            : 'initial.role="dmms"';
//        var unitConditions = [];
//        for (var i = 0; i < result.dataScopeUnits.length; i++) {
//            unitConditions.push('unit.lv1="' + htktExpenseView_escapeQueryValue(result.dataScopeUnits[i]) + '"');
//        }
//        // Keep the full scope for older addon builds that only understand defaultFilter.
//        result.defaultFilter = "((" + unitConditions.join(" OR ") + ") AND (" + result.leadershipFilter + "))";
//    }
//    return result;
//}

/** Phạm vi danh sách cho lãnh đạo ĐMMS/KTTC, không yêu cầu phân giao trên phiếu. */
function htktExpenseView_buildLeadershipScope(currentUser, isApprovalDmms, isApprovalKttc, contactInfo) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "HTKT_EXPENSE_LEADERSHIP_LV1",
        dataScopeField: "unit.lv1",
        dataScopeUnits: []
    };
    var lv1 = String(contactInfo && contactInfo.lv1 || "").replace(/^\s+|\s+$/g, "");
    if (!currentUser || (!isApprovalDmms && !isApprovalKttc) || !lv1) {
        return result;
    }

    var currentEntityCode = htktExpenseView_getActiveEntityCodeByPsCode(lv1);
    if (!currentEntityCode) return result;
    if (currentEntityCode === "1010098") {
        result.defaultFilter = 'entity.code="1010098"';
        result.dataScope = "Tru so chinh - Lanh dao DMMS/KTTC";
        result.dataScopeField = "entity.code";
        result.dataScopeUnits = ["1010098"];
    } else {
        result.defaultFilter = 'entity.code="' + htktExpenseView_escapeQueryValue(currentEntityCode) + '"';
        result.dataScope = "Chi nhanh - Lanh dao DMMS/KTTC";
        result.dataScopeField = "entity.code";
        result.dataScopeUnits = [currentEntityCode];
    }
    return result;
}

function htktExpenseView_getActiveEntityCodeByPsCode(psCode) {
    var safePsCode = String(psCode || "").replace(/^\s+|\s+$/g, "");
    var entityFile = null;
    var entityCodes = [];

    if (!safePsCode) {
        return "";
    }

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'ps.code="' + htktExpenseView_escapeQueryValue(safePsCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var entityCode = String(entityFile["entity.code"] || "").replace(/^\s+|\s+$/g, "");
            if (entityCode && entityCodes.indexOf(entityCode) < 0) {
                entityCodes.push(entityCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (eEntity) {
        return "";
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eCloseEntity) {}
        }
    }

    return entityCodes.length === 1 ? entityCodes[0] : "";
}

function htktExpenseView_getActivePsCodesByEntityCode(entityCode, psPrefix) {
    var safeEntityCode = String(entityCode || "").replace(/^\s+|\s+$/g, "");
    var safePrefix = String(psPrefix || "").replace(/^\s+|\s+$/g, "");
    var entityFile = null;
    var result = [];

    if (!safeEntityCode) {
        return result;
    }

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'entity.code="' + htktExpenseView_escapeQueryValue(safeEntityCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var psCode = String(entityFile["ps.code"] || "").replace(/^\s+|\s+$/g, "");
            if (psCode && (!safePrefix || psCode.indexOf(safePrefix) === 0) && result.indexOf(psCode) < 0) {
                result.push(psCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (ePsCode) {
        return [];
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eClosePsCode) {}
        }
    }

    return result;
}

function htktExpenseView_buildPostAuditFilter(contactInfo, dataPermission) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "",
        dataScopeField: "unit.lv1",
        dataScopeUnits: []
    };
    var scope = dataPermission ? dataPermission.scope : "";

    if (scope === "QT_PQDL_06") {
        result.defaultFilter = "true";
        result.dataScope = "Toan hang - Hau kiem";
        result.dataScopeCode = "QT_PQDL_06";
        result.dataScopeField = "ALL";
        return result;
    }

    if (scope !== "QT_PQDL_04") {
        return result;
    }

    var lv1 = String(contactInfo && contactInfo.lv1 || "").replace(/^\s+|\s+$/g, "");
    result.dataScope = "Khoi/CN/DVSN - Hau kiem";
    result.dataScopeCode = "QT_PQDL_04";

    if (!lv1) {
        return result;
    }

    var HEAD_OFFICE_OGL_SEG1 = "1010098";
    var currentEntityCode = htktExpenseView_getActiveEntityCodeByPsCode(lv1);
    if (!currentEntityCode) return result;

    if (currentEntityCode === HEAD_OFFICE_OGL_SEG1) {
        // Trụ sở chính lọc trực tiếp entity của phiếu, không liệt kê từng LV1.
        result.defaultFilter = 'entity.code="1010098"';
        result.dataScope = "Tru so chinh - Hau kiem";
        result.dataScopeField = "entity.code";
        result.dataScopeUnits = [HEAD_OFFICE_OGL_SEG1];
        return result;
    }

    result.defaultFilter = 'entity.code="' + htktExpenseView_escapeQueryValue(currentEntityCode) + '"';
    result.dataScopeField = "entity.code";
    result.dataScopeUnits = [currentEntityCode];
    return result;
}




// ======================================================================================
// ======================================================================================
// ======================================================================================


function renderExpenseList() {
    var currentUser = String(vars['$lo.contact.name'] || "").replace(/^\s+|\s+$/g, "");
    var operatorName = String(system.user.name || "").replace(/^\s+|\s+$/g, "");
    var contactInfo = htktExpenseView_readContact(currentUser);
    var rights = htktExpenseView_getRights();

    var RIGHT_EXPENSE_VIEW = "0040040004000001";
    var RIGHT_EXPENSE_VIEW_APPROVAL = "0040040004000009";
    var RIGHT_EXPENSE_CREATE = "0040040004000002";
    var RIGHT_EXPENSE_ACCOUNTING = "0040040004000003";
    var RIGHT_EXPENSE_APPROVE_DMMS = "0040040004000005";
    var RIGHT_EXPENSE_APPROVE_KTTC = "0040040004000006";
    var RIGHT_EXPENSE_POST_AUDIT = "0040040004000010";
    
    var isApprovalDmms = rights.indexOf(RIGHT_EXPENSE_APPROVE_DMMS) >= 0;
    var isApprovalKttc = rights.indexOf(RIGHT_EXPENSE_APPROVE_KTTC) >= 0;

    var hasView = rights.indexOf(RIGHT_EXPENSE_VIEW) >= 0 ||
                  rights.indexOf(RIGHT_EXPENSE_VIEW_APPROVAL) >= 0;
//    var hasView = rights.indexOf(RIGHT_EXPENSE_VIEW) >= 0 ||
//                  rights.indexOf(RIGHT_EXPENSE_VIEW_APPROVAL) >= 0 ||
//                  isApprovalDmms || isApprovalKttc;             
    var hasCreate = rights.indexOf(RIGHT_EXPENSE_CREATE) >= 0;
    var hasAccounting = rights.indexOf(RIGHT_EXPENSE_ACCOUNTING) >= 0;
    var isPostAuditRole = rights.indexOf(RIGHT_EXPENSE_POST_AUDIT) >= 0;
    var initialRole = "";

    if (hasCreate) {
        initialRole = hasAccounting ? "kttc" : "dmms";
    }

    var dataPermission = htktExpenseView_getDataPermission(currentUser);
    var relatedUserFields = "created.by+user.checker.kttc+user.checker.dmms+user.approver.dmms+user.approver.kttc+user.checker.final+user.approver.final";
    var dataFilterInfo;

    if (isPostAuditRole) {
        dataFilterInfo = htktExpenseView_buildPostAuditFilter(contactInfo, dataPermission);
        dataPermission = {
            scope: dataFilterInfo.dataScopeCode,
            unit: dataFilterInfo.dataScopeUnits
        };
    } else if (isApprovalDmms || isApprovalKttc) {
        dataFilterInfo = htktExpenseView_buildLeadershipScope(
            hasView ? currentUser : "", isApprovalDmms, isApprovalKttc, contactInfo
        );
    } else {
        dataFilterInfo = {
            defaultFilter: htktExpenseView_buildRelatedUserFilter(currentUser, hasView),
            dataScope: "Nguoi tao hoac nguoi duoc giao xu ly",
            dataScopeCode: "HTKT_EXPENSE_RELATED_USER",
            dataScopeField: relatedUserFields,
            dataScopeUnits: currentUser ? [currentUser] : []
        };

//        var leadershipFilter = htktExpenseView_buildLeadershipFilter(
//            currentUser, isApprovalDmms, isApprovalKttc, dataPermission
//        );
//        if (leadershipFilter) {
//            dataFilterInfo.defaultFilter = "(" + dataFilterInfo.defaultFilter + " OR " + leadershipFilter + ")";
//            dataFilterInfo.dataScope = "Nguoi lien quan hoac lanh dao DMMS/KTTC trong pham vi Data Permission";
//            dataFilterInfo.dataScopeCode = "HTKT_EXPENSE_RELATED_USER_WITH_LEADERSHIP";
//            dataFilterInfo.dataScopeField = relatedUserFields + "+initial.role+unit.lv1+unit.lv2";
//            dataFilterInfo.dataScopeUnits = dataPermission.scope === "QT_PQDL_01"
//                ? [currentUser] : dataPermission.unit;
//        }
    }

    var defaultFilter = dataFilterInfo.defaultFilter;
    defaultFilter = '(' + defaultFilter + ') AND status ~= "cancelled"';

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/DuChi/DanhSachDuChi',
        '',
        {
            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,
            initialRole: initialRole,
            operatorName: operatorName,
            fullName: contactInfo.fullName,
            branchCode: contactInfo.branchCode,
            entityCode: htktExpenseView_getActiveEntityCodeByPsCode(contactInfo.lv1),
            unit: {
                lv1: contactInfo.lv1,
                lv2: contactInfo.lv2,
                lv3: contactInfo.lv3,
                orgUnit: contactInfo.orgUnit,
                position: contactInfo.position,
                positionName: contactInfo.positionName
            },
            defaultFilter: defaultFilter,
            permissionQuery: defaultFilter,
//            leadershipFilter: dataFilterInfo.leadershipFilter || "",
            dataScope: dataFilterInfo.dataScope,
            dataScopeCode: dataFilterInfo.dataScopeCode,
            dataScopeField: dataFilterInfo.dataScopeField,
            dataScopeUnits: dataFilterInfo.dataScopeUnits,
            dataPermissionSubModule: "00401",
            dataPermission: dataPermission,
            rights: rights,
            permission: {
                view: isPostAuditRole ? true : hasView,
                create: hasCreate,
                accounting: hasAccounting,
                postAudit: isPostAuditRole
            },
            btnConfig: [
                { id: 'create', visible: hasCreate },
                { id: 'accounting', visible: hasAccounting }
            ],
            debugSource: "ESD_HTKT_EXPENSE_VIEW"
        }
    );
}

/**
 * Check quyen Tab Hóa đơn dành cho KTTC trở đi, theo quyền của người đang đăng nhập.
 */
function canShowAttachmentTab(currentUser) {
    if (!String(currentUser || "").replace(/^\s+|\s+$/g, "")) {
        return false;
    }

    var rights = htktExpenseView_getRights();
    return (
        rights.indexOf("0040040004000003") >= 0 || // KTTC tiếp nhận/hạch toán Dự chi
        rights.indexOf("0040040004000006") >= 0 || // Phê duyệt KTTC Dự chi
        rights.indexOf("0040040004000007") >= 0 || // Rà soát KTTC Dự chi (Rà soát 2)
        rights.indexOf("0040040004000008") >= 0    // Cấp có thẩm quyền Dự chi
    );
}

/**
 * Tab Hóa đơn (Chỉ hiện tab đối với role KTTC trở đi)
 */
function getTabHoaDon() {
    var currentRecord = {};
    if (vars.$L_file) {
        var prepaymentId = vars.$L_file["id"];
        var contractId = vars.$L_file["contract.id"] || "";

        if (!contractId && prepaymentId) {
            var prepFile = new SCFile("esdHTKTpayment");
            var sqlPrep = "id=\"" + prepaymentId + "\"";
            var rcPrep = prepFile.doSelect(sqlPrep);

            if (rcPrep == RC_SUCCESS) {
                contractId = prepFile["contract.id"] || "";
            }
        }

        currentRecord = {
            "id": prepaymentId || "",
            "contractId": contractId,
            "vendorId": vars.$L_file["vendor.id"] || "",
            "currentPhase": vars.$L_file["current.phase"],
            "initialRole": vars.$L_file["initial.role"],
            "userCheckerKttc": vars.$L_file["user.checker.kttc"],
            "userCheckerDmms": vars.$L_file["user.checker.dmms"],
            "userApproverKttc": vars.$L_file["user.approver.kttc"],
            "userApproverDmms": vars.$L_file["user.approver.dmms"],
            "userCheckerFinal": vars.$L_file["user.checker.final"],
            "userApproverFinal": vars.$L_file["user.approver.final"],
            "createdBy": vars.$L_file["created.by"],
            "currentUser": vars['$lo.contact.name'],
            "status": vars.$L_file["status"]
        };
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabTaiLieuDinhKem', '', currentRecord);
}

function getTabKetQuaHachToan() {
    return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT.renderTabAccountingResults();
}


function getTabKetQuaGD() {
    return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT.renderTabAccountingResults();
}

//Dung cho tab tài liệu đính kèm của NCC
function renderTabTaiLieuDinhKemNCC(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var paymentId = vars.$L_file["payment.id"];
            var currentPhase = vars.$L_file["current.phase"];
            var initialRole = vars.$L_file["initial.role"];
            var userCheckerKttc = vars.$L_file["user.checker.kttc"];
            var userCheckerDmms = vars.$L_file["use.checker.dmms"];
            //
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var userApproverDmms = vars.$L_file["user.approver.dmms"];
            var userCheckerFinal = vars.$L_file["user.checker.final"];
            var userApproverFinal = vars.$L_file["user.approver.final"];
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var createdBy = vars.$L_file["created.by"];

            var status = vars.$L_file["status"];

            if ((!currentPhase || !initialRole) && paymentId) {
                var prepFile = new SCFile("esdHTKTpayment");
                var sqlPrep = "id=\"" + paymentId + "\"";
                var rcPrep = prepFile.doSelect(sqlPrep);

                if (rcPrep == RC_SUCCESS) {
                    if (!currentPhase && prepFile["current.phase"]) {
                        currentPhase = prepFile["current.phase"];
                    }
                    if (!initialRole && prepFile["initial.role"]) {
                        initialRole = prepFile["initial.role"];
                    }
                    if (!userCheckerKttc && prepFile["user.checker.kttc"]) {
                        userCheckerKttc = prepFile["user.checker.kttc"];
                    }
                    if (!userCheckerDmms && prepFile["use.checker.dmms"]) {
                        userCheckerDmms = prepFile["use.checker.dmms"];
                    }
                    //
                    if (!userApproverKttc && prepFile["user.approver.kttc"]) {
                        userApproverKttc = prepFile["user.approver.kttc"];
                    }
                    if (!userApproverDmms && prepFile["user.approver.dmms"]) {
                        userApproverDmms = prepFile["user.approver.dmms"];
                    }
                    if (!userCheckerFinal && prepFile["user.checker.final"]) {
                        userCheckerFinal = prepFile["user.checker.final"];
                    }
                    if (!userApproverFinal && prepFile["user.approver.final"]) {
                        userApproverFinal = prepFile["user.approver.final"];
                    }
                    if (!createdBy && prepFile["created.by"]) {
                        createdBy = prepFile["created.by"];
                    }
                    if (!status && prepFile["status"]) {
                        status = prepFile["status"];
                    }
                }
            }

            // Gán dữ liệu vào currentRecord
            currentRecord = {
                "id": vars.$L_file["id"],
                "payment.id": paymentId,
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"],
                "currentPhase": currentPhase,
                "initialRole": initialRole,
                "userCheckerKttc": userCheckerKttc,
                "userCheckerDmms": userCheckerDmms,

                "userApproverKttc": userApproverKttc,
                "userApproverDmms": userApproverDmms,
                "userCheckerFinal": userCheckerFinal,
                "userApproverFinal": userApproverFinal,
                "createdBy": createdBy,

                "status": status,
                "currentUser": vars['$lo.contact.name']
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabThongTinMonDuChi/TabTaiLieuDinhKem', '', currentRecord);
}

//Dung cho tab thong tin cong no của NCC
function renderTabLiabilityInfo(endpoint, input, extraData) {
    var currentRecord = extraData;

    // 1. Kiểm tra và khởi tạo object nếu extraData trống
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "payment.id": vars.$L_file["payment.id"],
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"]
            };
        } else {
            currentRecord = {};
        }
    }

    // 2. Thêm query lấy contract.id dựa vào payment.id nếu contract.id chưa có giá trị

    var paymentId = currentRecord["payment.id"] || vars.$L_file["payment.id"];
    if (paymentId && !currentRecord["contract.id"]) {
        var paymentRec = new SCFile("esdHTKTpayment");
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "paymentId": paymentId,
                "contractId": paymentRec["contract.id"],
                "vendorId": vars.$L_file["vendor.id"],
                "currentPhase": paymentRec["current.phase"],
                "initialRole": paymentRec["initial.role"],
                "createdBy": paymentRec["created.by"],
                "userCheckerDmms": paymentRec["user.checker.dmms"],
                "userCheckerKttc": paymentRec["user.checker.kttc"],
                "userApproverKttc": paymentRec["user.approver.kttc"],
                "userApproverDmms": paymentRec["user.approver.dmms"],
                "userCheckerFinal": paymentRec["user.checker.final"],
                "userApproverFinal": paymentRec["user.approver.final"],
                "currentUser": vars['$lo.contact.name'],
                "status": paymentRec["status"]
            };
        }
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS("HachToanKeToan/DuChi/TabThongTinMonDuChi/TabThongTinCongNo", '', currentRecord);
}


/**
 * Render tab Thông tin hạch toán
 */
function getTabThongTinHT(endpoint, input, extraData) {
    var formRecord = vars['$L.file'];
    var currentRecord = extraData || {};

    if (
            (!currentRecord || Object.keys(currentRecord).length === 0) &&
            formRecord
    ) {
        currentRecord = formRecord;
    }

    var paymentId = currentRecord ? String(currentRecord['id'] || '') : '';
    var currentUser = String(vars['$lo.contact.name'] || '').trim();
    var currentPhase = formRecord ? String(formRecord['current.phase'] || '').trim() : '';
    var userCheckerKttc = formRecord ? String(formRecord['user.checker.kttc'] || '').trim() : '';
    var initialRole = formRecord ? String(formRecord['initial.role'] || '').trim() : '';
    var createdBy = formRecord ? String(formRecord['created.by'] || '').trim() : '';

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
            'HachToanKeToan/DuChi/TabThongTinHachToan',
            '', {
                id: paymentId,
                paymentId: paymentId,
                user: currentUser,
                currentUser: currentUser,
                contactId: currentUser,
                createdBy: createdBy,
                currentPhase: currentPhase,
                userCheckerKttc: userCheckerKttc,
                initialRole: initialRole,
                currentRecord: {
                    id: paymentId,
                    currentPhase: currentPhase,
                    userCheckerKttc: userCheckerKttc,
                    initialRole: initialRole
                }
            }
    );
}


/**
 * Render tab Chi tiết thông tin hạch toán
 */
function getTabChiTietThongTinHT(endpoint, input, extraData) {
    var formRecord = vars['$L.file'];
    var currentRecord = extraData || {};

    if (
            (!currentRecord || Object.keys(currentRecord).length === 0) &&
            formRecord
    ) {
        currentRecord = formRecord;
    }

    var paymentId = vars.$G_payment_id;
    if (paymentId) {
        var paymentRec = new SCFile("esdHTKTpayment");
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord = {
                "paymentId": paymentId,
                "currentPhase": paymentRec["current.phase"],
                "initialRole": paymentRec["initial.role"],
                "createdBy": paymentRec["created.by"],
                "userCheckerDmms": paymentRec["user.checker.dmms"],
                "userCheckerKttc": paymentRec["user.checker.kttc"],
                "userApproverKttc": paymentRec["user.approver.kttc"],
                "userApproverDmms": paymentRec["user.approver.dmms"],
                "userCheckerFinal": paymentRec["user.checker.final"],
                "userApproverFinal": paymentRec["user.approver.final"],
                "currentUser": vars['$lo.contact.name'],
                "status": paymentRec["status"]
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabThongTinHachToan/ChiTietHachToan', '', currentRecord)
}

/**
 * Render tab Thông tin món Dự chi cho phiếu đang mở.
 * Ngoài id phiếu, tab cần cùng context người dùng/phạm vi dữ liệu như màn
 * danh sách để API listPurchaseContracts áp dụng đúng role và data scope.
 */
function getTabThongTinMonDuChi(endpoint, input, extraData) {
    var currentRecord = extraData || {};
    var expenseRecord = vars["$L.file"] || vars.$L_file;
    var loadedExpenseFile = null;
    var expenseId = String(currentRecord.id || "").replace(/^\s+|\s+$/g, "");

    if (!expenseId && expenseRecord) {
        expenseId = String(expenseRecord["id"] || "").replace(/^\s+|\s+$/g, "");
    }

    // Luôn tải lại theo id để quyền sửa dùng phase mới nhất trong database.
    // $L.file có thể vẫn giữ phase cũ sau khi hồ sơ vừa chuyển bước workflow.
    if (expenseId) {
        var expenseFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (expenseFile.doSelect('id="' + expenseId.replace(/"/g, '\\"') + '"') == RC_SUCCESS) {
            expenseRecord = expenseFile;
            loadedExpenseFile = expenseFile;
        }
    }

    vars.$G_payment_id = expenseId;

    var currentUser = String(vars['$lo.contact.name'] || "").replace(/^\s+|\s+$/g, "");
    var operatorName = String(system.user.name || "").replace(/^\s+|\s+$/g, "");
    var contactInfo = htktExpenseView_readContact(currentUser);
    var rights = htktExpenseView_getRights();
    var hasCreate = rights.indexOf("0040040004000002") >= 0;
    var hasAccounting = rights.indexOf("0040040004000003") >= 0;
    var roleFromRights = hasCreate ? (hasAccounting ? "kttc" : "dmms") : "";
    var currentPhase = String(
        (expenseRecord && (expenseRecord["current.phase"] || expenseRecord.current_phase)) ||
        currentRecord.currentPhase || currentRecord["current.phase"] || ""
    ).replace(/^\s+|\s+$/g, "");
    var initialRole = String(
        (expenseRecord && (expenseRecord["initial.role"] || expenseRecord.initial_role)) ||
        currentRecord.initialRole || currentRecord["initial.role"] || roleFromRights || ""
    ).replace(/^\s+|\s+$/g, "");
    var createdBy = String(
        (expenseRecord && (expenseRecord["created.by"] || expenseRecord.created_by)) ||
        currentRecord.createdBy || currentRecord["created.by"] || ""
    ).replace(/^\s+|\s+$/g, "");
    var userCheckerKttc = String(
        (expenseRecord && expenseRecord["user.checker.kttc"]) || ""
    ).replace(/^\s+|\s+$/g, "");
    var contractCategory = String(
        (expenseRecord && expenseRecord["original.contract.category"]) || "HHDV"
    ).replace(/^\s+|\s+$/g, "").toUpperCase();
    try {
        if (loadedExpenseFile) loadedExpenseFile.doClose();
    } catch (eCloseExpenseFile) {}
    var isVendorEditable =
        (currentPhase == "initial_dmms" && createdBy == currentUser) ||
        (currentPhase == "initial_kttc" && initialRole == "kttc");
    var dataPermission = htktExpenseView_getDataPermission(currentUser);

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/DuChi/TabThongTinMonDuChi',
        expenseId ? '?id=' + encodeURIComponent(expenseId) : '',
        {
            id: expenseId,
            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,
            operatorName: operatorName,
            fullName: contactInfo.fullName,
            branchCode: contactInfo.branchCode,
            initialRole: initialRole,
            currentPhase: currentPhase,
            createdBy: createdBy,
            userCheckerKttc: userCheckerKttc,
            isVendorEditable: isVendorEditable,
            unit: {
                lv1: contactInfo.lv1,
                lv2: contactInfo.lv2,
                lv3: contactInfo.lv3,
                orgUnit: contactInfo.orgUnit,
                position: contactInfo.position,
                positionName: contactInfo.positionName
            },
            dataScope: dataPermission.scope,
            dataScopeCode: dataPermission.scope,
            dataScopeUnits: dataPermission.unit,
            dataPermissionSubModule: "00401",
            dataPermission: dataPermission,
            rights: rights
        }
    );
}
// ======================================================================================
// ======================================================================================
// ======================================================================================

/** Moc thoi gian UTC o day bieu dien gio lich SM, khong phu thuoc timezone trinh duyet. */
function htktExpenseView_workingMilliseconds(from, to, hours, holidays) {
    var sign = to < from ? -1 : 1;
    var start = Math.min(from, to);
    var end = Math.max(from, to);
    var date = new Date(start);
    var day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    var total = 0;
    while (day < end) {
        date = new Date(day);
        var key = date.getUTCFullYear() + '-' + (date.getUTCMonth() + 1) + '-' + date.getUTCDate();
        if (!holidays[key]) {
            var shifts = hours[date.getUTCDay()] || [];
            for (var i = 0; i < shifts.length; i++) {
                total += Math.max(0, Math.min(end, day + shifts[i][1]) - Math.max(start, day + shifts[i][0]));
            }
        }
        day += 86400000;
    }
    return sign * total;
}

/** HTML Viewer: SLA cua phieu dang mo, lan do moi nhat. */
function renderInfor(endpoint, input, extraData) {
    // HTML Viewer: Input = id. Nhan ca gia tri SM va ban ghi chua truong id.
    function readPaymentId(value) {
        if (value == null) return '';
        if (typeof value === 'object' && value['id']) value = value['id'];
        if (value && typeof value.getText === 'function') value = value.getText();
        var text = String(value).replace(/^\s+|\s+$/g, '');
        return /^(DC|TT|TU)\./i.test(text) ? text : '';
    }

    var formRecord = vars['$L.file'] || vars.$L_file;
    var paymentId = readPaymentId(input) || readPaymentId(endpoint) ||
        readPaymentId(extraData) || readPaymentId(formRecord) || readPaymentId(vars.$G_payment_id);
    var selectCode = '';
    var tracking = null;
    var requestFile = null;
    var hasActiveSla = false;
    var workingFile = null;
    var holidayFile = null;
    var workingHours = [[], [], [], [], [], [], []];
    var holidays = {};
    var referenceMs = null;
    var dueMs = null;
    var overdue = false;
    var status = 'Chưa tính';
    var dueAt = null;
    var endedAt = null;
    var remainingMs = null;
    var running = false;
    var color = '#94a3b8';
    var background = '#f1f5f9';

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function readDate(value) {
        if (!value) return null;
        // Chuoi ngay theo dinh dang hien thi SM khong parse duoc bang Date() tren moi engine.
        var parts = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        var date = typeof value.JSDate === 'function' ? value.JSDate()
            : (typeof value.getTime === 'function' ? new Date(value.getTime())
                : (parts ? new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]),
                    Number(parts[4] || 0), Number(parts[5] || 0), Number(parts[6] || 0)) : new Date(String(value))));
        return date && isFinite(date.getTime()) ? date : null;
    }

    function pad(value) {
        return value < 10 ? '0' + value : String(value);
    }

    function wallTime(value) {
        return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(),
            value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds());
    }

    function readShiftTime(value) {
        var parts = String(value || '').replace(/^\s+|\s+$/g, '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!parts || Number(parts[1]) > 24 || Number(parts[2]) > 59 || Number(parts[3] || 0) > 59 ||
                (Number(parts[1]) === 24 && (Number(parts[2]) || Number(parts[3] || 0)))) {
            throw new Error('Khung gio lam viec SLA khong hop le');
        }
        return (Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3] || 0)) * 1000;
    }

    function loadCalendar() {
        workingFile = new SCFile('esdHTKTslaWorkingHour', SCFILE_READONLY);
        workingFile.setFields(['day.of.week', 'start.time', 'end.time']);
        var rc = workingFile.doSelect('true');
        if (rc != RC_SUCCESS) throw new Error('Chua tai duoc lich lam viec SLA');
        while (rc == RC_SUCCESS) {
            // Quy uoc DB: thu Hai = 1, Chu nhat = 7.
            var day = Number(workingFile['day.of.week']);
            if (day < 1 || day > 7 || day !== Math.floor(day)) throw new Error('Ngay lam viec SLA khong hop le');
            var start = readShiftTime(workingFile['start.time']);
            var end = readShiftTime(workingFile['end.time']);
            if (start === end) throw new Error('Khung gio lam viec SLA bi rong');
            if (end > start) {
                workingHours[day % 7].push([start, end]);
            } else {
                workingHours[day % 7].push([start, 86400000]);
                workingHours[(day + 1) % 7].push([0, end]);
            }
            rc = workingFile.getNext();
        }
        if (rc != RC_NO_MORE) throw new Error('Doc lich lam viec SLA bi loi');
        // Gop ca trung nhau de khong dem hai lan cung mot khoang thoi gian.
        for (var d = 0; d < 7; d++) {
            var shifts = workingHours[d];
            shifts.sort(function(a, b) { return a[0] - b[0]; });
            var merged = [];
            for (var s = 0; s < shifts.length; s++) {
                var previous = merged.length ? merged[merged.length - 1] : null;
                if (previous && shifts[s][0] <= previous[1]) previous[1] = Math.max(previous[1], shifts[s][1]);
                else merged.push(shifts[s]);
            }
            workingHours[d] = merged;
        }
        holidayFile = new SCFile('esdHTKTslaHoliday', SCFILE_READONLY);
        holidayFile.setFields(['holiday.date']);
        rc = holidayFile.doSelect('true');
        if (rc != RC_SUCCESS && rc != RC_NO_MORE) throw new Error('Khong tai duoc ngay nghi SLA');
        while (rc == RC_SUCCESS) {
            var holiday = readDate(holidayFile['holiday.date']);
            if (!holiday) throw new Error('Ngay nghi SLA khong hop le');
            holidays[holiday.getFullYear() + '-' + (holiday.getMonth() + 1) + '-' + holiday.getDate()] = true;
            rc = holidayFile.getNext();
        }
        if (rc != RC_NO_MORE) throw new Error('Doc ngay nghi SLA bi loi');
    }

    function formatDate(value) {
        return value ? pad(value.getDate()) + '/' + pad(value.getMonth() + 1) + '/' + value.getFullYear() +
            ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes()) + ':' + pad(value.getSeconds()) : '---';
    }

    function formatDuration(value) {
        if (value === null) return '---';
        var seconds = Math.floor(Math.abs(value) / 1000);
        return Math.floor(seconds / 3600) + ' giờ ' + Math.floor(seconds % 3600 / 60) +
            ' phút ' + seconds % 60 + ' giây';
    }

    try {
        if (paymentId) {
            // Doc lai phieu de khong dung phase cu khi vua trinh/chuyen buoc.
            requestFile = new SCFile(/^TU\./i.test(paymentId) ? 'esdHTKTprepayment' : 'esdHTKTpayment', SCFILE_READONLY);
            requestFile.setFields(['current.phase', 'initial.role', 'created.by', 'user.checker.kttc',
                'user.checker.dmms', 'user.approver.dmms', 'user.approver.kttc', 'user.checker.final', 'user.approver.final']);
            if (requestFile.doSelect('id="' + htktExpenseView_escapeQueryValue(paymentId) + '"') != RC_SUCCESS) {
                throw new Error('Khong tim thay phieu de xac dinh role SLA');
            }
            var workflowLib = lib.ESD_HTKT_EXPENSE_WF;
            if (!workflowLib || typeof workflowLib.getCurrentActorField !== 'function') {
                throw new Error('Thieu ham xac dinh role dang xu ly');
            }
            var actorField = workflowLib.getCurrentActorField(requestFile);
            var actor = String(actorField && requestFile[actorField] || '').trim();
            var currentUser = String(vars['$lo.contact.name'] || '').trim();
            var isCurrentActor = actor && currentUser && actor.toLowerCase() === currentUser.toLowerCase();
            if (actorField && isCurrentActor) {
            tracking = new SCFile('esdHTKTslaTracking', SCFILE_READONLY);
            tracking.setFields(['attempt.no', 'started.at', 'ended.at', 'due.at', 'status', 'result', 'end.reason', 'current.assignee']);
            tracking.setOrderBy(['attempt.no', 'started.at'], [SCFILE_DSC, SCFILE_DSC]);
            selectCode = tracking.doSelect('payment.id="' + htktExpenseView_escapeQueryValue(paymentId) +
                '" and role.code="' + htktExpenseView_escapeQueryValue(actorField) + '"');
            if (selectCode == RC_SUCCESS) {
                dueAt = readDate(tracking['due.at']);
                endedAt = readDate(tracking['ended.at']);
                var startedAt = readDate(tracking['started.at']);
                var now = readDate(system.functions.tod());
                var result = String(tracking['result'] || '').replace(/^\s+|\s+$/g, '').toUpperCase();
                status = String(tracking['status'] || '').replace(/^\s+|\s+$/g, '');
                var endReason = String(tracking['end.reason'] || '').replace(/^\s+|\s+$/g, '');
                // ended.at trong tuong lai chua phai thoi diem da ket thuc.
                if (endedAt && now && endedAt.getTime() > now.getTime() && !endReason && !result && status !== 'Đã kết thúc') {
                    endedAt = null;
                }
                var assignedUser = String(tracking['current.assignee'] || '').trim();
                hasActiveSla = !!startedAt && !endedAt && !endReason && !result &&
                    status !== 'Đã kết thúc' && !!assignedUser && assignedUser.toLowerCase() === actor.toLowerCase();
                running = hasActiveSla;
                if (hasActiveSla && dueAt && now) {
                    loadCalendar();
                    referenceMs = wallTime(endedAt || now);
                    dueMs = wallTime(dueAt);
                    overdue = referenceMs > dueMs;
                    remainingMs = htktExpenseView_workingMilliseconds(referenceMs, dueMs, workingHours, holidays);
                }
                if (endedAt) {
                    status = 'Đã kết thúc';
                } else if (running && overdue) {
                    status = 'Vi phạm';
                } else if (!status) {
                    status = running && dueAt ? 'Trong thời gian' : 'Chưa tính';
                }
                if (status === 'Vi phạm' || result === 'BREACHED') {
                    color = '#ef4444';
                    background = '#fef2f2';
                } else if (status === 'Trong thời gian' || result === 'MET') {
                    color = '#4ade80';
                    background = '#f0fdf4';
                }
            }
            }
        } else {
            status = 'Chưa xác định mã phiếu';
        }
    } catch (error) {
        status = 'Không tải được thông tin SLA';
        running = false;
        remainingMs = null;
        hasActiveSla = false;
    } finally {
        try { if (tracking) tracking.doClose(); } catch (closeError) {}
        try { if (requestFile) requestFile.doClose(); } catch (requestCloseError) {}
        try { if (workingFile) workingFile.doClose(); } catch (workingCloseError) {}
        try { if (holidayFile) holidayFile.doClose(); } catch (holidayCloseError) {}
    }

    if (!hasActiveSla && status !== 'Không tải được thông tin SLA' && status !== 'Chưa xác định mã phiếu') {
        status = 'Không tính SLA';
        dueAt = null;
        endedAt = null;
        remainingMs = null;
        overdue = false;
        color = '#94a3b8';
        background = '#f1f5f9';
    }
    var timeLabel = endedAt ? (overdue ? 'Quá hạn khi kết thúc: ' : 'Thời gian còn lại khi kết thúc: ')
        : (overdue ? 'Thời gian quá hạn: ' : 'Thời gian còn lại: ');
    var html = '<style>html,body{margin:0!important;padding:0!important;width:100%;height:100%;overflow:hidden!important;}' +
        '[data-sla-view],[data-sla-view] *{box-sizing:border-box;}</style>' +
        '<div data-sla-view data-payment-id="' + escapeHtml(paymentId) + '" data-sla-select-code="' + escapeHtml(selectCode) +
        '" style="width:100%;min-width:0;display:flex;flex-direction:column;padding:0;background:#fff;font-family:Arial,sans-serif;">' +
        '<div data-sla-panel style="height:126px;flex-shrink:0;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:6px;border:1px solid ' + color + ';border-radius:6px;padding:8px;">' +
        '<div style="line-height:18px;font-size:13px;font-weight:600;color:#304970;">Chi tiết SLA: SLA xử lý</div>' +
        '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px;line-height:18px;font-size:13px;color:#7c8ba5;">' +
        '<div>Trạng thái xử lý: <span data-sla-status style="display:inline-block;margin-left:3px;padding:0 3px;border:1px solid ' + color +
        ';border-radius:10px;color:' + color + ';background:' + background + ';font-size:13px;">' + escapeHtml(status) + '</span></div>' +
        '<div><span data-sla-label>' + timeLabel + '</span><span data-sla-time>' + (status === 'Không tính SLA' ? 'N/A' : formatDuration(remainingMs)) + '</span></div></div>' +
        '<div style="line-height:18px;font-size:13px;color:#7c8ba5;">Hạn xử lý: ' + (status === 'Không tính SLA' ? 'N/A' : escapeHtml(formatDate(dueAt))) + '</div></div>';

    // Dem nguoc tai trinh duyet, khong goi lai SM moi giay. Dung khi viewer bi thao khoi DOM.
    if (running && remainingMs !== null) {
        html += '<script>(function(){var script=document.currentScript;var root=script&&script.parentNode;if(!root)return;' +
            'var calculate=' + htktExpenseView_workingMilliseconds.toString() + ';' +
            'var hours=' + JSON.stringify(workingHours) + ';var holidays=' + JSON.stringify(holidays) + ';' +
            'var reference=' + referenceMs + ';var due=' + dueMs + ';var loaded=new Date().getTime();' +
            'var timer=setInterval(function(){if(!document.documentElement.contains(root)){clearInterval(timer);return;}' +
            'var now=reference+(new Date().getTime()-loaded);var left=calculate(now,due,hours,holidays);var seconds=Math.floor(Math.abs(left)/1000);' +
            'root.querySelector("[data-sla-time]").textContent=Math.floor(seconds/3600)+" giờ "+Math.floor(seconds%3600/60)+" phút "+seconds%60+" giây";' +
            'root.querySelector("[data-sla-label]").textContent=now>due?"Thời gian quá hạn: ":"Thời gian còn lại: ";' +
            'if(now>due){var badge=root.querySelector("[data-sla-status]");badge.textContent="Vi phạm";badge.style.color="#ef4444";' +
            'badge.style.borderColor="#ef4444";badge.style.background="#fef2f2";root.querySelector("[data-sla-panel]").style.borderColor="#ef4444";}' +
            '},1000);})();</script>';
    }
    return html + '</div>';
}

function renderHdsd() {
    var scFile = new SCFile('esdAttachments');
    var result = scFile.doSelect(`id = "HDSD_HTKT_Du_chi" and module = "HTKT" and function = "Du chi"`);
    var base64PDF = "";
    if (result == RC_SUCCESS) {
        var attachments = scFile.getAttachments();

        for (var i = 0; i < attachments.length; i++) {
            var att = attachments[i];
            var binaryData = att.value;
            if (att.value) {
                var base64 = base64Encode(binaryData);
                base64PDF = lib.ESD_HTKT_PAYMENT_COMMON.htktEscapeForJavaScript(base64);
            }
        }
    }
    if (scFile) scFile.doClose();
    return (
        "<div style='border-radius: 6px; height: 100%; width: 100%; box-shadow: 0 2px 8px rgb(0 0 0 / 26%); overflow: hidden; box-sizing: border-box; font-family: Arial, sans-serif;'>" +
        "<div style='margin:10px;border-bottom: 1px solid #ddd; padding-bottom: 10px; margin: 10px 15px; font-size: 17px; font-weight: 600; color: #0835D9;'>Hướng dẫn thực hiện</div>" +
        "<div style='margin:10px;border:1px solid #ddd;padding:0;width:100%;height:100%;font-family:Arial,sans-serif;'>" +
        "<iframe id='htktPdfFrame' width='100%' height='100%' style='min-height:700px;border:none;background:#e5e7eb;'></iframe>" +
        "<script>" +
        "(function(){" +
        "var base64='" + base64PDF + "';" +
        "function toBytes(value){" +
        "var binary=atob(value);" +
        "var bytes=new Uint8Array(binary.length);" +
        "for(var i=0;i<binary.length;i++){bytes[i]=binary.charCodeAt(i);}" +
        "return bytes;" +
        "}" +
        "try{" +
        "var blob=new Blob([toBytes(base64)],{type:'application/pdf'});" +
        "var url=URL.createObjectURL(blob);" +
        "var frame=document.getElementById('htktPdfFrame');" +
        "frame.src=url+'#toolbar=0&navpanes=0&view=FitH';" +
        "window.addEventListener('beforeunload',function(){URL.revokeObjectURL(url);});" +
        "}catch(e){" +
        "document.body.innerHTML='<div style=\"padding:16px;color:red;font-family:Arial;\">Lỗi render PDF: '+e+'</div>';" +
        "}" +
        "})();" +
        "</script>" +
        "</div>" +
        "</div>"
    );
}
