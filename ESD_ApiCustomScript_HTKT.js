run()

function run() {
    var input = vars["$L.file"];
    var rawParams = input["queryString"];
    var name = input["name"];
    var parsed = {};

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
