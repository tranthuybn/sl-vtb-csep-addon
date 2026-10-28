# SLA tự tính dùng chung cho Dự chi, Tạm ứng và Thanh toán

Đã triển khai engine tính và ghi dữ liệu SLA dùng chung cho `esdHTKTpayment`. Dự chi, Tạm ứng và Thanh toán dùng cùng quy tắc luồng. Tạm thời `transaction.type` chọn cấu hình và `product.type` luôn dùng giá trị `"Tất cả"` vì nguồn sản phẩm trên phiếu chưa được chốt. Không có HTTP API quản trị hoặc API lịch sử. Các entry point ở đây dành cho workflow và scheduler phía server. Mã chưa được import/chạy trên SM thật; không có thay đổi trigger tự động.


## Bàn giao để tiếp tục trên máy khác

Cập nhật ngày 28/10/2026, múi giờ Asia/Saigon. Đọc mục này trước rồi đọc các phần triển khai bên dưới; không cần có lịch sử chat để tiếp tục. Đây là bản tóm tắt quyết định và trạng thái công việc, không phải bản chép nguyên văn hội thoại.

### Mục tiêu và phạm vi đã thống nhất

Ban đầu dự định dùng SLA của OpenText SM, sau đó chuyển sang tự đo/tính/lưu SLA. Engine hiện dùng chung cho Dự chi, Tạm ứng và Thanh toán trong bảng `esdHTKTpayment`. Giai đoạn tạm thời chỉ phân biệt định mức bằng `transaction.type`; mọi cấu hình dùng `product.type = "Tất cả"`. Tài liệu Tạm ứng được dùng làm nguồn tham khảo luồng hai nhánh.

Người dùng đã làm rõ: phải ghi đủ các bảng để tròn một vòng đời SLA; không được chỉ viết hàm tính thuần. Chỉ hoãn API quản trị/tra cứu như danh sách cấu hình, quản lý lịch, xem lịch sử. Các entry point server/workflow, bootstrap triển khai và job vẫn nằm trong phạm vi.

Các mốc do người dùng đính chính có ưu tiên hơn nội dung sai/mâu thuẫn trong tài liệu:

- ĐMMS tạo: ĐMMS → KTTC → RS1 nếu bật → PD ĐMMS → PD KTTC → RS2 nếu bật → cấp có thẩm quyền.
- KTTC tạo: KTTC → PD KTTC → RS2 nếu bật → cấp có thẩm quyền; không có RS1/PD ĐMMS.
- **RS2 trong nhánh ĐMMS tạo:** bắt đầu khi PD ĐMMS chuyển thành công, kết thúc khi RS2 chuyển sang cấp có thẩm quyền. Người dùng đã nói rõ mốc này; không tự sửa thành bắt đầu sau PD KTTC chỉ vì thấy thứ tự xử lý tuần tự.
- **RS2 trong nhánh KTTC tạo:** người dùng trả lời câu hỏi riêng, chọn bắt đầu khi PD KTTC chuyển sang RS2.
- Thêm lịch/ngày nghỉ; bổ sung CANCEL và lý do kết thúc Segment do REASSIGN đã được người dùng yêu cầu.

Các lựa chọn kỹ thuật hiện tại cần phân biệt với yêu cầu xác nhận trực tiếp: ưu tiên gọi từ workflow sau thành công là đánh giá của agent; nhật ký PREPARED/APPLIED và adapter mail là thiết kế triển khai. Mốc khởi tạo maker lấy lúc tạo phiếu thành công; maker vòng trả sửa chạy từ lúc trả sửa thành công; chạm hạn `remaining <= 0` là vi phạm theo sheet quy tắc hiển thị. Các lựa chọn này đã ghi trong mã/tài liệu nhưng chưa được kiểm chứng trên SM thật.

### Trạng thái mã nguồn lúc bàn giao

- Có 3 SL trong thư mục `sla/`, một file test và README này. Engine tính/ghi dùng chung; policy tách khác biệt luồng; job là entry point định kỳ.
- Chỉ bổ sung hai hàm cầu nối ở cuối `expense/ESD_HTKT_EXPENSE_WF.js`; chưa gọi tự động từ luồng hiện tại.
- `dbdict/SLA.sql` hiện là **DBML**, có 9 bảng và không sử dụng bảng khóa SLA. Chưa chạy tạo bảng trong SM.
- Không sửa `payment/esdHTKTpayment.activity.update.js`; chưa chuyển sang bắt sự kiện bằng trigger.
- Bộ kiểm thử Node sử dụng lưu trữ mô phỏng, có mô phỏng SCFile và lỗi ghi. 3 SL và SL workflow sửa đều được kiểm tra cú pháp. **Không đồng nghĩa đã kiểm thử tích hợp SM hoặc gửi mail thật.**
- Chưa tạo API quản trị, UI SLA hoặc API đọc lịch sử.

### File và nguồn cần mang theo

Thư mục làm việc chính của phần backend SLA là `C:/workspace/sl`, nằm ngoài repo frontend `C:/workspace/vtb-csep-addon`. Chỉ chép/pull repo frontend sẽ không bảo đảm mang theo các SL/schema/tài liệu ở thư mục `sl`.

Nên chuyển nguyên thư mục `C:/workspace/sl` sang máy mới; tối thiểu phải có:

- `sla/` gồm 3 SL (`ENGINE`, `POLICY`, `JOB`), `README.md`, `tests/sla.test.cjs`.
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
| initial_dmms | CB đề nghị / CB_DE_NGHI |
| initial_kttc | CB KTTC / CB_KTTC |
| check_dmms | RS1 / RA_SOAT_1 |
| approval_dmms | PD ĐMMS / PHE_DUYET_DM |
| approval_kttc | PD KTTC / PHE_DUYET_KTTC |
| check_final | RS2 / RA_SOAT_2 |
| approval_final | Cấp có thẩm quyền / PHE_DUYET_TQ |

`start` và `end` còn xuất hiện ở mã tạo phiếu/workflow; chúng là phase kỹ thuật ngoài mảng 7 phase người dùng liệt kê. Ghi đúng status/phase thực tế trước và sau trong EventLog, không suy đoán từ nhãn "Chờ phê duyệt".

### Công việc tiếp theo trên máy mới

1. Đọc README và chạy lại `node tests/sla.test.cjs` từ thư mục `sl/sla` để xác nhận đủ file sau khi chuyển máy; hiện kỳ vọng 24 test pass.
2. Đối chiếu mã và schema mới trước khi import. Xác nhận kích thước trường ID, text JSON kế hoạch ghi, decimal, PK và unique index trong dbdict SM.
3. Trên môi trường thử nghiệm, tạo bảng/index, import 3 SL và các cầu nối workflow; nhập phiên bản lịch/ngày nghỉ đã được duyệt, rồi bootstrap một cấu hình `product.type = "Tất cả"` cho từng `transaction.type`.
4. Xác nhận cách SM thực tế trả/lưu datetime/date/time và điền adapter nếu cần. Không đoán chuỗi ngày theo locale.
5. Xem Rule Sets/action thực tế của workflow `ESD_HTKT_PAYMENT` trên bảng `esdHTKTpayment`; chọn điểm gọi sau thành công, chụp snapshot trước, giữ operationId/eventAt/performedBy ổn định. Chưa có bản export cấu hình Rule Sets để sửa tự động.
6. Nối CREATE ở sau tạo thành công; TRANSITION/RETURN/CANCEL sau nghiệp vụ thành công; REASSIGN tại điểm lưu người phê duyệt thành công. Kiểm tra việc `doUpdate()` có chạy workflow không. Không gắn hai nguồn khiến ghi hai lần.
7. Cấu hình scheduler tính lại; nối mailAdapter thực tế. File `ESD_HTKT_ACTION_WF_SEND_EMAIL` đang thiếu trong nguồn được cung cấp; phải xem contract trước khi nối gửi mail SLA.
8. Chạy tích hợp SM qua hai nhánh, RS1/RS2 bật/tắt, ký số thất bại/thành công, trả sửa nhiều vòng, tái phân công, xóa, ngày nghỉ, job đồng thời và retry. Chỉ sau đó mới coi là đã đưa vào vận hành. API quản trị vẫn hoãn trừ khi người dùng đổi phạm vi.

Có thể mở chat mới trên máy khác bằng câu sau:

> Tiếp tục triển khai SLA tự tính dùng chung cho Dự chi, Tạm ứng và Thanh toán. Đọc C:/workspace/sl/sla/README.md rồi đối chiếu các SL và schema. Ba loại giao dịch dùng chung policy luồng; tạm thời transaction.type chọn cấu hình và product.type luôn là "Tất cả". Phải ghi đủ vòng đời SLA, chưa làm API quản trị. Báo trạng thái thực tế và tiếp tục phần tích hợp SM còn thiếu; không giả định đã import hoặc gắn workflow.

## Luồng nghiệp vụ

Đối chiếu mục 2.1 và 2.3 của `C:/workspace/sl/tài liệu/FSD+Tạm+ứng.doc`. Quy tắc dưới đây dùng chung cho Dự chi, Tạm ứng và Thanh toán:

- ĐMMS tạo: CB ĐMMS → CB KTTC → RS1 nếu bật → PD ĐMMS → PD KTTC → RS2 nếu bật → Cấp có thẩm quyền.
- KTTC tạo: CB KTTC → PD KTTC → RS2 nếu bật → Cấp có thẩm quyền. Bỏ hoàn toàn RS1 và PD ĐMMS, kể cả khi dữ liệu cũ còn cờ RS1.
- Phiếu vừa tạo có `current.phase = start`. Chuyển từ `start` vào bước maker không kết thúc/khởi tạo lại đồng hồ maker.
- RS2 của luồng ĐMMS tạo bắt đầu ngay khi PD ĐMMS chuyển thành công, kết thúc khi RS2 chuyển sang cấp có thẩm quyền. Đây là ngoại lệ mốc đo do người dùng chốt; có thể chạy đồng thời với PD KTTC dù thứ tự xử lý vẫn tuần tự.
- RS2 của luồng KTTC tạo bắt đầu khi PD KTTC chuyển sang RS2, theo xác nhận của người dùng.
- Trả sửa: kết thúc mọi Tracking đang mở của vòng cũ, giữ lịch sử, tăng vòng đo và bắt đầu ngay maker của vòng mới. Không đợi người sửa mở màn hình.
- Tái phân công bước đang đo: đóng/mở Segment liên tiếp tại cùng thời điểm, không đổi Tracking/hạn/budget. Bước chưa tới lượt chỉ ghi EventLog.
- Xóa: đóng mọi Tracking/Segment đang mở; không xóa lịch sử. Chỉ phát sinh sau khi nghiệp vụ xóa thành công.
- Đã phê duyệt kết thúc đồng hồ cuối. Không đo thêm thời gian tích hợp/hạch toán.

Các role.code dùng trong cấu hình: `CB_DE_NGHI`, `CB_KTTC`, `RA_SOAT_1`, `PHE_DUYET_DM`, `PHE_DUYET_KTTC`, `RA_SOAT_2`, `PHE_DUYET_TQ`.

## Các Script Library

| File | Trách nhiệm |
|---|---|
| ESD_HTKT_SLA_ENGINE.js | Engine dùng chung: lịch, tính toán, SCFile, Tracking, Segment, EventLog, AlertHistory, runtime workflow và bootstrap cấu hình |
| ESD_HTKT_SLA_POLICY.js | Quy tắc phase/role/command dùng chung cho Dự chi, Tạm ứng và Thanh toán |
| ESD_HTKT_SLA_JOB.js | Entry point scheduler: tính lại, phục hồi PREPARED và gửi/retry cảnh báo qua mail adapter |

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
- Job: cập nhật số phút trên Segment/Tracking; tạo mỗi Tracking + stage một AlertHistory.
- EventLog WORKFLOW là nhật ký áp dụng thao tác: PREPARED lưu kế hoạch ghi đầy đủ trước khi cập nhật, APPLIED sau khi ghi xong. Các log chi tiết có processing.status null.
- Không sử dụng bảng khóa SLA. Workflow, scheduler và dispatcher phải được cấu hình để không xử lý đồng thời cùng một `payment.id`. Nhật ký PREPARED/APPLIED và các unique index vẫn hỗ trợ retry/chống trùng, nhưng không thay thế việc tuần tự hóa ở tầng vận hành.

## Cấu hình và lịch ban đầu

Dùng schema DBML `../dbdict/SLA.sql` để tạo dbdict/index thực tế. Chưa phải migration SQL có thể chạy trực tiếp. Các trường số phút dùng decimal; `EventLog.data` phải đủ lớn cho JSON kế hoạch ghi và `id` phải đủ dài cho ID ghép đã encode.

`buildBaseline(calendarLib, args)` tạo bộ dữ liệu để xem trước; `installBaseline(store, calendarLib, args)` thực sự ghi dữ liệu. Args cần `calendarId`, `configId`, `transactionType`, `effectiveFrom`, `performedBy` và `holidays`; `effectiveTo` tùy chọn. Bootstrap luôn ghi `product.type = "Tất cả"`. Hai tên entry point cũ cho Dự chi vẫn được giữ làm alias tương thích.

Bộ giá trị Dự chi lấy từ `Thông tin SLA.xlsx`, sheet `Danh mục SLA`, dòng 19: CB đề nghị 2h; KTTC 3h; RS1 3h; PD ĐMMS 6h; PD KTTC 6h; RS2 4,5h; cấp thẩm quyền 9h. Cấu hình Dự chi có `product.type = "Tất cả"`. Hiệu lực theo khoảng `[effective.from, effective.to)`; không cho chồng lấn. Thời gian/ngưỡng cảnh báo/lịch được chốt trên Tracking khi bắt đầu bước, không lấy lại budget khi đổi người.

Timestamp dùng JS Date hoặc ISO có Z/offset; không parse chuỗi ngày theo locale. Giờ ca dùng HH:mm hoặc HH:mm:00, ngày nghỉ dùng YYYY-MM-DD. Store có các adapter `decodeInstant`, `encodeInstant`, `decodeDate`, `encodeDate`, `decodeTime`, `encodeTime` để khớp kiểu date/time của SM triển khai thật. Phải xác nhận trên môi trường SM; không âm thầm đoán định dạng SCDatum/SCDate. Version hiện hỗ trợ Asia/Ho_Chi_Minh, không hỗ trợ vùng DST.

Phút giữ phần lẻ, chỉ làm tròn khi hiển thị. Theo quy tắc hiển thị đã cung cấp, chạm hạn (`remaining <= 0`) là vi phạm; mail BREACH dùng cùng quy ước. Ngoài giờ và ngày nghỉ không tách Segment. Tạm dừng có khoảng hở sẽ được loại thời gian; khi chưa tiếp tục thì chưa xác định được hạn tương lai. Chưa thêm action tạm dừng vào luồng Dự chi vì chưa có nghiệp vụ tương ứng.

## Job và cảnh báo

```javascript
var rt = lib.ESD_HTKT_SLA_ENGINE.createRuntime(dateTimeAdapterOptions);
var batchResult = lib.ESD_HTKT_SLA_JOB.runBatch(rt, new Date(), {limit:100});
// Nếu nextCursor != null, tiếp tục với afterPaymentId = nextCursor.
// Một vòng kết thúc thì lần chạy định kỳ tiếp theo bắt đầu cursor rỗng.
```

Tần suất đề xuất 1 phút, cần cấu hình lịch chạy thực tế trong SM. Lỗi một phiếu được trả trong errors, không chặn phiếu khác. Job không tự backfill các phiếu cũ thiếu sự kiện khởi tạo. Các thao tác nghiệp vụ phải đến đúng thứ tự. Sự kiện đến sau job nhưng có timestamp sớm hơn sẽ tính lại tới đúng mốc nghiệp vụ và hủy cảnh báo chưa gửi của bước đã đóng. Sự kiện đến sai thứ tự so với một sự kiện nghiệp vụ đã APPLIED sẽ báo lỗi để đối soát. Mail đã gửi không thể thu hồi; nên gắn lời gọi ngay sau lưu thành công để giảm khoảng trễ giữa nghiệp vụ và SLA.

Cảnh báo được lưu `Chờ gửi`. `triggered.at` là mốc đạt ngưỡng thật, không phải lúc job phát hiện. Mỗi stage chỉ có một dòng, số lần gửi lại cập nhật trên dòng cũ. SLA kết thúc thì không tạo cảnh báo mới và cảnh báo chưa gửi được đánh dấu `Đã hủy`. Khi gửi, người nhận được cập nhật theo người đang được giao nếu có tái phân công.

```javascript
lib.ESD_HTKT_SLA_JOB.dispatchPendingAlerts(rt, mailAdapter, new Date(), {limit:100});
```

`mailAdapter(payload)` trả `{success:true, recipientEmail:...}` khi cổng mail nhận thành công, trả lỗi/throw khi thất bại. Adapter cần tra email từ recipientUser nếu recipientEmail chưa có. Dùng payload.id làm khóa chống trùng tại cổng mail. Nếu gửi thành công rồi ghi DB thất bại, có thể gửi lại; không hứa exactly-once khi cổng mail không hỗ trợ chống trùng.

Nguồn hiện chỉ tham chiếu `ESD_HTKT_ACTION_WF_SEND_EMAIL`, chưa có file SL đó trong thư mục được cung cấp. Vì chưa biết contract gửi mail SLA, không gọi nhầm hàm mail trả sửa/tái phân công. Phần gửi mail đã có dispatcher/retry nhưng phải nối mailAdapter thực tế để gửi mail thật; thiếu adapter thì giữ Chờ gửi và báo lỗi khi gọi dispatcher.

## Kiểm thử và giới hạn triển khai

Chạy `node tests/sla.test.cjs` bằng Node để kiểm thử logic và lưu trữ mô phỏng. Có kiểm tra hai nhánh FSD, các bước tùy chọn, mốc RS2 riêng, nghỉ trưa/cuối tuần/lễ, giây lẻ, đổi người, trả sửa, xóa, cảnh báo, retry và lỗi ghi giữa chừng.

Chưa có kết nối SM trong phiên làm việc này. Trước khi dùng thật cần import các SL, tạo dbdict/index, nhập lịch đã duyệt, xác nhận adapter date/time, nối Rule Sets và scheduler/mailAdapter, rồi chạy kiểm thử tích hợp trên SM. Chưa thay trigger `esdHTKTpayment.activity.update.js` và chưa tự gắn rule vào workflow.
