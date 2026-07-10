import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# --- Paths ---
BASE_DIR = Path(__file__).parent
LOGS_DIR = BASE_DIR / "logs"
COOKIES_FILE = BASE_DIR / "cookies.json"

# Ensure directories exist
LOGS_DIR.mkdir(exist_ok=True)

# --- Zalo Credentials ---
# Lấy từ browser extension (xem README)
IMEI = os.getenv("ZALO_IMEI", "")
COOKIES = os.getenv("ZALO_COOKIES", "")
PHONE = os.getenv("ZALO_PHONE", "")
PASSWORD = os.getenv("ZALO_PASSWORD", "")

# --- Zalo Settings ---
GROUP_ID = os.getenv("GROUP_ID", "")
RECIPIENT_TYPE = os.getenv("RECIPIENT_TYPE", "GROUP")
MESSAGE_CONTENT = os.getenv("MESSAGE_CONTENT", "Nhắc nhở điểm danh! 📋")

# --- Schedule Settings ---
SEND_HOUR = int(os.getenv("SEND_HOUR", "7"))
SEND_MINUTE = int(os.getenv("SEND_MINUTE", "0"))
TIMEZONE = os.getenv("TIMEZONE", "Asia/Ho_Chi_Minh")

# Ngày gửi trong tuần: "mon,tue,wed,thu,fri" (mặc định T2-T6)
SEND_DAYS = os.getenv("SEND_DAYS", "mon,tue,wed,thu,fri")

# Khoảng ngày hoạt động (format: YYYY-MM-DD, để trống = không giới hạn)
START_DATE = os.getenv("START_DATE", "")
END_DATE = os.getenv("END_DATE", "")

# --- Retry Settings ---
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
RETRY_DELAY = int(os.getenv("RETRY_DELAY", "10"))  # seconds

# --- Logging ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
