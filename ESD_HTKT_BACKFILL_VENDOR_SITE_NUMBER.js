/**
 * Backfill esdHTKTvendorSite.vendor.number theo esdHTKTvendor.vendor.number.
 * Hai bang duoc doi chieu bang vendor.id = esdHTKTvendor.id.
 *
 * Input tuy chon qua vars['$L.file']:
 * - previewOnly: true  -> chi thong ke, khong update.
 * - previewOnly: false -> cap nhat du lieu (mac dinh).
 */

function run() {
    var input = vars['$L.file'] || {};
    var previewOnly = input.previewOnly === true ||
            String(input.previewOnly || "").toLowerCase() === "true";
    var result;

    try {
        result = backfillVendorSiteNumber(previewOnly);
    } catch (e) {
        result = {
            success: false,
            previewOnly: previewOnly,
            error: String(e && e.message || e)
        };
        print("backfillVendorSiteNumber::error: " + result.error);
    }

    print("backfillVendorSiteNumber::result: " + rteJSONStringify(result));
    if (vars['$L.file']) {
        vars['$L.file'].queryReturn = rteJSONStringify(result);
    }
    return result;
}

function backfillVendorSiteNumber(previewOnly) {
    var result = {
        success: true,
        previewOnly: previewOnly === true,
        scanned: 0,
        matched: 0,
        updated: 0,
        unchanged: 0,
        vendorNotFound: 0,
        vendorNumberEmpty: 0,
        failed: 0,
        errors: []
    };
    var vendorCache = {};
    var vendorSiteFile = null;

    try {
        vendorSiteFile = new SCFile("esdHTKTvendorSite");
        var rc = vendorSiteFile.doSelect(
                'vendor.id <> NULL and vendor.id <> ""'
        );

        while (rc === RC_SUCCESS) {
            result.scanned++;

            var vendorSiteId = cleanVendorSiteText(vendorSiteFile["id"]);
            var vendorId = cleanVendorSiteText(vendorSiteFile["vendor.id"]);
            var currentVendorNumber = cleanVendorSiteText(vendorSiteFile["vendor.number"]);
            var vendorInfo = findVendorNumber(vendorId, vendorCache);

            if (!vendorInfo.found) {
                result.vendorNotFound++;
                appendVendorSiteError(result, {
                    vendorSiteId: vendorSiteId,
                    vendorId: vendorId,
                    reason: "VENDOR_NOT_FOUND"
                });
                rc = vendorSiteFile.getNext();
                continue;
            }

            if (!vendorInfo.vendorNumber) {
                result.vendorNumberEmpty++;
                appendVendorSiteError(result, {
                    vendorSiteId: vendorSiteId,
                    vendorId: vendorId,
                    reason: "VENDOR_NUMBER_EMPTY"
                });
                rc = vendorSiteFile.getNext();
                continue;
            }

            result.matched++;
            if (currentVendorNumber === vendorInfo.vendorNumber) {
                result.unchanged++;
                rc = vendorSiteFile.getNext();
                continue;
            }

            if (!result.previewOnly) {
                vendorSiteFile["vendor.number"] = vendorInfo.vendorNumber;
                var updateRc = vendorSiteFile.doUpdate();
                if (updateRc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    appendVendorSiteError(result, {
                        vendorSiteId: vendorSiteId,
                        vendorId: vendorId,
                        oldVendorNumber: currentVendorNumber,
                        newVendorNumber: vendorInfo.vendorNumber,
                        reason: "UPDATE_FAILED",
                        returnCode: updateRc
                    });
                }
            }

            rc = vendorSiteFile.getNext();
        }
    } finally {
        closeVendorSiteFileSafely(vendorSiteFile);
    }

    result.success = result.failed === 0;
    return result;
}

function findVendorNumber(vendorId, cache) {
    var cacheKey = "$" + vendorId;
    if (cache.hasOwnProperty(cacheKey)) return cache[cacheKey];

    var result = { found: false, vendorNumber: "" };
    var vendorFile = null;
    try {
        vendorFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
        var rc = vendorFile.doSelect(
                'id="' + escapeVendorSiteQueryValue(vendorId) + '"'
        );
        if (rc === RC_SUCCESS) {
            result.found = true;
            result.vendorNumber = cleanVendorSiteText(vendorFile["vendor.number"]);
        }
    } finally {
        closeVendorSiteFileSafely(vendorFile);
    }

    cache[cacheKey] = result;
    return result;
}

function appendVendorSiteError(result, error) {
    // Gioi han log de tranh queryReturn qua lon khi du lieu loi nhieu.
    if (result.errors.length < 100) result.errors.push(error);
}

function cleanVendorSiteText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
}

function escapeVendorSiteQueryValue(value) {
    return cleanVendorSiteText(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}

function closeVendorSiteFileSafely(file) {
    if (!file) return;
    try {
        file.close();
    } catch (e) {
        try {
            file.doClose();
        } catch (ignore) {}
    }
}

// Chay preview:
// print(rteJSONStringify(backfillVendorSiteNumber(true)));
// Chay update:
// print(rteJSONStringify(backfillVendorSiteNumber(false)));

