# 🤖 Zalo Auto Messenger

Chương trình tự động gửi tin nhắn vào nhóm chat Zalo mỗi ngày vào khung giờ cố định.
Sử dụng **zlapi** (gọi trực tiếp API Zalo) — không cần mở trình duyệt, nhẹ, nhanh.
Có **giao diện web** để cấu hình và quản lý dễ dàng.

## 📋 Tính năng

- ✅ Gửi tin nhắn tự động vào nhóm Zalo theo lịch
- ✅ Giao diện web dashboard (cấu hình, bật/tắt, xem log)
- ✅ Gọi API trực tiếp — không cần trình duyệt (~50MB RAM)
- ✅ Docker image nhẹ (~200MB)
- ✅ Retry tự động khi lỗi (exponential backoff)
- ✅ Health check & log chi tiết
- ✅ Hỗ trợ timezone Việt Nam

## 🏗️ Kiến trúc

```
┌──────────────────────────────────────────────┐
│           Docker Container                    │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Flask   │  │Scheduler │──│   Sender   │ │
│  │  (Web)   │  │(APSched) │  │  (zlapi)   │ │
│  └──────────┘  └──────────┘  └────────────┘ │
│   :5100             │              │          │
│                     ▼              ▼          │
│               [cron job]    [Zalo API call]   │
└──────────────────────────────────────────────┘
```

## 🚀 Hướng dẫn cài đặt

### Yêu cầu
- Python 3.10+
- Docker & Docker Compose (cho deployment)

### Bước 1: Cài đặt

```bash
cd d:\autodiemdanh

# Tạo virtual environment
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate # Linux/Mac

# Cài đặt dependencies
pip install -r requirements.txt
```

### Bước 2: Lấy Cookies & IMEI từ Zalo Web

Đây là bước **quan trọng nhất**. Bạn cần lấy 2 thông tin từ trình duyệt:

1. Mở **Chrome/Edge** → vào [chat.zalo.me](https://chat.zalo.me/) → đăng nhập
2. Nhấn **F12** (DevTools) → tab **Console**
3. Lấy cookies:

```javascript
document.cookie
```

4. Copy kết quả → đó là **ZALO_COOKIES**

5. Lấy IMEI:

```javascript
localStorage.getItem("z_uuid") || localStorage.getItem("ziuid")
```

> **💡 Cách khác**: Cài extension [zlapi Helper](https://github.com/Its-VrxxDev/zlapi) trên GitHub để tự động lấy IMEI và Cookies.

### Bước 3: Lấy Group ID

1. Mở [chat.zalo.me](https://chat.zalo.me/) → click vào nhóm chat
2. Nhấn **F12** → tab **Network** → filter `group` → tìm request có chứa `groupId`
3. Hoặc xem URL: `https://chat.zalo.me/g/abc123xyz`

### Bước 4: Cấu hình

**Cách 1: Qua giao diện web (khuyên dùng)**

```bash
python main.py web
```

Mở trình duyệt tại **http://localhost:5100** → điền thông tin vào form → nhấn "Lưu cấu hình"

**Cách 2: Qua file .env**

```bash
copy .env.example .env     # Windows
# cp .env.example .env     # Linux/Mac
```

Mở `.env` và điền:

```env
ZALO_IMEI=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ZALO_COOKIES={"zpw_enk":"...","zpw_sek":"..."}
ZALO_PHONE=0901234567
GROUP_ID=1234567890
MESSAGE_CONTENT=Nhắc nhở điểm danh! 📋
SEND_HOUR=7
SEND_MINUTE=0
```

### Bước 5: Test & chạy

```bash
# Test gửi 1 tin nhắn
python main.py test

# Chạy web dashboard (có giao diện quản lý)
python main.py web

# Hoặc chạy scheduler headless (không giao diện)
python main.py run
```

## 🌐 Giao diện Web Dashboard

Chạy `python main.py web` hoặc `python main.py` (mặc định) → mở **http://localhost:5100**

Tính năng:
- **Status**: Xem trạng thái scheduler, credentials, lần gửi tiếp theo
- **Cấu hình**: Sửa IMEI, cookies, nhóm, tin nhắn, giờ gửi trực tiếp trên web
- **Scheduler**: Bật/tắt bằng toggle switch
- **Test**: Gửi tin nhắn thử ngay bằng 1 click
- **Lịch sử**: Xem các lần gửi tin (thành công/thất bại)
- **Logs**: Xem log realtime

## 🐳 Deploy bằng Docker

### Build & chạy

```bash
docker compose build
docker compose up -d

# Xem logs
docker compose logs -f

# Dừng
docker compose down
```

### Deploy lên server

```bash
# 1. Copy dự án lên server
scp -r d:\autodiemdanh user@server:/home/user/zalo-messenger

# 2. SSH vào server
ssh user@server
cd /home/user/zalo-messenger

# 3. Chạy Docker
docker compose up -d --build
```

Mở **http://server-ip:5100** để quản lý qua web dashboard.

## 📁 Cấu trúc dự án

```
autodiemdanh/
├── config.py           # Cấu hình từ biến môi trường
├── sender.py           # Gửi tin nhắn qua zlapi (API trực tiếp)
├── scheduler.py        # Lập lịch APScheduler
├── web.py              # Web dashboard (Flask)
├── main.py             # Entry point CLI (web/run/test)
├── templates/
│   └── index.html      # Giao diện web dashboard
├── requirements.txt    # Dependencies (zlapi, flask, apscheduler)
├── Dockerfile          # Docker image (python:slim ~200MB)
├── docker-compose.yml  # Docker Compose
├── .env.example        # Template biến môi trường
├── .env                # Biến môi trường (tự tạo)
├── .gitignore          # Git ignore
└── logs/               # Log files (auto-generated)
    └── zalo_messenger.log
```

## ⚠️ Lưu ý quan trọng

1. **Session hết hạn**: Cookies Zalo có thể hết hạn sau vài ngày. Cần lấy lại cookies từ trình duyệt và cập nhật qua web dashboard hoặc file `.env`.

2. **Rủi ro tài khoản**: `zlapi` là thư viện không chính thức. Có nguy cơ bị Zalo khóa tài khoản. Nên dùng tài khoản phụ.

3. **Timezone**: Mặc định là `Asia/Ho_Chi_Minh`. Cấu hình qua biến `TIMEZONE` nếu cần.

## 🔧 Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| Session hết hạn | Lấy lại cookies/IMEI từ trình duyệt |
| GROUP_ID sai | Kiểm tra lại ID nhóm (F12 → Network) |
| Module not found | Chạy `pip install -r requirements.txt` |
| Docker build lỗi | `docker compose build --no-cache` |
| Port 5100 bị chiếm | Đổi port trong `main.py` và `docker-compose.yml` |
