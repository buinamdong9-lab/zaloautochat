# Báo cáo nâng cấp Zalo Auto Messenger v3.0.0

Ngày lập báo cáo: 20/07/2026  
Phiên bản: 3.0.0  
Mục tiêu: Nâng cấp hệ thống điểm danh từ cơ chế gửi tin nhắn sang cơ chế tham gia bình chọn Zalo tự động, có khả năng canh poll mới trong khung giờ và tránh thao tác lặp.

## 1. Tổng quan nâng cấp

Phiên bản v3.0.0 chuyển hệ thống từ một công cụ gửi tin nhắn theo lịch thành nền tảng tự động hóa điểm danh linh hoạt hơn, phù hợp với quy trình mới khi nhóm Zalo dùng cuộc bình chọn thay cho tin nhắn điểm danh.

Các năng lực chính đã được bổ sung:

- Tham gia bình chọn Zalo theo lịch.
- Tự tìm poll mới nhất khi để trống Poll ID.
- Tự tìm poll theo tiêu đề nếu cần lọc chính xác.
- Canh bình chọn trong một khung giờ, cứ có poll mới là tự vote.
- Ghi nhận poll đã xử lý để không vote lại cùng một poll.
- Nhận diện lựa chọn bình chọn linh hoạt, kể cả viết hoa/thường, bỏ dấu, viết tắt và sai chính tả nhẹ.
- Test bình chọn thủ công từ giao diện.
- Ghi log hệ thống ra file `data/system.log`.
- Cải thiện giao diện tạo lịch, mở rộng modal và giảm chiều sâu để không tràn màn hình.
- Cải thiện QR login, hiển thị lỗi rõ hơn.

## 2. Các chức năng đã nâng cấp

### 2.1. Lịch tham gia bình chọn một lần

Hệ thống thêm loại hành động `Tham gia bình chọn`.

Cách hoạt động:

- Đến đúng giờ đã cấu hình, scheduler kích hoạt.
- Bot đăng nhập Zalo bằng session đã lưu.
- Bot tìm poll theo `Poll ID` nếu có.
- Nếu `Poll ID` để trống, bot tìm poll đang mở mới nhất trong nhóm.
- Nếu trường lọc tiêu đề có nội dung, bot chỉ chọn poll có tiêu đề chứa chuỗi đó.
- Bot tìm option cần chọn, ví dụ `An toàn`.
- Nếu option đó chưa được chọn, bot vote.
- Nếu option đó đã được chọn, bot bỏ qua để tránh vote lặp.

### 2.2. Canh bình chọn trong khung giờ

Hệ thống thêm loại hành động `Canh bình chọn trong khung giờ`.

Cách hoạt động:

- `Giờ gửi` và `Phút gửi` là thời điểm bắt đầu canh poll.
- `Giờ kết thúc` và `Phút kết thúc` là thời điểm dừng canh.
- `Chu kỳ quét` là số giây giữa mỗi lần kiểm tra nhóm, tối thiểu 15 giây.
- Trong khung giờ, hệ thống liên tục kiểm tra poll đang mở mới nhất.
- Nếu phát hiện poll mới chưa từng xử lý trong lịch đó, hệ thống tự vote.
- Poll đã xử lý được lưu vào bảng `poll_watch_history`.
- Khi hết khung giờ, watcher tự ngắt.
- Nếu trong cùng khung giờ có poll mới khác, hệ thống tiếp tục vote poll mới đó.

### 2.3. Chống vote trùng

Trước khi gọi API vote, hệ thống gọi `getPollDetail` để đọc trạng thái hiện tại của poll.

Nếu lựa chọn mục tiêu đã có `voted = true`, hệ thống:

- Không gọi `votePoll` lại.
- Ghi log là đã bình chọn lựa chọn này.
- Đánh dấu thao tác thành công ở lịch sử để người vận hành biết hệ thống đã xử lý đúng.

Điều này giúp hạn chế thao tác dư thừa và giảm rủi ro do API không chính thức.

### 2.4. Nhận diện lựa chọn bình chọn linh hoạt

Hệ thống đã được nâng cấp để nhận diện các biến thể của lựa chọn `An toàn`:

- `An toàn`
- `an toàn`
- `AN TOÀN`
- `an toan`
- `ann toàn`
- `at`
- `AT`

Cơ chế xử lý:

- Chuẩn hóa chữ hoa/thường.
- Bỏ dấu tiếng Việt.
- So khớp chính xác.
- So khớp chứa một phần.
- So khớp viết tắt theo chữ cái đầu.
- So khớp gần đúng bằng khoảng cách chỉnh sửa cho lỗi typo nhẹ.
- Nếu nhiều option cùng gần giống nhau, hệ thống báo lỗi thay vì chọn bừa.

### 2.5. Test bình chọn thủ công

Trong tab `Cấu hình Zalo`, hệ thống đã thêm form `Test tham gia bình chọn`.

Người dùng có thể:

- Chọn nhóm Zalo.
- Nhập Poll ID hoặc để trống.
- Nhập bộ lọc tiêu đề hoặc để trống.
- Nhập lựa chọn cần bình chọn.
- Bấm test để xác minh ngay.

Kết quả test được ghi vào:

- Toast trên giao diện.
- Lịch sử hoạt động.
- Log trong database.
- File `data/system.log`.

### 2.6. Ghi log hệ thống ra file

Hệ thống tạo file:

```text
data/system.log
```

File này ghi:

- Thời điểm server khởi động.
- Quá trình nạp scheduler.
- Các thao tác gửi tin.
- Các thao tác vote poll.
- Các lỗi phát sinh khi chạy lịch hoặc test thủ công.

Trên server Linux có thể theo dõi bằng:

```bash
tail -f data/system.log
```

### 2.7. Giao diện v3.0.0

Các thay đổi giao diện:

- Cập nhật version hiển thị lên `3.0.0`.
- Thêm card nhỏ ở trang Tổng quan để user thấy các nâng cấp chính.
- Modal tạo/sửa lịch được mở rộng, dùng grid nhiều cột.
- Giảm chiều sâu form để tránh bị tràn khỏi màn hình.
- Thêm các trường dành cho canh poll:
  - Giờ kết thúc.
  - Phút kết thúc.
  - Chu kỳ quét.
- Giao diện vẫn responsive trên màn hình nhỏ.

## 3. Thay đổi kỹ thuật

### 3.1. Database

Thêm các cột vào bảng `schedules`:

- `action_type`
- `poll_id`
- `poll_question_filter`
- `poll_option`
- `watch_end_hour`
- `watch_end_minute`
- `poll_watch_interval_seconds`

Thêm bảng mới:

```sql
poll_watch_history
```

Mục đích:

- Lưu poll đã xử lý theo từng lịch.
- Tránh vote lại cùng một poll trong chế độ canh poll.

### 3.2. Backend

Các phần chính đã nâng cấp:

- `ZaloService.votePollAttendance`
- `ZaloService.getLatestOpenPoll`
- `SchedulerService.startPollWatcher`
- `SchedulerService.processPollWatcherTick`
- API `/api/zalo/test-poll-vote`
- CRUD schedules hỗ trợ các trường poll/watch mới.

### 3.3. Frontend

Các phần chính đã nâng cấp:

- Form tạo/sửa lịch hỗ trợ 3 action:
  - Gửi tin nhắn.
  - Tham gia bình chọn.
  - Canh bình chọn trong khung giờ.
- Form test bình chọn thủ công.
- Card thông tin nâng cấp v3.0.0.
- Cải thiện layout modal lịch.

## 4. Hướng dẫn cấu hình khuyến nghị

### Trường hợp poll được tạo cố định trước giờ điểm danh

Chọn:

```text
Hành động tự động: Tham gia bình chọn
Poll ID: để trống
Lọc tiêu đề poll: để trống hoặc nhập Báo cáo ngày
Lựa chọn cần bình chọn: An toàn
```

### Trường hợp không biết lúc nào poll mới xuất hiện

Chọn:

```text
Hành động tự động: Canh bình chọn trong khung giờ
Giờ gửi: giờ bắt đầu canh
Giờ kết thúc: giờ dừng canh
Chu kỳ quét: 30 đến 60 giây
Poll ID: để trống
Lọc tiêu đề poll: để trống nếu cứ poll mới nhất là vote
Lựa chọn cần bình chọn: An toàn
```

## 5. Kiểm thử đã thực hiện

Đã chạy:

```bash
npm run build
```

Kết quả:

- TypeScript build thành công.
- Public assets được copy sang `dist`.
- Server local đã được restart và chạy trên `http://localhost:5200`.
- Endpoint test bình chọn đã được nối backend/frontend.
- Log hệ thống đã ghi ra file `data/system.log`.

## 6. Cam kết mức độ hoạt động thực tế

Với điều kiện vận hành bình thường, tôi cam kết phiên bản v3.0.0 đáp ứng đúng các hành vi sau:

- Đến lịch sẽ thực hiện đúng action đã chọn.
- Nếu chọn `Tham gia bình chọn`, hệ thống sẽ vote poll phù hợp một lần.
- Nếu chọn `Canh bình chọn trong khung giờ`, hệ thống sẽ tự phát hiện poll mới trong khung giờ và vote.
- Poll đã xử lý sẽ không bị vote lặp trong chế độ canh poll.
- Nếu option mục tiêu đã được vote, hệ thống sẽ bỏ qua thao tác vote lặp.
- Các lỗi quan trọng sẽ được ghi vào dashboard log và `data/system.log`.

Các điều kiện cần để cam kết trên có hiệu lực:

- Cookie/IMEI Zalo còn hợp lệ.
- Tài khoản Zalo có quyền xem và tham gia bình chọn trong nhóm.
- Nhóm có poll đang mở.
- Option cần bình chọn tồn tại hoặc đủ gần để hệ thống nhận diện.
- Server chạy đúng timezone `Asia/Ho_Chi_Minh`.
- Thư viện `zca-js` vẫn tương thích với API nội bộ hiện tại của Zalo.

Giới hạn cần minh bạch:

- `zca-js` là thư viện không chính thức, phụ thuộc vào API nội bộ của Zalo Web.
- Nếu Zalo thay đổi giao thức, endpoint poll, cookie policy hoặc cơ chế bảo mật, hệ thống có thể cần cập nhật tiếp.
- Không nên cấu hình chu kỳ quét quá thấp để tránh tạo lưu lượng bất thường.
- Không thể cam kết tuyệt đối 100% trong mọi tình huống mạng, session hết hạn, proxy lỗi hoặc Zalo đổi API, nhưng hệ thống đã có log, test thủ công và cơ chế chống vote lặp để vận hành thực tế ổn định hơn.

## 7. Kết luận

Phiên bản v3.0.0 là bản nâng cấp trọng tâm cho bài toán điểm danh bằng bình chọn. Hệ thống hiện không chỉ gửi tin nhắn theo lịch mà còn có khả năng tự động tham gia poll, canh poll mới, tránh vote lặp và ghi log vận hành rõ ràng. Đây là nền tảng đủ tốt để triển khai thực tế trên server và tiếp tục mở rộng nếu quy trình điểm danh thay đổi thêm.
