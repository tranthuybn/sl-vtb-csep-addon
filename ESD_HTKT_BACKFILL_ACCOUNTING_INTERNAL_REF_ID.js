/**
 * Migration esdHTKTaccountingInformation:
 * - Neu prepayment.id bat dau bang "TU" hoac "TT"
 * - Gan internal.ref.id = prepayment.id
 *
 * Input tuy chon qua vars['$L.file']:
 * - previewOnly: true  -> chi thong ke, khong update.
 * - previewOnly: false -> update du lieu (mac dinh).
 */

function run() {
    var input = vars['$L.file'] || {};
    var previewOnly = input.previewOnly === true ||
            String(input.previewOnly || "").toLowerCase() === "true";
    var result;

    try {
        result = backfillAccountingInternalRefId(previewOnly);
    } catch (e) {
        result = {
            success: false,
            previewOnly: previewOnly,
            error: String(e && e.message || e)
        };
        print("backfillAccountingInternalRefId::error: " + result.error);
    }

    print("backfillAccountingInternalRefId::result: " +
            rteJSONStringify(result));

    if (vars['$L.file']) {
        vars['$L.file'].queryReturn = rteJSONStringify(result);
    }
    return result;
}

function backfillAccountingInternalRefId(previewOnly) {
    var result = {
        success: true,
        previewOnly: previewOnly === true,
        scanned: 0,
        matched: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    var file = null;
    try {
        file = new SCFile("esdHTKTaccountingInformation");

        // Loc prefix trong JavaScript de khong phu thuoc cu phap prefix
        // dac thu cua query engine Service Manager.
        var rc = file.doSelect(
                'prepayment.id <> NULL and prepayment.id <> ""'
        );

        while (rc === RC_SUCCESS) {
            result.scanned++;

            var prepaymentId = cleanText(file["prepayment.id"]);
            var internalRefId = cleanText(file["internal.ref.id"]);
            var prefix = prepaymentId.substring(0, 2).toUpperCase();

            if (prefix !== "TU" && prefix !== "TT") {
                result.skipped++;
                rc = file.getNext();
                continue;
            }

            result.matched++;
            if (internalRefId === prepaymentId) {
                result.unchanged++;
                rc = file.getNext();
                continue;
            }

            if (!result.previewOnly) {
                file["internal.ref.id"] = prepaymentId;
                var updateRc = file.doUpdate();

                if (updateRc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    result.errors.push({
                        requestId: cleanText(file["request.id"]),
                        prepaymentId: prepaymentId,
                        oldInternalRefId: internalRefId,
                        returnCode: updateRc
                    });
                }
            }

            rc = file.getNext();
        }
    } finally {
        closeFileSafely(file);
    }

    result.success = result.failed === 0;
    return result;
}

function cleanText(value) {
    return value === null || value === undefined
            ? ""
            : String(value).trim();
}

function closeFileSafely(file) {
    if (!file) return;
    try {
        file.close();
    } catch (e) {
        // Khong che loi migration chinh neu dong SCFile that bai.
    }
}

// Chay truc tiep khi can:
// print(rteJSONStringify(backfillAccountingInternalRefId(true)));  // preview
// print(rteJSONStringify(backfillAccountingInternalRefId(false))); // update

