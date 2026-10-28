// ================================================================
// CẤU HÌNH SLA CHO PHIẾU TẠM ỨNG / THANH TOÁN / DỰ CHI
// ================================================================


// LỊCH TÍNH SLA DÙNG CHUNG TOÀN HỆ THỐNG
// Mỗi dòng là một ca làm việc lặp lại theo tuần;
// Lịch chuẩn có 10 dòng: 2 ca/ngày x 5 ngày; không có dòng cho thứ Bảy/Chủ nhật.
Table esdHTKTslaWorkingHour {
  id varchar [pk]
  "day.of.week" number [not null] // ISO: 1=thứ Hai ... 7=Chủ nhật
  "start.time" varchar(5) [not null] // Character, định dạng HH:mm, ví dụ 08:00
  "end.time" varchar(5) [not null] // Character HH:mm; phải lớn hơn start.time

  indexes {
    ("day.of.week", "start.time") [unique]
  }
}

// Mỗi dòng là một ngày không tính SLA (lễ, Tết, nghỉ bù hoặc ngày nghỉ đặc biệt).
// Kỳ nghỉ nhiều ngày tạo từng dòng theo ngày thực tế; không tự suy diễn nghỉ bù.
Table esdHTKTslaHoliday {
  id varchar [pk]
  "holiday.date" date [not null] // Ngày nghỉ
  "holiday.name" varchar // Tên ngày nghỉ
  "holiday.type" varchar // PUBLIC_HOLIDAY/TET/COMPENSATORY_LEAVE/OTHER
  note text
  "created.by" varchar
  "created.at" datetime

  indexes {
    ("holiday.date") [unique]
  }
}

// Bảng cấu hình SLA
// Mỗi bản ghi đại diện cho một bộ SLA áp dụng theo loại giao dịch và nghiệp vụ/sản phẩm.
Table esdHTKTslaConfig {
  id varchar [pk] // Mã cấu hình SLA
  "transaction.type" varchar // Loại giao dịch (Tạm ứng/Thanh toán/Dự chi)
  "product.type" varchar // Tạm thời dùng "Tất cả"; nguồn sản phẩm trên phiếu chưa chốt
  "effective.from" datetime // Thời điểm bắt đầu áp dụng
  "effective.to" datetime // Thời điểm kết thúc áp dụng; null nếu đang áp dụng
  status varchar // Trạng thái cấu hình (Chờ hiệu lực/Đang hoạt động/Không hoạt động)
  "created.by" varchar // Người tạo cấu hình
  "created.at" datetime // Thời điểm tạo cấu hình
  sysmoduser varchar(60) // OpenText SM tự ghi người tạo hoặc cập nhật gần nhất
  sysmodtime datetime // OpenText SM tự cập nhật khi bản ghi được tạo hoặc sửa
}


Ref: esdHTKTslaConfigDetail."sla.config.id" > esdHTKTslaConfig.id

// Bảng chi tiết SLA theo vai trò xử lý
// Một bộ cấu hình có nhiều dòng tương ứng với các vai trò trong quy trình.
Table esdHTKTslaConfigDetail {
  id varchar [pk] // Khóa kỹ thuật chi tiết cấu hình SLA
  "sla.config.id" varchar // Mã cấu hình SLA
  "role.code" varchar // Mã vai trò xử lý (user.created.dmms/user.checker.kttc/user.checker.dmms/user.approver.dmms/user.approver.kttc/user.checker.final/user.approver.final)
  "role.name" varchar // Tên vai trò hiển thị
  "sla.hours" decimal // Số giờ làm việc cam kết của vai trò
  "is.active" bool // Có áp dụng SLA cho vai trò này hay không (mặc định là true)
}


// payment.id references source.table (payment or prepayment); no single-table FK.
Ref: esdHTKTslaTracking."sla.config.id" > esdHTKTslaConfig.id
Ref: esdHTKTslaTracking."sla.config.detail.id" > esdHTKTslaConfigDetail.id

// Bảng theo dõi SLA của từng vai trò trên phiếu
// Mỗi lần SLA bị đo lại từ đầu sẽ sinh một attempt.no mới.
Table esdHTKTslaTracking {
  id varchar [pk] 
  "source.table" varchar [not null] // esdHTKTpayment / esdHTKTprepayment
  "payment.id" varchar // Mã phiếu tạm ứng/thanh toán/dự chi
  "sla.config.id" varchar // Bộ cấu hình SLA được áp dụng tại thời điểm bắt đầu đo
  "sla.config.detail.id" varchar // Chi tiết SLA của vai trò được áp dụng
  "role.code" varchar // Mã vai trò đang được đo SLA
  "attempt.no" number // Lần đo SLA; tăng khi phiếu bị yêu cầu chỉnh sửa và phải đo lại từ đầu
  "started.at" datetime // Thời điểm bắt đầu đo SLA của lần hiện tại
  "ended.at" datetime // Thời điểm kết thúc đo SLA; null nếu chưa kết thúc
  "due.at" datetime // Hạn xử lý dự kiến sau khi loại trừ ngoài giờ và ngày nghỉ/lễ
  "end.reason" varchar // COMPLETE/RETURN/CANCEL; null khi đang đo
  result varchar // MET/BREACHED/NOT_EVALUATED; null khi chưa kết thúc
  "sla.minutes" decimal // Tổng số phút làm việc cam kết, quy đổi từ sla.hours
  "current.assignee" varchar // Người đang được giao xử lý
  status varchar // Trạng thái SLA (Chưa tính/Trong thời gian/Vi phạm/Đã kết thúc)
  "created.at" datetime // Thời điểm tạo bản ghi theo dõi
  sysmoduser varchar(60) // OpenText SM tự ghi người tạo hoặc cập nhật gần nhất
  sysmodtime datetime // OpenText SM tự cập nhật khi bản ghi được tạo hoặc sửa

  indexes {
    ("source.table", "payment.id", "attempt.no", "role.code") [unique]
  }
}


Ref: esdHTKTslaTimeSegment."sla.tracking.id" > esdHTKTslaTracking.id

// Bảng các khoảng thời gian dùng để tính SLA
// Lưu chi tiết thời gian bắt đầu/kết thúc của từng role để đối soát kết quả tính.
// REASSIGN: đóng segment cũ và mở segment mới cùng thời điểm; giữ nguyên Tracking,
// attempt.no, started.at và due.at của Tracking, không dừng hay cấp lại thời gian SLA.
// CANCEL: đóng tất cả segment và Tracking đang mở của phiếu tại cùng thời điểm;
// chốt số phút, ngừng phát sinh cảnh báo mới, giữ nguyên lịch sử đã có.
Table esdHTKTslaTimeSegment {
  id varchar [pk] 
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "segment.no" number // Số thứ tự khoảng thời gian trong một lần đo
  "started.at" datetime // Thời điểm bắt đầu khoảng tính
  "ended.at" datetime // Thời điểm kết thúc khoảng tính; null nếu đang chạy
  "working.minutes" decimal // Số phút làm việc hợp lệ trong khoảng
  "start.event" varchar // START/RESET/REASSIGN/RESUME (Bắt đầu đo/Đo lại/Tái phân công/Tiếp tục)
  "end.event" varchar // COMPLETE/RETURN/REASSIGN/PAUSE/CANCEL/END (Hoàn thành/Trả sửa/Tái phân công/Tạm dừng/Xóa phiếu/Kết thúc SLA)
  "assignee" varchar // Người xử lý trong khoảng thời gian
  "created.at" datetime // Thời điểm tạo bản ghi

  indexes {
    ("sla.tracking.id", "segment.no") [unique]
  }
}



Ref: esdHTKTslaEventLog."sla.tracking.id" > esdHTKTslaTracking.id

// Bảng nhật ký sự kiện SLA
// Dùng để truy vết các thay đổi trạng thái và phục vụ tính toán/đối soát SLA.
Table esdHTKTslaEventLog {
  id varchar [pk] 
  "sla.tracking.id" varchar // Mã theo dõi SLA; có thể null nếu bước đích chưa bắt đầu đo
  "source.table" varchar [not null] // esdHTKTpayment / esdHTKTprepayment
  "payment.id" varchar // Mã phiếu để tra cứu nhanh lịch sử
  "event.type" varchar // START/COMPLETE/RETURN/REASSIGN/RESET/PAUSE/RESUME/CANCEL; WORKFLOW là nhật ký áp dụng sự kiện
  "event.key" varchar // ID thao tác nghiệp vụ ổn định khi retry; chỉ có trên dòng WORKFLOW
  "processing.status" varchar // PREPARED/APPLIED cho WORKFLOW, null với nhật ký chi tiết
  "event.at" datetime // Thời điểm nghiệp vụ phát sinh
  "from.status" varchar // Trạng thái phiếu trước sự kiện
  "to.status" varchar // Trạng thái phiếu sau sự kiện
  "from.phase" varchar // Current phase trước sự kiện
  "to.phase" varchar // Current phase sau sự kiện; có thể giữ nguyên khi REASSIGN
  "role.code" varchar // Vai trò đích của sự kiện, kể cả khi chưa có Tracking
  "performed.by" varchar // Người hoặc service phát sinh sự kiện
  "assignee" varchar // Người xử lý tại thời điểm sự kiện
  data text // Dữ liệu bổ sung của sự kiện
  "created.at" datetime // Thời điểm hệ thống ghi nhận sự kiện
}

// TRẠNG THÁI PHIẾU VÀ PHASE
// Status: dmms_created/kttc_created (Tạo mới), dmms_initiated (Chờ KTTC xử lý),
// kttc_checked/dmms_checked/dmms_approved/kttc_approved/checked (Chờ phê duyệt),
// approved (Đã phê duyệt), cancelled (Đã xóa), request_edit (Chờ chỉnh sửa),
// accounted (Đã hạch toán).
// Phase: initial_dmms -> initial_kttc -> check_dmms -> approval_dmms ->
// approval_kttc -> check_final -> approval_final (bỏ các bước không thuộc luồng).
// Status và phase là hai thuộc tính riêng; EventLog lưu giá trị thực tế trước/sau,
// không ánh xạ cứng một status thành một phase chỉ dựa trên thứ tự hai danh sách.
// RETURN: kết thúc các lần đo đang mở và đo lại từ đầu kể cả maker, giữ lịch sử cũ.
// CANCEL phát sinh khi xóa nghiệp vụ thành công (to.status=cancelled), không xóa dữ liệu SLA.
// Lưu timestamp theo một chuẩn thống nhất (khuyến nghị UTC); quy đổi sang timezone
// của Calendar khi xác định thứ trong tuần, ca làm việc và ngày nghỉ.

// QUY TẮC LUỒNG SLA DÙNG CHUNG
// Phiếu do KTTC tạo: bỏ RS1 và PD ĐMMS; RS2 bắt đầu khi PD KTTC chuyển sang RS2.
// Phiếu do ĐMMS tạo: đi qua RS1 nếu được cấu hình và qua PD ĐMMS; RS2 bắt đầu
// sau khi PD ĐMMS hoàn thành và giữ nguyên mốc khi thực sự vào check_final.
// Dự chi, Tạm ứng và Thanh toán dùng chung quy tắc luồng. Tạm thời chỉ dùng
// transaction.type và cấu hình product.type="Tất cả" để chạy luồng trước.
// Các trường phút dùng decimal để giữ giây lẻ; không làm tròn qua từng segment.
// result được chốt MET/BREACHED bằng kết quả tính nội bộ tại thời điểm hoàn thành.
// WORKFLOW.data chứa fingerprint + toàn bộ kế hoạch ghi JSON, cần text đủ lớn.
// PREPARED phải được retry cùng event.key trước sự kiện tiếp theo trên cùng phiếu.
// Phải tuần tự hóa xử lý sự kiện/job theo payment.id ở tầng vận hành; các upsert
// nhiều bảng không tự tạo thành transaction. PK id và các unique index phải tồn tại trong SM.
