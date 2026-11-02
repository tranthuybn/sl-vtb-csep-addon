var iframeUrl = lib.ESD_ENV_CONFIG.iframAddonsUrl();

function renderPageNextJS(endpoint, input, extraData) {
    const aesjs = lib.ESD_Addon_Crypto.aesjsCrypto();
    const key = [
        90, 5, 158, 97, 147, 177, 222, 117, 15, 139, 237, 123, 191, 126, 170, 44
    ];
    const lastbusy = system.user.lastbusy;
//  const iframeUrl = 'http://10.0.62.26:5010';
    const lastbusyDate = new Date(lastbusy * 100000);
    const userLogin = system.user.name;
    const iframeUrl =
            userLogin === 'vtb.htkt.116' ||
//            userLogin === 'vtb.htkt.114' ||
//        userLogin === 'vtb.htkt.112' ||
//            userLogin === 'vtb.htkt.110' ||
//        userLogin === 'vtb.htkt.178' ||
//            userLogin === 'vtb.htkt.147'  ||
//        userLogin === 'vtb.htkt.146' ||
//        userLogin === 'vtb.htkt.145' ||
//            userLogin === 'vtb.htkt.19'  ||
//            userLogin === 'vtb.htkt.16'  ||
            userLogin === 'vtb.htkt.117'  ||
//            userLogin === 'vtb.htkt.116'  ||
//        userLogin === 'vtb.htkt.17' ||
             userLogin === 'vtb.htkt.178'  ||
//             userLogin === 'vtb.htkt.189'  ||
//              userLogin === 'vtb.htkt.197'  ||
//        userLogin === 'vtb.htkt.110' ||
//        userLogin === 'vtb.htkt.123' ||
        // userLogin === 'vtb.htkt.122'  ||
        userLogin === 'vtb.htkt.127' ||
         userLogin === 'vtb.htkt.126' ||
//        userLogin === 'vtb.htkt.129' ||
//        userLogin === 'vtb.htkt.124' ||
//        userLogin === 'vtb.htkt.130' ||
//        userLogin === 'vtb.htkt.123' ||
//            userLogin === 'vtb.htkt.127'  ||
//            userLogin === 'vtb.htkt.132'  ||  
//        userLogin === 'vtb.htkt.133' ||
//            userLogin === 'vtb.htkt.124'  ||
        //        userLogin === 'vtb.htkt.17'  ||
        //                userLogin === 'vtb.htkt.120'  ||
//            userLogin === 'vtb.htkt.148'  ||
//        userLogin === 'vtb.htkt.50' ||
//        userLogin === 'vtb.htkt.148' ||
        //    userLogin === 'vtb.htkt.123'  ||
        //        userLogin === 'vtb.htkt.199'  ||
        //    userLogin === 'vtb.htkt.42'  ||
        //    userLogin === 'vtb.htkt.47'  ||
        //    userLogin === 'vtb.htkt.48'  ||
//        userLogin === 'vtb.htkt.111' ||
//        userLogin === 'vtb.htkt.118' ||
        userLogin === 'vtb.htkt.11' ?
        'http://localhost:3001' :
        'http://10.2.18.9:5010';
    var rights = vars['$G.rights'];
    // Payload ban đầu để build URL
    const payload = {
        isFromSm: 1,
        userName: userLogin.toLowerCase(),
        lastbusy: lastbusyDate,
        endpoint: endpoint,
    };

    // Encrypt payload
    const text = JSON.stringify(payload);
    const textBytes = aesjs.utils.utf8.toBytes(text);
    const aesCtr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(5));
    const encryptedBytes = aesCtr.encrypt(textBytes);
    const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes);
    const src = `${iframeUrl}/ess/${encryptedHex}/path/${endpoint}` + input;

    // Encrypt current user và truyền nó vào cookies
    const cookieText = vars['$lo.contact.name'].toLowerCase();
    const cookieBytes = aesjs.utils.utf8.toBytes(cookieText);
    const cookieAesCtr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(5));
    const cookieEncryptedBytes = cookieAesCtr.encrypt(cookieBytes);
    var cookie_user = aesjs.utils.hex.fromBytes(cookieEncryptedBytes);
    // Tao HTML
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<script type="text/javascript" load-once="1" src="../js/9.80.0016/sm.base.js"></script>
<style>
.loading-mask {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 73vh;
    background: rgba(255, 255, 255, 0.6);
    z-index: 2000;
    display: none;
    justify-content: center;
    align-items: center;
    cursor: wait;
}
.loading-box {
    width: 140px; height: 54px;
    display: flex; align-items: center;
    gap: 10px; padding: 5px;
    border: 1px solid #ccc;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-size: 18px; color: #555;
}
</style>
</head>
<body>
<div id="loading" class="loading-mask">
    <div class="loading-box">
        <img src="../images/9.80.0016/default/grid/mask-loading.gif" width="30" height="30" alt="loading"/>
        <span>Loading...</span>
    </div>
</div>

<script>
    document.cookie = \`x-user-right=\${encodeURIComponent(rights.join(","))}; path=/\`;
    document.cookie = \`x-user-info=\${encodeURIComponent(userLogin)}; path=/\`;
    document.cookie = \`x-user-name=\${encodeURIComponent(cookie_user)}; path=/\`;
</script>

<iframe id="addonIframe" src="\${src}" style="height:100vh;width:100vw;border:none;outline:none"></iframe>

<script>
const iframe = document.getElementById("addonIframe");

function openTaskDetails(fileName, taskNumber, fieldId, exp, sig, u) {
    const queryFilter = encodeURIComponent(fieldId + '="' + taskNumber + '"');
    const builder = parent.cwc.getDetailURLBuilder();
    builder.addParam('ctx', 'docEngine');
    builder.addParam('wflink', 'true');
    builder.addParam('file', fileName);
    builder.addParam('query', queryFilter);

    builder.addParam('u', u || "");
    builder.addParam('exp', exp || "");
    builder.addParam('sig', sig || "");

    const wfUrl = builder.toURL();
    parent.cwc.updateActiveTab(wfUrl);
}

function openAndCloseTaskDetails(fileName, taskNumber, fieldId, messageData, exp, sig, u) {
    openTaskDetails(fileName, taskNumber, fieldId, exp, sig, u);

    setTimeout(function () {
        try {
            top.cwc.getActivePopup()?.close();
        } catch (e) {
            console.log("close popup error:", e);
        }
    }, 500);

    if (messageData && Array.isArray(messageData.items) && messageData.items.length) {
        setTimeout(function () {
            showMessageBar({
                items: messageData.items.map(function (item) {
                    return {
                        module: "evmsg",
                        msg: item.msg || "",
                        severity: item.severity || "3",
                        time: item.time || ""
                    };
                })
            }, 2000);
        }, 800);
    }
}

function showMessageBar(msg, duration = 3000) {
    const manager = parent.topCwc.messageManager;

    manager.showMessageBar(msg, false);

    // auto hide sau duration ms
    setTimeout(function () {
        try {
            manager.hideMessageBar();
        } catch (e) {
            console.log("clear message error:", e);
        }
    }, duration);
}

function handleClosePopup(messageData) {
    try {
        top.cwc.getActivePopup()?.close();
    } catch (e) {
        console.log("close popup error:", e);
    }

    if (messageData && Array.isArray(messageData.items) && messageData.items.length) {
        setTimeout(function () {
            showMessageBar({
                items: messageData.items.map(function (item) {
                    return {
                        module: "evmsg",
                        msg: item.msg || "",
                        severity: item.severity || "3",
                        time: item.time || ""
                    };
                })
            }, 3000);
        }, 800);
    }
}

var warningFilterFromLocalStorage = null;
try {
    var urlParams = new URLSearchParams(window.location.search);
    var urlQuery = urlParams.get("nextjsQuery");
    if (urlQuery) {
        urlQuery = decodeURIComponent(urlQuery);
        if (urlQuery.indexOf('%') >= 0) {
            urlQuery = decodeURIComponent(urlQuery);
        }
        warningFilterFromLocalStorage = urlQuery;
    }
    if (!warningFilterFromLocalStorage) {
        warningFilterFromLocalStorage = localStorage.getItem("warningFilter");
        if (warningFilterFromLocalStorage) {
            localStorage.removeItem("warningFilter");
        }
    }
} catch (e) {
    console.log("Error reading warningFilter on load:", e);
}

function handleOnMaskWindowLoading(){
    top.cwc.maskWindow("LOADING");
}

// Nhận message từ iframe
window.addEventListener('message', function(event) {
    if (event.origin !== "\${iframeUrl}") return;

    const data = event.data;

    if (data.action === "readyToReceiveInitialData") {
        var extraDataObj = \${JSON.stringify(extraData)} || {};
        if (warningFilterFromLocalStorage) {
            extraDataObj.defaultFilter = warningFilterFromLocalStorage;
        }
        const payload = {
            action: "initData",
            value: extraDataObj
        };
        iframe.contentWindow.postMessage(payload, "\${iframeUrl}");
        console.log("Sent initData:", payload);
    }

console.log("data", data);
if (data.action === 'navigate') {
    parent.cwc?.navigateTo?.(data.url) || parent.cwc.updateActiveTab(data.url);
}

if (data.action === 'openTaskDetails') {
    openTaskDetails(data.fileName, data.taskNumber, data.fieldId, data.exp , data.sig, data.u);
}

if (data.action === 'closePopup') {
    handleClosePopup(data.messageBar);
}

if (data.action === "showLoading") {
    document.getElementById("loading").style.display = "flex";
}

if (data.action === "hideLoading") {
    document.getElementById("loading").style.display = "none";
}

if (data.action === 'openAndCloseTaskDetails') {
    openAndCloseTaskDetails(
        data.fileName,
        data.taskNumber,
        data.fieldId,
        data.messageBar,
        data.exp ,
        data.sig,
        data.u
    );
}

if (data.action === "messageBarEvent" && Array.isArray(data.items) && data.items.length) {
    showMessageBar({
        items: data.items.map(function (item) {
            return {
                module: "evmsg",
                msg: item.msg || "",
                severity: item.severity || "3",
                time: item.time || ""
            };
        })
    }, 3000);
}

if (data.action === "onMaskWindowLoading") {
    try {
        handleOnMaskWindowLoading();
    } catch (e) {console.log("maskWindow error:", e);}
}

if (data.action === "offMaskWindowLoading") {
    try {
        top.cwc.unmaskWindow();
    } catch (e) {console.log("unmaskWindow error:", e);}
}
});
</script>
<script type="text/javascript" >
(function () {
  "use strict";

  function inject(fn) {
    const script = document.createElement("script");
    script.textContent = \`;(\${fn.toString()})();\\n\`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  inject(function pagePatch() {
    "use strict";

    const PATCH_FLAG = "__smStopPopupReloadPatched__";
    const POLL_MS = 500;

    function log() {
      try {
        console.debug("[sm-stop-popup-reload]", ...arguments);
      } catch (_) {}
    }

    function isPopupContainerPage() {
      try {
        const text = (document.body && document.body.innerText) || "";
        if (document.getElementById("addonIframe")) {
          return true;
        }
        return text.includes("Loading...") && typeof handleClosePopup === "function";
      } catch (_) {
        return false;
      }
    }

    function patch() {
      try {
        if (window[PATCH_FLAG]) {
          return true;
        }

        if (
          typeof window.openAndCloseTaskDetails !== "function" ||
          typeof window.handleClosePopup !== "function" ||
          !isPopupContainerPage()
        ) {
          return false;
        }

        const original = window.openAndCloseTaskDetails;
        window.openAndCloseTaskDetails = function patchedOpenAndCloseTaskDetails(
          fileName,
          taskNumber,
          fieldId,
          messageData
        ) {
          log("blocked reopen detail", { fileName, taskNumber, fieldId });
          try {
            return window.handleClosePopup(messageData);
          } catch (err) {
            log("fallback to original due to error", err);
            return original.apply(this, arguments);
          }
        };

        window[PATCH_FLAG] = true;
        log("patch installed");
        return true;
      } catch (err) {
        log("patch error", err);
        return false;
      }
    }

    patch();
    setInterval(patch, POLL_MS);
  });
})();
</script>
</body>
</html>
`;
}