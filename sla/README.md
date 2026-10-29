# SLA tự tính dùng chung cho Dự chi, Tạm ứng và Thanh toán

Đã triển khai engine tính và ghi dữ liệu SLA dùng chung cho các bảng phiếu. Dự chi và Thanh toán dùng esdHTKTpayment; Tạm ứng dùng esdHTKTprepayment. Ba loại dùng cùng quy tắc luồng. Tạm thời `transaction.type` chọn cấu hình và `product.type` luôn dùng giá trị `"Tất cả"` vì nguồn sản phẩm trên phiếu chưa được chốt. Không có HTTP API quản trị hoặc API lịch sử. Các entry point ở đây dành cho workflow và scheduler phía server. Mã chưa được import/chạy trên SM thật; không có thay đổi trigger tự động.


## Bàn giao cuối phiên 28/10/2026 — đọc trước khi tiếp tục

Mục này ghi lại các quyết định và công việc của cuộc chat hiện tại để tiếp tục ngày hôm sau, không cần mở lại link chia sẻ. Đây là context bàn giao, không phải bản chép nguyên văn hội thoại. Nếu mô tả cũ bên dưới khác mục này, lấy quyết định mới tại đây và đối chiếu mã thực tế.

### Những yêu cầu mới đã chốt và đã sửa trong file local

- Engine dùng chung Dự chi, Thanh toán, Tạm ứng. Dự chi/Thanh toán dùng esdHTKTpayment; Tạm ứng dùng esdHTKTprepayment. Người dùng xác nhận ID không trùng vì có prefix DC, TT, TU. Job đọc bảng theo prefix, không tìm thử cả hai bảng.
- Bỏ các alias/hàm mang tên Expense trong SLA ENGINE và JOB. Hai hàm cầu nối tên Expense ở expense/ESD_HTKT_EXPENSE_WF.js vẫn là cầu nối workflow cũ, không phải engine riêng cho Dự chi. Hàm gọi mới trực tiếp không cần qua cầu nối này.
- role.code thống nhất theo dbdict: user.created.dmms, user.checker.kttc, user.checker.dmms, user.approver.dmms, user.approver.kttc, user.checker.final, user.approver.final. user.created.dmms là mã vai trò, người tạo thực tế vẫn lấy field created.by. Không dùng các mã CB_DE_NGHI/CB_KTTC/RA_SOAT_1/PHE_DUYET_DM/PHE_DUYET_KTTC/RA_SOAT_2/PHE_DUYET_TQ cho dữ liệu mới.
- Người dùng làm rõ chỉ bỏ đo khi status dmms_created/kttc_created, không bỏ toàn bộ phase initial_dmms/initial_kttc. Engine cũng coi initialized (thấy trong workflow Tạm ứng) là tạo mới, không đo. CREATE không mở Tracking/Segment. ĐMMS gửi sang KTTC bắt đầu đo KTTC; KTTC tạo gửi PD KTTC bắt đầu đo PD KTTC. RETURN về request_edit vẫn bắt đầu maker vòng mới.
- Đã bỏ field source.table khỏi ENGINE, JOB, Tracking, EventLog và schema. Không thêm lại để chống trùng ID vì prefix đã phân biệt. Tracking/EventLog ID không ghép bảng nguồn. Engine vẫn có hàm/biến nội bộ xác định bảng; đó không phải field dữ liệu.
- Đã bỏ sla.config.id khỏi Tracking, cả danh sách field đọc/ghi, câu tạo Tracking và Ref dbdict. Tracking chỉ giữ sla.config.detail.id; suy ra Config qua ConfigDetail.sla.config.id. ConfigDetail.sla.config.id vẫn giữ. SLA tính từ sla.minutes chốt trên Tracking, không cần đọc lại định mức Config mỗi lượt.
- Unique index Tracking hiện là (payment.id, attempt.no, role.code); payment.id giữ nguyên ID phiếu gồm prefix. Không tạo FK payment.id chỉ trỏ esdHTKTpayment vì phiếu TU nằm bảng khác.

### API workflow hiện tại và điều kiện phải xác nhận trên SM

Lời gọi gọn đã được triển khai, không phải tên hàm đề xuất nữa:

```javascript
lib.ESD_HTKT_SLA_ENGINE.onWorkflowChanged(oldRecord, record);
```

- oldRecord là bản trước của chính thao tác; record là bản sau đã lưu thành công. Hàm tự nhận diện CREATE/TRANSITION/RETURN/CANCEL/REASSIGN; bỏ qua thay đổi không liên quan và cập nhật sau khi kết thúc. Thay status không khớp chuyển phase được hỗ trợ thì báo lỗi, không tự đoán.
- Chỉ truyền oldRecord=null khi tạo mới có status tạo mới; phiếu đang xử lý mà thiếu bản trước sẽ báo SLA_REQUIRE_OLD_RECORD. Không đọc lại DB sau chuyển bước để thay bản trước.
- record sau lưu cần sysmodcount, sysmodtime, sysmoduser. Wrapper lấy operationId từ sysmodcount + thời điểm sysmodtime; eventAt từ sysmodtime, performedBy từ sysmoduser. Không dùng Date mới/UUID mới mỗi retry. Retry phải giữ đúng hai record và metadata của thao tác ban đầu.
- Chưa xác nhận SM thực tế có sysmodcount ở Rule Set, kiểu datetime sysmodtime có được toMillis đọc đúng, hay sysmoduser có còn là người thao tác sau các cập nhật trung gian. Thiếu field wrapper sẽ báo lỗi rõ. Nếu cần adapter, dùng createRuntime(adapterOptions).onWorkflowChanged(oldRecord, record), hoặc cấu hình tập trung sau khi xác minh kiểu SM.
- onBusinessCommitted(kind,before,after,context) vẫn còn làm API cấp thấp cho caller có context ổn định riêng. Hai API cùng dùng một engine, không gọi cả hai cho cùng thao tác.
- transaction.type vẫn cần đúng giá trị Dự chi/Tạm ứng/Thanh toán để chọn Config. Nếu record Tạm ứng không có field này thực tế, phải chuẩn hóa object đầu vào; chưa xác nhận field trên SM.

### Điểm đang dừng: kiểm tra oldRecord trong Rule Set

Người dùng gửi ảnh Process Designer của workflow ESD_HTKT_PAYMENT, bảng esdHTKTpayment; chọn phase CB DMMS, tab Rule Sets. Có các tab On enter, After successful enter, On exit, Initialization, On display, On update, After successful update.

Đã hướng dẫn gắn Rule Set Run JavaScript ở After successful enter của phase ĐÍCH, vì chạy sau khi vào phase thành công. Dùng cùng logic tại các phase KTTC, RS1, PD ĐMMS, PD KTTC, RS2, cấp thẩm quyền, End và maker khi trả sửa. REASSIGN cần điểm sau lưu người xử lý ngay cả khi phase không đổi. Chỉ chọn một nguồn gọi cho mỗi thao tác, không gắn hai tab rồi tự tạo hai sự kiện.

Câu hỏi gần nhất của người dùng: Rule Set có nhận diện oldRecord không? Đã trả lời tài liệu OpenText có record/oldRecord, phân biệt hoa thường; oldReocrd là sai chính tả, oldrecord là biến khác. Tuy nhiên CHƯA kiểm chứng After successful enter trên hệ thống này còn giữ bản trước đúng thao tác. Đây là việc đầu tiên nên làm ngày mai.

Mẫu kiểm tra đã gửi:

```javascript
if (typeof oldRecord === "undefined" || !oldRecord) {
    throw new Error("Rule Set không có biến oldRecord");
}
lib.ESD_HTKT_SLA_ENGINE.onWorkflowChanged(oldRecord, record);
```

Thử CB ĐMMS -> CB KTTC: oldRecord.current.phase phải initial_dmms, record.current.phase phải initial_kttc; đồng thời đối chiếu status trước/sau và sysmodcount/sysmodtime/sysmoduser. Đoạn kiểm tra thiếu oldRecord chỉ dành thử chuyển bước, không dùng để chặn CREATE vốn cho phép null. Nếu oldRecord không tồn tại/đã bị thay, phải giữ snapshot trước thao tác qua context action/process phù hợp; không giả định var ở Rule Set này sẽ tồn tại ở Rule Set khác.

Nguồn đã đối chiếu:
- https://docs.microfocus.com/doc/Service_Manager/9.80/AddPhase (After successful enter và After successful update).
- https://docs.microfocus.com/doc/425/9.71/runactiononrelatedrecords (record/oldRecord; chưa chứng minh lifecycle chính xác trong Rule Set đang dùng).

### Job và PREPARED — đã giải thích cho người dùng

- JOB.runBatch(runtime,asOf,batch) hiện đọc TOÀN BỘ Tracking bằng store.list(...,{}), rồi lọc ended.at rỗng trong JavaScript. EventLog truy vấn processing.status=PREPARED. Gộp payment.id, loại trùng, sort tăng dần, xử lý tối đa limit (mặc định 100); afterPaymentId/nextCursor là ID phiếu. limit chưa giảm số Tracking đọc từ DB.
- Mỗi phiếu đọc bảng theo TU/DC/TT, bỏ qua không tìm thấy/transaction.type không hỗ trợ; retryPrepared trước rồi refresh. Prefix lạ hiện có thể làm lỗi ngay lúc thu danh sách trước vòng try/catch từng phiếu; chưa tối ưu phần này.
- Refresh chỉ xử lý Tracking mở: tính lại Tracking.due.at, Tracking.status và TimeSegment.working.minutes (segment mở tính đến asOf). Code ghi lại toàn bộ row đã đọc nhưng chỉ ba field nghiệp vụ này tính lại; có thể được SM tự cập nhật sysmodtime/sysmoduser. Không đổi status/phase phiếu, không gửi mail, không tự kết thúc Tracking.
- Phiếu approved/accounted/cancelled còn Tracking mở thì báo SLA_MISSING_TERMINAL_WORKFLOW_EVENT, không tự đóng thay workflow.
- EventLog WORKFLOW PREPARED = đã lưu kế hoạch ghi JSON nhưng chưa xác nhận áp dụng xong tất cả Tracking/Segment/log. Ghi xong chuyển APPLIED. Nếu lỗi giữa chừng, retry/job áp dụng lại kế hoạch để hoàn tất, không sinh thao tác mới. Log chi tiết không dùng processing.status.
- PREPARED là trạng thái kỹ thuật; tồn tại ngắn trong ghi bình thường, kéo dài có thể do gián đoạn. Không phải trạng thái SLA hay trạng thái phiếu. Job phục hồi có thể ghi nhiều field/bản ghi theo kế hoạch cũ, không chỉ ba field refresh nêu trên.

### File đã sửa và bằng chứng kiểm tra

Đã sửa local: sla/ESD_HTKT_SLA_ENGINE.js, sla/ESD_HTKT_SLA_JOB.js, sla/tests/sla.test.cjs, dbdict/SLA.sql và sla/README.md. Lần kiểm tra code cuối sau bỏ sla.config.id ở Tracking: node --check engine đạt; node tests/sla.test.cjs đạt 27/27. Job đã được kiểm tra cú pháp sau thay prefix. Bộ test là Node với store/SCFile giả lập, KHÔNG phải SM tích hợp.

Chưa import SL, chưa sửa dbdict thật, chưa gắn Rule Set/scheduler, chưa chạy/migration dữ liệu SM trong chat này. Người dùng nói đã có SL/dbdict và đã thay đổi trước đó, nhưng không suy ra các thay đổi local mới đã được đưa lên SM. Cần đối chiếu bản thực tế trước khi triển khai. Không tự làm API quản trị/UI/frontend/mail vì vẫn ngoài phạm vi đã chốt.

### Thứ tự tiếp tục ngày mai

1. Xác nhận oldRecord và metadata ngay trong Rule Set After successful enter trên môi trường thử nghiệm; lấy kết quả thực tế trước khi tiếp tục thiết kế cầu nối.
2. Xác nhận SM datetime/date adapter và transaction.type của Tạm ứng; đối chiếu status/phase thực tế vì workflow có thể gán status ở bước khác với tên phase.
3. Đối chiếu dbdict đang có với SLA.sql (DBML): không source.table, không Tracking.sla.config.id, đúng role.code và unique index, đủ kích thước ID/JSON/decimal.
4. Import bản SL đúng và gắn lời gọi hai record tại điểm thành công, một nguồn duy nhất; kiểm tra không ghi SLA khi ký/chuyển bước thất bại.
5. Chạy hai nhánh, TU/DC/TT, RS bật/tắt, trả sửa, xóa, đổi người, retry PREPARED, lịch nghỉ, quá hạn; scheduler/job chỉ sau khi workflow đã ghi đúng.

Câu mở chat để tiếp tục:

> Đọc C:/workspace/sl/sla/README.md, ưu tiên mục Bàn giao cuối phiên 28/10/2026. Tiếp tục nối onWorkflowChanged(oldRecord,record) ở Rule Set After successful enter. Xác minh oldRecord, sysmodcount/sysmodtime/sysmoduser và datetime trên SM trước. Tạm ứng dùng esdHTKTprepayment; DC/TT dùng esdHTKTpayment, prefix ID duy nhất; không source.table và không Tracking.sla.config.id. Không giả định code local đã import SM.

## Bàn giao để tiếp tục trên máy khác

Cập nhật ngày 28/10/2026, múi giờ Asia/Saigon. Đọc mục này trước rồi đọc các phần triển khai bên dưới; không cần có lịch sử chat để tiếp tục. Đây là bản tóm tắt quyết định và trạng thái công việc, không phải bản chép nguyên văn hội thoại.

### Mục tiêu và phạm vi đã thống nhất

Ban đầu dự định dùng SLA của OpenText SM, sau đó chuyển sang tự đo/tính/lưu SLA. Engine dùng chung policy; Dự chi/Thanh toán ở `esdHTKTpayment`, Tạm ứng ở `esdHTKTprepayment`. Giai đoạn tạm thời chỉ phân biệt định mức bằng `transaction.type`; mọi cấu hình dùng `product.type = "Tất cả"`. Tài liệu Tạm ứng được dùng làm nguồn tham khảo luồng hai nhánh.

Người dùng đã làm rõ: phải ghi đủ các bảng để tròn một vòng đời SLA; không được chỉ viết hàm tính thuần. Chỉ hoãn API quản trị/tra cứu như danh sách cấu hình, quản lý lịch, xem lịch sử. Các entry point server/workflow, bootstrap triển khai và job vẫn nằm trong phạm vi.

Các mốc do người dùng đính chính có ưu tiên hơn nội dung sai/mâu thuẫn trong tài liệu:

- ĐMMS tạo: ĐMMS → KTTC → RS1 nếu bật → PD ĐMMS → PD KTTC → RS2 nếu bật → cấp có thẩm quyền.
- KTTC tạo: KTTC → PD KTTC → RS2 nếu bật → cấp có thẩm quyền; không có RS1/PD ĐMMS.
- **RS2 trong nhánh ĐMMS tạo:** bắt đầu khi PD ĐMMS chuyển thành công, kết thúc khi RS2 chuyển sang cấp có thẩm quyền. Người dùng đã nói rõ mốc này; không tự sửa thành bắt đầu sau PD KTTC chỉ vì thấy thứ tự xử lý tuần tự.
- **RS2 trong nhánh KTTC tạo:** người dùng trả lời câu hỏi riêng, chọn bắt đầu khi PD KTTC chuyển sang RS2.
- Thêm lịch/ngày nghỉ; bổ sung CANCEL và lý do kết thúc Segment do REASSIGN đã được người dùng yêu cầu.

Các lựa chọn kỹ thuật hiện tại cần phân biệt với yêu cầu xác nhận trực tiếp: ưu tiên gọi từ workflow sau thành công là đánh giá của agent; nhật ký PREPARED/APPLIED và adapter mail là thiết kế triển khai. Không đo khi status là `dmms_created`/`kttc_created`; maker vòng trả sửa chạy từ lúc trả sửa thành công; chạm hạn `remaining <= 0` là vi phạm theo sheet quy tắc hiển thị. Các lựa chọn này đã ghi trong mã/tài liệu nhưng chưa được kiểm chứng trên SM thật.

### Trạng thái mã nguồn lúc bàn giao

- Có 2 SL trong thư mục `sla/`, một file test và README này. Engine chứa cả policy luồng, tính toán và ghi dữ liệu; Job là entry point định kỳ tùy chọn.
- Chỉ bổ sung hai hàm cầu nối ở cuối `expense/ESD_HTKT_EXPENSE_WF.js`; chưa gọi tự động từ luồng hiện tại.
- `dbdict/SLA.sql` hiện là **DBML**, có 7 bảng; không có bảng khóa, Calendar hoặc AlertHistory. Chưa chạy tạo bảng trong SM.
- Không sửa `payment/esdHTKTpayment.activity.update.js`; chưa chuyển sang bắt sự kiện bằng trigger.
- Bộ kiểm thử Node sử dụng lưu trữ mô phỏng, có mô phỏng SCFile và lỗi ghi. 2 SL và SL workflow sửa đều được kiểm tra cú pháp. **Không đồng nghĩa đã kiểm thử tích hợp SM thật.**
- Chưa tạo API quản trị, UI SLA hoặc API đọc lịch sử.

### File và nguồn cần mang theo

Thư mục làm việc chính của phần backend SLA là `C:/workspace/sl`, nằm ngoài repo frontend `C:/workspace/vtb-csep-addon`. Chỉ chép/pull repo frontend sẽ không bảo đảm mang theo các SL/schema/tài liệu ở thư mục `sl`.

Nên chuyển nguyên thư mục `C:/workspace/sl` sang máy mới; tối thiểu phải có:

- `sla/` gồm 2 SL (`ENGINE`, `JOB`), `README.md`, `tests/sla.test.cjs`.
- `dbdict/SLA.sql` và các schema nghiệp vụ hiện có.
- `expense/`, `payment/` và các SL dùng chung ở gốc để tiếp tục đối chiếu/tích hợp, đặc biệt `ESD_ApiCustomScript_HTKT.js`.
- `tài liệu/FSD+Tạm+ứng.doc`: nguồn luồng, mục 2.1 và 2.3. File mang đuôi .doc nhưng thực tế là bản xuất Confluence dạng MIME/HTML; không phải Word binary thông thường.
- `tài liệu/Thông tin SLA.xlsx`: các sheet `Danh mục SLA`, `Quy tắc đo SLA`, `Gửi mail cảnh báo + Trạng thái `. Tạm thời gom định mức theo `transaction.type` với sản phẩm `"Tất cả"`; không trộn quy tắc tính theo ngày vào cấu hình tính theo giờ hành chính.
- `tài liệu/Cấu hình Sla.pdf` và `tài liệu/SLA New table configure.docx`: tài liệu cấu hình cơ chế SLA SM cũ, chỉ tham khảo; không phải hướng triển khai engine hiện tại.

Các tài liệu tham khảo hiện nằm trong `sl/tài liệu/`; lúc đầu hội thoại từng được đặt tại `sl/sla/`. Thư mục `sla/.analysis/` chỉ là bản text trích xuất để đọc tài liệu, không phải nguồn chuẩn và không cần cho runtime/test.

Nếu tiếp tục phần frontend, mang theo repo `C:/workspace/vtb-csep-addon`. File người dùng chỉ ra để xem trạng thái là `src/app/ess/[token]/path/HachToanKeToan/BaoCao/LietKeGiaoDich/hooks/useHook.tsx`. Có thể đối chiếu thêm `src/app/ess/[token]/path/TamUngMuaSam/DanhSachTamUng/ constants/status.ts` (tên thư mục có dấu cách ở đầu) và `TamUngMuaSam/ThongTinPheDuyet/page.tsx`. Không cần sửa frontend trong đợt hiện tại.

### Status và phase người dùng cung cấp

Đây là hai trường riêng, không tự ánh xạ một-một chỉ dựa trên hai danh sách:

| Status | Nhãn |
|---|---|
| dmms_created, kttc_created | Tạo mới |
| dmms_initiated | Chờ KTTC xử lý |
| kttc_checked, dmms_checked, dmms_approved, kttc_approved, checked | Chờ phê duyệt |
| approved | Đã phê duyệt |
| cancelled | Đã xóa |
| request_edit | Chờ chỉnh sửa |
| accounted | Đã hạch toán |

| Current phase | Vai trò / role.code |
|---|---|
| initial_dmms | CB đề nghị / user.created.dmms |
| initial_kttc | CB KTTC / user.checker.kttc |
| check_dmms | RS1 / user.checker.dmms |
| approval_dmms | PD ĐMMS / user.approver.dmms |
| approval_kttc | PD KTTC / user.approver.kttc |
| check_final | RS2 / user.checker.final |
| approval_final | Cấp có thẩm quyền / user.approver.final |

`start` và `end` còn xuất hiện ở mã tạo phiếu/workflow; chúng là phase kỹ thuật ngoài mảng 7 phase người dùng liệt kê. Ghi đúng status/phase thực tế trước và sau trong EventLog, không suy đoán từ nhãn "Chờ phê duyệt".

### Công việc tiếp theo trên máy mới

1. Đọc README và chạy lại `node tests/sla.test.cjs` từ thư mục `sl/sla` để xác nhận đủ file sau khi chuyển máy; hiện kỳ vọng 27 test pass.
2. Đối chiếu mã và schema mới trước khi import. Xác nhận kích thước trường ID, text JSON kế hoạch ghi, decimal, PK và unique index trong dbdict SM.
3. Trên môi trường thử nghiệm, tạo bảng/index, import 2 SL và các cầu nối workflow; nhập giờ làm việc/ngày nghỉ dùng chung, rồi bootstrap một cấu hình `product.type = "Tất cả"` cho từng `transaction.type`.
4. Xác nhận cách SM thực tế trả/lưu datetime/date/time và điền adapter nếu cần. Không đoán chuỗi ngày theo locale.
5. Xem Rule Sets/action thực tế của workflow `ESD_HTKT_PAYMENT` trên bảng `esdHTKTpayment`; chọn điểm gọi sau thành công, chụp snapshot trước, giữ operationId/eventAt/performedBy ổn định. Chưa có bản export cấu hình Rule Sets để sửa tự động.
6. Nối CREATE ở sau tạo thành công; TRANSITION/RETURN/CANCEL sau nghiệp vụ thành công; REASSIGN tại điểm lưu người phê duyệt thành công. Kiểm tra việc `doUpdate()` có chạy workflow không. Không gắn hai nguồn khiến ghi hai lần.
7. Nếu cần trạng thái vi phạm của Tracking đang mở được cập nhật định kỳ, cấu hình scheduler gọi `runBatch`. Gửi mail nằm ngoài phạm vi engine SLA này.
8. Chạy tích hợp SM qua hai nhánh, RS1/RS2 bật/tắt, ký số thất bại/thành công, trả sửa nhiều vòng, tái phân công, xóa, ngày nghỉ, job đồng thời và retry. Chỉ sau đó mới coi là đã đưa vào vận hành. API quản trị vẫn hoãn trừ khi người dùng đổi phạm vi.

Có thể mở chat mới trên máy khác bằng câu sau:

> Tiếp tục triển khai SLA tự tính dùng chung cho Dự chi, Tạm ứng và Thanh toán. Đọc C:/workspace/sl/sla/README.md rồi đối chiếu các SL và schema. Ba loại giao dịch dùng chung policy luồng; tạm thời transaction.type chọn cấu hình và product.type luôn là "Tất cả". Phải ghi đủ vòng đời SLA, chưa làm API quản trị. Báo trạng thái thực tế và tiếp tục phần tích hợp SM còn thiếu; không giả định đã import hoặc gắn workflow.

## Cập nhật tích hợp workflow ngày 28/10/2026

Engine và bootstrap dùng role.code theo dbdict: user.created.dmms, user.checker.kttc, user.checker.dmms, user.approver.dmms, user.approver.kttc, user.checker.final, user.approver.final. Dữ liệu cấu hình dùng mã cũ cần được chuyển đổi trước khi dùng engine mới; chưa tự migration dữ liệu SM.

Không đo ở status dmms_created/kttc_created. CREATE chỉ ghi nhật ký, không tạo Tracking/Segment. Nhánh ĐMMS gửi sang initial_kttc bắt đầu đo user.checker.kttc; nhánh KTTC gửi sang approval_kttc bắt đầu đo user.approver.kttc. request_edit vẫn đo maker theo quy tắc trả sửa đã chốt.

Có thể cấu hình workflow gọi SL sau mỗi lần chuyển phase thành công. Chụp snapshot trước thao tác và truyền snapshot cùng record sau lưu vào createRuntime(options).onBusinessCommitted(kind, before, record, context), hoặc dùng cầu nối recordCommittedExpenseSlaEvent hiện có. TRANSITION cho chuyển bước thông thường; RETURN/CANCEL phải truyền đúng kind. REASSIGN gọi riêng tại điểm lưu người xử lý dù status/phase không đổi. Không gọi chỉ vì cập nhật trường khác hoặc hạch toán sau approved. Cần giữ operationId/eventAt/performedBy ổn định và context trước/sau khi retry. Chưa tự sửa cấu hình Rule Sets trên SM.

## Hàm gọi trực tiếp từ Rule Set (hai record)

Sau khi lưu/chuyển phase thành công, gọi:

```javascript
lib.ESD_HTKT_SLA_ENGINE.onWorkflowChanged(oldRecord, record);
```

oldRecord phải là bản trước của chính thao tác, record là bản sau đã lưu. Tên biến có phân biệt hoa/thường; xác nhận oldRecord có trong Rule Set thực tế. Chỉ truyền null khi tạo mới ở status tạo mới; thiếu bản cũ khi phiếu đang xử lý sẽ báo SLA_REQUIRE_OLD_RECORD. Không đọc lại DB sau lưu để thay cho oldRecord.

Hàm tự nhận diện CREATE/TRANSITION/RETURN/CANCEL/REASSIGN, bỏ qua cập nhật không liên quan và cập nhật sau trạng thái kết thúc. Status thay đổi không thuộc chuyển bước được hỗ trợ sẽ báo lỗi để tránh bỏ sót SLA. Không đo ở các status tạo mới. Cùng dùng cho payment/prepayment như quy tắc bảng nguồn bên dưới.

Để tự tạo context ổn định, record sau lưu bắt buộc có sysmodcount (số phiên bản cập nhật), sysmodtime (thời điểm lưu), sysmoduser (người lưu). event ID ghép phiên bản và thời điểm; eventAt lấy sysmodtime, performedBy lấy sysmoduser. Retry phải truyền lại đúng hai bản ghi cùng metadata ban đầu; không đọc record phiên bản mới hơn hoặc tạo Date mới. sysmoduser là người/service ghi cuối, chưa chắc là người dùng thao tác nếu có cập nhật trung gian. Gọi trước các cập nhật hệ thống làm thay đổi metadata này.

Không tự đoán datetime theo locale. Nếu SM trả sysmodtime ở kiểu chưa hỗ trợ, cấu hình adapter tập trung và gọi createRuntime(adapterOptions).onWorkflowChanged(oldRecord, record). Hàm trực tiếp mặc định dùng adapter mặc định; chưa xác nhận kiểu datetime và sysmodcount trên SM thật. Thiếu metadata sẽ báo lỗi rõ, không tự sinh ID/thời gian mới.

Gắn tại After successful enter để bắt chuyển bước; REASSIGN cần điểm sau lưu người xử lý (có thể After successful update nếu luồng đó chạy workflow). Một lần nghiệp vụ chọn một nguồn gọi, không tự gắn đồng thời hai tab. Entry point onBusinessCommitted vẫn giữ cho caller cần truyền context rõ ràng.

## Bảng phiếu và API dùng chung

ID có prefix duy nhất: DC = Dự chi, TT = Thanh toán, TU = Tạm ứng. Không lưu trường bảng nguồn trong Tracking, EventLog hoặc snapshot. payment.id là ID đầy đủ gồm prefix. Unique index Tracking: (payment.id, attempt.no, role.code). Không có FK chỉ trỏ bảng payment vì phiếu TU nằm ở bảng khác.

Job và service.refresh(id, asOf) nhận diện TU để đọc esdHTKTprepayment, DC/TT để đọc esdHTKTpayment. Prefix không nhận diện được sẽ báo lỗi. nextCursor là ID phiếu, truyền nguyên lại qua afterPaymentId. Engine vẫn dùng transaction.type trên record để chọn cấu hình SLA; phiếu Tạm ứng phải có transaction.type = "Tạm ứng" trong dữ liệu truyền vào.

Đã bỏ alias Expense khỏi ENGINE/JOB. Dùng calculateTransactionTracking, service.applyEvent, service.refresh, service.retryPrepared, buildBaseline/installBaseline và JOB.runBatch. Tuần tự hóa thao tác/job theo payment.id. ID Tracking/EventLog không cần thành phần bảng nguồn. Nếu đã có dữ liệu từ bản trung gian sử dụng ID chứa bảng nguồn, cần đối chiếu/chuyển đổi ID và tham chiếu trước khi chạy bản mới; chưa thay đổi dữ liệu SM.

## Luồng nghiệp vụ

Đối chiếu mục 2.1 và 2.3 của `C:/workspace/sl/tài liệu/FSD+Tạm+ứng.doc`. Quy tắc dưới đây dùng chung cho Dự chi, Tạm ứng và Thanh toán:

- ĐMMS tạo: CB ĐMMS → CB KTTC → RS1 nếu bật → PD ĐMMS → PD KTTC → RS2 nếu bật → Cấp có thẩm quyền.
- KTTC tạo: CB KTTC → PD KTTC → RS2 nếu bật → Cấp có thẩm quyền. Bỏ hoàn toàn RS1 và PD ĐMMS, kể cả khi dữ liệu cũ còn cờ RS1.
- Phiếu vừa tạo có `current.phase = start`. Khi status còn `dmms_created`/`kttc_created` không tạo Tracking/Segment. Khi gửi xử lý thành công, bắt đầu đo bước đích tại thời điểm thao tác; không đo bù thời gian tạo mới.
- RS2 của luồng ĐMMS tạo bắt đầu ngay khi PD ĐMMS chuyển thành công, kết thúc khi RS2 chuyển sang cấp có thẩm quyền. Đây là ngoại lệ mốc đo do người dùng chốt; có thể chạy đồng thời với PD KTTC dù thứ tự xử lý vẫn tuần tự.
- RS2 của luồng KTTC tạo bắt đầu khi PD KTTC chuyển sang RS2, theo xác nhận của người dùng.
- Trả sửa: kết thúc mọi Tracking đang mở của vòng cũ, giữ lịch sử, tăng vòng đo và bắt đầu ngay maker của vòng mới. Không đợi người sửa mở màn hình.
- Tái phân công bước đang đo: đóng/mở Segment liên tiếp tại cùng thời điểm, không đổi Tracking/hạn/budget. Bước chưa tới lượt chỉ ghi EventLog.
- Xóa: đóng mọi Tracking/Segment đang mở; không xóa lịch sử. Chỉ phát sinh sau khi nghiệp vụ xóa thành công.
- Đã phê duyệt kết thúc đồng hồ cuối. Không đo thêm thời gian tích hợp/hạch toán.

Các role.code dùng trong cấu hình: `user.created.dmms`, `user.checker.kttc`, `user.checker.dmms`, `user.approver.dmms`, `user.approver.kttc`, `user.checker.final`, `user.approver.final`.

## Các Script Library

| File | Trách nhiệm |
|---|---|
| ESD_HTKT_SLA_ENGINE.js | Policy phase/role/command, lịch, tính toán, SCFile, Tracking, Segment, EventLog, runtime workflow và bootstrap cấu hình |
| ESD_HTKT_SLA_JOB.js | Entry point scheduler: tính lại due/status của Tracking mở và phục hồi PREPARED |

Tạm thời engine chọn cấu hình bằng `transaction.type` và bắt buộc dòng cấu hình có `product.type = "Tất cả"`. Engine không yêu cầu `product.type` trên phiếu. Khi nghiệp vụ chốt nguồn/trường lưu sản phẩm, chỉ cần sửa `resolveProductType()` và bổ sung cấu hình chi tiết; policy luồng không thay đổi.

`expense/ESD_HTKT_EXPENSE_WF.js` đã có hai hàm cầu nối `captureExpenseSlaSnapshot` và `recordCommittedExpenseSlaEvent`. Chưa gọi chúng trong validation và chưa đổi hành vi nghiệp vụ hiện tại.

## Workflow hay trigger

Ưu tiên workflow cho sự kiện nghiệp vụ. Trigger phù hợp làm nơi quan sát tập trung khi thực sự có cả giá trị trước/sau đã lưu, nhưng khó phân biệt cập nhật hệ thống, ký thất bại, lưu nháp và trả sửa. Chỉ so phase sẽ bỏ sót tái phân công và một số thay đổi status.

Theo tài liệu OpenText, `After successful enter` chạy sau khi vào phase thành công; `After successful update` chạy sau khi lưu bản ghi thành công. `On update` chạy trước khi lưu. Vì vậy:

| Sự kiện | Điểm gọi đề xuất | kind |
|---|---|---|
| Tạo phiếu thành công | Sau RC_SUCCESS của add, hoặc After successful add tương ứng; chọn một nguồn duy nhất | CREATE |
| Chuyển bước đã thành công | After successful enter ở phase đích | TRANSITION |
| Trả sửa đã lưu | Điểm thành công của action trả sửa/phase đích | RETURN |
| Xóa nghiệp vụ đã lưu `cancelled` | Điểm thành công của action xóa/phase end | CANCEL |
| Tái phân công đã lưu | Sau `doUpdate() === RC_SUCCESS` trong luồng lưu thông tin phê duyệt, hoặc After successful update nếu điểm đó có chạy workflow | REASSIGN |

Không giả định `doUpdate()` trực tiếp luôn chạy Rule Sets của workflow. Kiểm tra điểm lưu tái phân công trong `payment/ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.js`. Không gắn cùng một thao tác vào cả trigger và workflow với hai operationId khác nhau.

Nguồn OpenText: https://docs.microfocus.com/doc/Service_Manager/9.80/AddPhase

### Contract gọi từ workflow

Chụp snapshot trước khi workflow/action sửa dữ liệu; đây chỉ là đọc và không ghi SLA. Sau khi nghiệp vụ lưu thành công, gọi hàm ghi với cả hai snapshot và context ổn định:

```javascript
// Trước thao tác; giữ snapshot trong context của chính operation đó.
var beforeSla = lib.ESD_HTKT_EXPENSE_WF.captureExpenseSlaSnapshot(record);

// Sau khi lưu/chuyển bước và ký số (nếu có) đã thành công:
lib.ESD_HTKT_EXPENSE_WF.recordCommittedExpenseSlaEvent(
    "TRANSITION", beforeSla, record,
    {
        operationId: stableBusinessOperationId,
        eventAt: businessOperationTimestamp,
        performedBy: actingContactName
    }
);
```

Ba biến context ở ví dụ là dữ liệu phải lấy từ action/ruleset thực tế, không phải tên biến có sẵn của SM. `operationId` phải tạo một lần cho thao tác và giữ nguyên khi retry; không tạo UUID hoặc lấy `new Date()` mới mỗi lần gọi lại. Snapshot phải là bản trước/sau của chính thao tác đó, không đọc lại bản hiện tại để thay snapshot khi retry. Không dùng `from.status` đơn lẻ để suy ra phase.

Tạo mới dùng `kind=CREATE`, `before=null`; có thể dùng operationId `CREATE:<payment.id>` và thời điểm `created.at`. Các thao tác khác cần ID thao tác riêng. Trong trường hợp lỗi sau khi lưu phiếu nhưng trước khi ghi nhật ký SLA, nguồn gọi phải lưu/giữ context để retry. Nhật ký PREPARED chỉ phục hồi được sau khi INSERT nhật ký thành công; không có transaction chung giữa lưu phiếu và các bảng SLA.

Lỗi SLA sau khi phiếu đã lưu phải được báo rõ là lỗi ghi SLA để retry, không thông báo phiếu chưa được tạo khiến người dùng tạo trùng. Không bắt lỗi rồi bỏ qua vô điều kiện.

## Các bảng được ghi

- Bootstrap tạo Calendar, WorkingHour, Holiday, Config và ConfigDetail. Config xuất bản sau cùng để tránh thấy bộ cấu hình chưa đủ vai trò.
- Bắt đầu: Tracking + TimeSegment + EventLog START/RESET.
- Hoàn thành: chốt Segment/Tracking, ghi COMPLETE. Kết quả `MET`, `BREACHED` hoặc `NOT_EVALUATED` tách khỏi trạng thái đã kết thúc.
- REASSIGN/RETURN/CANCEL: ghi đủ nguyên nhân và snapshot status/phase; giữ dữ liệu cũ.
- Job: tính lại Segment cùng `due.at`/`status` của Tracking đang mở; không lưu elapsed/remaining và không tạo cảnh báo.
- EventLog WORKFLOW là nhật ký áp dụng thao tác: PREPARED lưu kế hoạch ghi đầy đủ trước khi cập nhật, APPLIED sau khi ghi xong. Các log chi tiết có processing.status null.
- Không sử dụng bảng khóa SLA. Workflow, scheduler và dispatcher phải được cấu hình để không xử lý đồng thời cùng một `payment.id`. Nhật ký PREPARED/APPLIED và các unique index vẫn hỗ trợ retry/chống trùng, nhưng không thay thế việc tuần tự hóa ở tầng vận hành.

## Cấu hình và lịch ban đầu

Dùng schema DBML `../dbdict/SLA.sql` để tạo dbdict/index thực tế. Chưa phải migration SQL có thể chạy trực tiếp. Các trường số phút dùng decimal; `EventLog.data` phải đủ lớn cho JSON kế hoạch ghi và `id` phải đủ dài cho ID ghép đã encode.

`buildBaseline(calendarLib, args)` tạo bộ dữ liệu để xem trước; `installBaseline(store, calendarLib, args)` thực sự ghi dữ liệu. Args cần `configId`, `transactionType`, `effectiveFrom`, `performedBy` và `holidays`; `effectiveTo` tùy chọn. Bootstrap luôn ghi `product.type = "Tất cả"`. Giờ làm việc và ngày nghỉ là cấu hình toàn hệ thống, được ghi đè theo ID; không có `calendarId` hoặc phiên bản lịch.

Bộ giá trị Dự chi lấy từ `Thông tin SLA.xlsx`, sheet `Danh mục SLA`, dòng 19: CB đề nghị 2h; KTTC 3h; RS1 3h; PD ĐMMS 6h; PD KTTC 6h; RS2 4,5h; cấp thẩm quyền 9h. Cấu hình Dự chi có `product.type = "Tất cả"`. Hiệu lực theo khoảng `[effective.from, effective.to)`; không cho chồng lấn. Budget được chốt trên Tracking khi bắt đầu bước; Tracking đang mở dùng giờ làm việc/ngày nghỉ hiện hành khi tính lại.

Timestamp dùng JS Date hoặc ISO có Z/offset; không parse chuỗi ngày theo locale. `start.time` và `end.time` là field Character dài 5, bắt buộc định dạng `HH:mm`; không dùng Date/time của SM. Ngày nghỉ dùng YYYY-MM-DD. Store chỉ cần adapter cho instant và ngày. Version hiện hỗ trợ Asia/Ho_Chi_Minh, không hỗ trợ vùng DST.

Phút giữ phần lẻ, chỉ làm tròn khi hiển thị. Theo quy tắc hiển thị đã cung cấp, chạm hạn (`remaining <= 0`) là vi phạm; mail BREACH dùng cùng quy ước. Ngoài giờ và ngày nghỉ không tách Segment. Tạm dừng có khoảng hở sẽ được loại thời gian; khi chưa tiếp tục thì chưa xác định được hạn tương lai. Chưa thêm action tạm dừng vào luồng Dự chi vì chưa có nghiệp vụ tương ứng.

## Job tính lại trạng thái

```javascript
var rt = lib.ESD_HTKT_SLA_ENGINE.createRuntime(dateTimeAdapterOptions);
var batchResult = lib.ESD_HTKT_SLA_JOB.runBatch(rt, new Date(), {limit:100});
// Nếu nextCursor != null, tiếp tục với afterPaymentId = nextCursor.
// Một vòng kết thúc thì lần chạy định kỳ tiếp theo bắt đầu cursor rỗng.
```

Job là tùy chọn. Chỉ cần chạy định kỳ nếu muốn `status` của Tracking đang mở chuyển sang `Vi phạm` mà không chờ sự kiện workflow tiếp theo. Job không lưu `elapsed.minutes`/`remaining.minutes`, không tạo AlertHistory và không gửi mail. Cơ chế gửi mail được triển khai độc lập.

## Kiểm thử và giới hạn triển khai

Chạy `node tests/sla.test.cjs` bằng Node để kiểm thử logic và lưu trữ mô phỏng. Có kiểm tra hai nhánh FSD, các bước tùy chọn, mốc RS2, nghỉ trưa/cuối tuần/lễ, giây lẻ, đổi người, trả sửa, xóa, retry và lỗi ghi giữa chừng.

Chưa có kết nối SM trong phiên làm việc này. Trước khi dùng thật cần import các SL, tạo dbdict/index, nhập lịch đã duyệt, xác nhận adapter date/time, nối Rule Sets và scheduler nếu cần, rồi chạy kiểm thử tích hợp trên SM. Chưa thay trigger `esdHTKTpayment.activity.update.js` và chưa tự gắn rule vào workflow.

Tracking chỉ lưu sla.config.detail.id, không lưu sla.config.id. Tra bộ cấu hình qua ConfigDetail.sla.config.id. Định mức vẫn chốt tại Tracking.sla.minutes; phép tính không đổi.
