var isCurrentInRange = lib.ESD_DateTime_Utils.isCurrentInRange;
function q(v) { return (v == null ? "" : String(v)).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function orList(field, arr) {
    if (!arr || !arr.length) return "";
    arr = [...new Set(arr)];
    var i, p = [];
    for (i = 0; i < arr.length; i++) {
        p.push(field + '="' + q(arr[i]) + '"');
    }
    return " (" + p.join(' or ') + " )";
}
// lấy người có mã quyền và có phạm vi dữ liệu tương ứng
function getContactsByRightsAndUnits(rightsIds, subModuleId, unitIds, createdBy) {
    if (!Array.isArray(rightsIds) || rightsIds.length === 0 || !subModuleId) {
        print("ESD_PERMS_RIGHTS.getContactsByRight >>> error")
        return [];
    }
    var contacts=[];
    var subModule = subModuleId;
    createdBy = createdBy ? createdBy : [];
    var queryUnit = orList("unit.id", unitIds) ? " and " + orList("unit.id", unitIds) + "\"" : ""; //unitIds.map(unit => `unit.id = "${unit}"`).join(" or ");
    // lấy contacts có quyền rightsIds
    contacts = listContactsByRights(rightsIds);
    if (contacts.length==0) return [];
     // Mảng kết quả: lưu các contact nằm trong createdBy
    var arrContactQuery = [];
    if (createdBy.length > 0) {

        let createdSet = new Set(createdBy);
        for(var i = 0; i<createdSet.length; i++){
            createdSet[i] = createdSet[i].trim();
        }
        let newContacts = [];
    
        for (let c of contacts) {
            let val = c.trim();
            if (createdSet.has(val)) {
                arrContactQuery.push(val);
            } else {
                newContacts.push(val);
            }
        }
        // Cập nhật lại contacts chỉ gồm phần không trùng
        contacts = newContacts;
    }
    if (contacts.length==0) return arrContactQuery;
    
    //  check phạm vi dữ liệu
    var f = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
    f.setFields(['contact.id', 'permission.scope', 'id']);
    var query3 = orList("contact.id", contacts) ? orList("contact.id", contacts) + " and permission.scope ~=\"QT_PQDL_01\" and sub.module = \"" + q(subModule) + "\"" : false;
    rc = f.doSelect(query3);
    while (rc == RC_SUCCESS) {
        switch (f['permission.scope']) {
            case "QT_PQDL_06": {
                arrContactQuery.push(f['contact.id']);
                break;
            }
            default: {
                if (!queryUnit) {
                    break;
                }
                var count = lib.ESD_Utils.countFile("esdjoinDatapermissionUnits", `data.permission.id= "${f.id}" and status = "Dang hoat dong" ${queryUnit}`)
                if (count > 0) {
                    arrContactQuery.push(f['contact.id']);
                }
                break;
            }
        }
        rc = f.getNext();
    }

    arrContactQuery =  [...new Set(arrContactQuery)];
    return arrContactQuery;
    
}
// lấy mảng contacts có quyền rightsIds
function listContactsByRights(rightsIds) {
    if (!Array.isArray(rightsIds) || rightsIds.length === 0) {
        print("listContactsByRights");
        return [];
    }
    var contacts=[];
    var queryRight= orList("rights.id",rightsIds);

    // Khởi tạo SCFile
    var f = new SCFile("esdjoinRightsPermission", SCFILE_READONLY);

    // SQL lấy người dùng có quyền đang hoạt động push và mảng  contacts
    var select = " SELECT pg.id as id , c.contact.name as contact , pg.start.date as start ,pg.end.date as end, jcpg.start.date as jstart , jcpg.end.date as jend"
    var mapping = " FROM esdjoinRightsPermission jrp JOIN esdQTpermissionGroup pg on (jrp.permission.group.id = pg.id ) JOIN esdjoinContactsPermissionGroup jcpg on (jcpg.permission.group.id = pg.id ) JOIN contacts c on (jcpg.contact.id = c.contact.name )"

    var control = " where pg.status = \"Dang hoat dong\"  and  c.status =\"Dang hoat dong\"" ;
    control=control+" and " +queryRight;

    var querySQL = select+mapping+ control ;

    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {
        if(isCurrentInRange(f.start, f.end) && isCurrentInRange(f.jstart, f.jend)){
            contacts.push(f.contact);
        }
        rc = f.getNext();
    }
    contacts =  [...new Set(contacts)];
    return contacts

}
// lấy tên và mã người dùng
function getContacts(query, displayFormatter) {
    if (!query) {
        return {
            contactIds: [],
            fullNames: []
        };
    }
    /**
     * Default formatter
     */
    displayFormatter =
        displayFormatter ||
        function (record) {
            return (
                record["contact.name"] + " - " + record["full.name"]
            );
        };

    var contactIds = [];
    var fullNames = [];
    var f = new SCFile("contacts", SCFILE_READONLY);
    f.setFields(["contact.name", "full.name"]);
    var rc = f.doSelect(query);
    while (rc == RC_SUCCESS) {
        contactIds.push(f["contact.name"]);
        fullNames.push(displayFormatter(f));
        rc = f.getNext();
    }
    return {
        contactIds: contactIds,
        fullNames: fullNames
    };
}
// get unit contact có quyền theo contact và subModule
function getUnitByDataPermissions(contact, subModule){
    if(!contact||!subModule) return {"scope": "","unit": []};
    var scope ="", unitIDs=[];

    // Khởi tạo SCFile
    var f = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
    var rc = f.doSelect("contact.id =\""+contact +"\"" + " and sub.module =\""+subModule +"\"");
    if (rc == RC_SUCCESS) {
        scope = f.permission_scope;
        if(scope=="QT_PQDL_01"||scope=="QT_PQDL_06") return {"scope": scope,"unit": []};
    }

    // Khởi tạo SCFile
    var joinFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
    var rcJoin = joinFile.doSelect("status = \"Dang hoat dong\" and data.permission.id =\""+f.id+"\"" );
    while (rcJoin == RC_SUCCESS) {
        unitIDs.push(joinFile.unit_id);
        rcJoin = joinFile.getNext();
    }
    unitIDs= [...new Set(unitIDs)];
    return {
        "scope": scope,
        "unit": unitIDs
    }
}

//print(permsRight("VTB.KH01.41"));
// get quyền theo contact.name
function permsRight(userId) {
    // Hàm build OR-list nhanh cho query
    function orList(field, arr) {
        if (!arr || !arr.length) return "";
        arr = [...new Set(arr)];
        return "(" + arr.map(v => `${field}="${v}"`).join(" or ") + ")";
    }
    let arrGroupIds = [];
    // 1. LOAD TẤT CẢ PERMISSION GROUP CỦA USER (1 TRUY VẤN)
    var joinFile = new SCFile('esdjoinContactsPermissionGroup', SCFILE_READONLY);
    joinFile.setFields(['permission.group.id', 'start.date', 'end.date']);
    var rc = joinFile.doSelect(`contact.id="${userId}"`);
    let joinData = []; // lưu cả record để check thời gian sau
    while (rc === RC_SUCCESS) {
        arrGroupIds.push(joinFile['permission.group.id']);
        joinData.push({
            id: joinFile['permission.group.id'],
            start: joinFile['start.date'],
            end: joinFile['end.date']
        });
        rc = joinFile.getNext();
    }
    if (arrGroupIds.length === 0) return [];
    let groupQuery = orList("id", arrGroupIds);
    // 2. LOAD THÔNG TIN TẤT CẢ GROUP ID (1 TRUY VẤN)
    let pgData = {}; // map id → thông tin group
    var pg = new SCFile('esdQTpermissionGroup', SCFILE_READONLY);
    pg.setFields(['id', 'status', 'start.date', 'end.date']);
    var rc2 = pg.doSelect(groupQuery);

    while (rc2 === RC_SUCCESS) {
        pgData[pg.id] = {
            status: pg.status,
            start: pg['start.date'],
            end: pg['end.date']
        };
        rc2 = pg.getNext();
    }
    // 3. LỌC RA DANH SÁCH GROUP HỢP LỆ (CHỈ LỌC JS, KHÔNG QUERY)
    let validGroupIds = [];
    for (let g of joinData) {
        let info = pgData[g.id];
        if (!info) continue;

        let active = (info.status === "Dang hoat dong") &&
            lib.ESD_DateTime_Utils.isCurrentInRange(info.start, info.end) &&
            lib.ESD_DateTime_Utils.isCurrentInRange(g.start, g.end);

        if (active) validGroupIds.push(g.id);
    }

    if (validGroupIds.length === 0) return [];
    // 4. TẢI DANH SÁCH QUYỀN CỦA TẤT CẢ GROUP HỢP LỆ (1 TRUY VẤN)
    let rights = [];
    let rightsQuery = orList("permission.group.id", validGroupIds);

    var rp = new SCFile('esdjoinRightsPermission', SCFILE_READONLY);
    rp.setFields(['rights.id']);

    var rc3 = rp.doSelect(rightsQuery);
    while (rc3 === RC_SUCCESS) {
        rights.push(rp['rights.id']);
        rc3 = rp.getNext();
    }
    // Unique quyền
    let result = [...new Set(rights)];
    
 
    
    return result;
}


/**
 * Lấy danh sách contact có quyền theo rightsIds và các điều kiện filter bổ sung.
 *
 * @param {string[]} rightsIds - Danh sách quyền (rights.id) cần kiểm tra
 * @param {Object} [obj] - Điều kiện lọc bổ sung theo field (AND giữa các field, OR trong từng field)
 * @param {string[]} [obj['lv1.id']]
 * @param {string[]} [obj['lv2.id']]
 * @param {string[]} [obj['lv3.id']]
 * @param {string[]} [obj['org.unit']]
 *
 * @returns {string[]} Danh sách contact.id thỏa điều kiện (không trùng)
 *
 * @description
 * - Lấy contact thuộc các permission group có quyền trong rightsIds
 * - Filter thêm theo obj (dạng OR từng field, AND giữa các field)
 * - Chỉ lấy contact và permission group đang hoạt động và còn hiệu lực thời gian
 */
//print(listContactsByRightsAndFilter(["0030020001000001"],{'lv2.id':["099922010"]}))
// lấy mảng contacts có quyền rightsIds và filter contact
function listContactsByRightsAndFilter(rightsIds, obj) {

    obj = obj || {
        'lv1.id': [],
        'lv2.id': [],
        'lv3.id': [],
        'org.unit': []
    };

    if (!Array.isArray(rightsIds) || rightsIds.length === 0) {
        print("ESD_PERMS_RIGHTS.listContactsByRightsAndFilter : không đúng định dạng rightIds");
        return [];
    }

    var contacts = [];

    // ===== quyền =====
    var queryRight = orList("rights.id", rightsIds);

    // ===== build query từ obj =====
    var queryObj = "";

    for (var key in obj) {
        var arr = obj[key];

        if (Array.isArray(arr) && arr.length > 0) {

            var subQuery = orList(key, arr);

            if (subQuery) {
                queryObj += (queryObj ? " and " : "") + subQuery;
            }
        }
    }

    // ===== SCFile =====
    var f = new SCFile("esdjoinRightsPermission", SCFILE_READONLY);

    var select = " SELECT pg.id as id , c.contact.name as contact , pg.start.date as start ,pg.end.date as end, jcpg.start.date as jstart , jcpg.end.date as jend";

    var mapping = " FROM esdjoinRightsPermission jrp " +
                  " JOIN esdQTpermissionGroup pg on (jrp.permission.group.id = pg.id ) " +
                  " JOIN esdjoinContactsPermissionGroup jcpg on (jcpg.permission.group.id = pg.id ) " +
                  " JOIN contacts c on (jcpg.contact.id = c.contact.name )";

    var control = " where pg.status = \"Dang hoat dong\"  and  c.status =\"Dang hoat dong\"";

    control += " and " + queryRight;

    if (queryObj) {
        control += " and " + queryObj;
    }

    var querySQL = select + mapping + control;

    // ===== query =====
    var rc = f.doSelect(querySQL);

    while (rc == RC_SUCCESS) {

        if (
            isCurrentInRange(f.start, f.end) &&
            isCurrentInRange(f.jstart, f.jend)
        ) {
            contacts.push(f.contact);
        }

        rc = f.getNext();
    }

    // ===== remove duplicate =====
    contacts = [...new Set(contacts)];

    try { if (f) f.doClose(); } catch (e) {}

    return contacts;
}


