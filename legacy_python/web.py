"""
Web Dashboard - Giao diện quản lý Zalo Auto Messenger.

Chạy trên Flask, cung cấp giao diện web để:
- Cấu hình nhóm, tin nhắn, giờ gửi
- Gửi tin nhắn test
- Xem log/lịch sử
- Bật/tắt scheduler
- Xem trạng thái hệ thống
"""

import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify, redirect, url_for
from dotenv import load_dotenv, set_key

import config
from sender import send_message_with_retry, SessionExpiredError, ZaloSendError

logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.urandom(24)

# --- State ---
_scheduler = None
_scheduler_thread = None
_scheduler_running = False
_send_history = []  # Lịch sử gửi tin [{time, status, message, error}]
MAX_HISTORY = 100


def _get_env_path():
    return config.BASE_DIR / ".env"


def _reload_config():
    """Reload config tu .env file."""
    load_dotenv(_get_env_path(), override=True)
    config.IMEI = os.getenv("ZALO_IMEI", "")
    config.PHONE = os.getenv("ZALO_PHONE", "")
    config.PASSWORD = os.getenv("ZALO_PASSWORD", "")
    config.GROUP_ID = os.getenv("GROUP_ID", "")
    config.MESSAGE_CONTENT = os.getenv("MESSAGE_CONTENT", "Nhac nho diem danh!")
    config.SEND_HOUR = int(os.getenv("SEND_HOUR", "7"))
    config.SEND_MINUTE = int(os.getenv("SEND_MINUTE", "0"))
    config.TIMEZONE = os.getenv("TIMEZONE", "Asia/Ho_Chi_Minh")
    config.MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
    config.RETRY_DELAY = int(os.getenv("RETRY_DELAY", "10"))
    config.SEND_DAYS = os.getenv("SEND_DAYS", "mon,tue,wed,thu,fri")
    config.START_DATE = os.getenv("START_DATE", "")
    config.END_DATE = os.getenv("END_DATE", "")
    config.RECIPIENT_TYPE = os.getenv("RECIPIENT_TYPE", "GROUP")


def _save_env(data: dict):
    """Lưu cấu hình vào .env file."""
    env_path = str(_get_env_path())
    # Tạo .env nếu chưa có
    if not os.path.exists(env_path):
        Path(env_path).touch()

    key_map = {
        "imei": "ZALO_IMEI",
        "zpw_sek": "ZPW_SEK",
        "zpsid": "ZPSID",
        "zi_cookie": "ZI_COOKIE",
        "phone": "ZALO_PHONE",
        "group_id": "GROUP_ID",
        "message": "MESSAGE_CONTENT",
        "send_hour": "SEND_HOUR",
        "send_minute": "SEND_MINUTE",
        "timezone": "TIMEZONE",
        "send_days": "SEND_DAYS",
        "start_date": "START_DATE",
        "end_date": "END_DATE",
        "recipient_type": "RECIPIENT_TYPE",
    }

    for form_key, env_key in key_map.items():
        if form_key in data and data[form_key] is not None:
            set_key(env_path, env_key, str(data[form_key]))

    _reload_config()


def _add_history(status: str, message: str, error: str = None):
    """Thêm vào lịch sử gửi tin."""
    _send_history.insert(0, {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status": status,
        "message": message,
        "error": error,
    })
    # Giới hạn history
    while len(_send_history) > MAX_HISTORY:
        _send_history.pop()


def _start_scheduler_background():
    """Khởi động scheduler trong background thread."""
    global _scheduler, _scheduler_thread, _scheduler_running

    if _scheduler_running:
        return False

    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    _scheduler = BackgroundScheduler(
        timezone=config.TIMEZONE,
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": 3600,
        },
    )

    def _scheduled_send():
        logger.info("⏰ Scheduler trigger - đang gửi tin nhắn...")
        try:
            send_message_with_retry()
            _add_history("success", config.MESSAGE_CONTENT)
            logger.info("✅ Scheduler: gửi thành công")
        except SessionExpiredError as e:
            _add_history("error", config.MESSAGE_CONTENT, f"Session hết hạn: {e}")
            logger.error(f"❌ Scheduler: session hết hạn: {e}")
        except ZaloSendError as e:
            _add_history("error", config.MESSAGE_CONTENT, str(e))
            logger.error(f"❌ Scheduler: lỗi gửi tin: {e}")

    _scheduler.add_job(
        _scheduled_send,
        trigger=CronTrigger(
            hour=config.SEND_HOUR,
            minute=config.SEND_MINUTE,
            day_of_week=config.SEND_DAYS if config.SEND_DAYS else "*",
            start_date=config.START_DATE if config.START_DATE else None,
            end_date=config.END_DATE if config.END_DATE else None,
            timezone=config.TIMEZONE,
        ),
        id="zalo_send_message",
        name=f"Gửi tin lúc {config.SEND_HOUR:02d}:{config.SEND_MINUTE:02d} ({config.SEND_DAYS})",
        replace_existing=True,
    )

    _scheduler.start()
    _scheduler_running = True
    logger.info("[OK] Scheduler da bat")
    return True


def _stop_scheduler():
    """Dừng scheduler."""
    global _scheduler, _scheduler_running

    if _scheduler and _scheduler_running:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        _scheduler_running = False
        logger.info("[STOP] Scheduler da tat")
        return True
    return False


def _get_next_run():
    """Lấy thời gian gửi tiếp theo."""
    if _scheduler and _scheduler_running:
        job = _scheduler.get_job("zalo_send_message")
        if job and job.next_run_time:
            return job.next_run_time.strftime("%Y-%m-%d %H:%M:%S %Z")
    return None


# --- Routes ---


@app.route("/")
def index():
    """Trang chủ - Dashboard."""
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    """API: Trang thai he thong."""
    has_imei = bool(config.IMEI and config.IMEI != "your_imei_here")
    has_zpw_sek = bool(os.getenv("ZPW_SEK", ""))
    has_zpsid = bool(os.getenv("ZPSID", ""))
    has_cookies = has_zpw_sek and has_zpsid
    has_group = bool(config.GROUP_ID and config.GROUP_ID != "your_group_id_here")

    return jsonify({
        "scheduler_running": _scheduler_running,
        "next_run": _get_next_run(),
        "credentials_ok": has_imei and has_cookies,
        "has_imei": has_imei,
        "has_cookies": has_cookies,
        "has_group": has_group,
        "config": {
            "group_id": config.GROUP_ID,
            "message": config.MESSAGE_CONTENT,
            "send_hour": config.SEND_HOUR,
            "send_minute": config.SEND_MINUTE,
            "timezone": config.TIMEZONE,
            "phone": config.PHONE,
            "imei_set": has_imei,
            "cookies_set": has_cookies,
            "send_days": config.SEND_DAYS,
            "start_date": config.START_DATE,
            "end_date": config.END_DATE,
            "recipient_type": getattr(config, "RECIPIENT_TYPE", "GROUP"),
        },
    })


@app.route("/api/config", methods=["POST"])
def api_save_config():
    """API: Lưu cấu hình."""
    try:
        data = request.get_json()
        _save_env(data)

        # Restart scheduler nếu đang chạy (để áp dụng giờ mới)
        if _scheduler_running:
            _stop_scheduler()
            _start_scheduler_background()

        return jsonify({"success": True, "message": "Đã lưu cấu hình!"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/api/test-send", methods=["POST"])
def api_test_send():
    """API: Gửi tin nhắn test."""
    def _do_send():
        try:
            send_message_with_retry()
            _add_history("success", config.MESSAGE_CONTENT)
        except SessionExpiredError as e:
            _add_history("error", config.MESSAGE_CONTENT, f"Session hết hạn: {e}")
        except ZaloSendError as e:
            _add_history("error", config.MESSAGE_CONTENT, str(e))

    try:
        # Chạy trong thread riêng để không block
        thread = threading.Thread(target=_do_send, daemon=True)
        thread.start()
        return jsonify({"success": True, "message": "Đang gửi tin nhắn test..."})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/api/scheduler/start", methods=["POST"])
def api_scheduler_start():
    """API: Bật scheduler."""
    if _start_scheduler_background():
        return jsonify({"success": True, "message": "Scheduler đã bật!"})
    return jsonify({"success": False, "message": "Scheduler đang chạy rồi"})


@app.route("/api/scheduler/stop", methods=["POST"])
def api_scheduler_stop():
    """API: Tắt scheduler."""
    if _stop_scheduler():
        return jsonify({"success": True, "message": "Scheduler đã tắt!"})
    return jsonify({"success": False, "message": "Scheduler chưa chạy"})


@app.route("/api/history")
def api_history():
    """API: Lịch sử gửi tin."""
    return jsonify({"history": _send_history})


@app.route("/api/logs")
def api_logs():
    """API: Đọc log file."""
    log_file = config.LOGS_DIR / "zalo_messenger.log"
    lines = []
    if log_file.exists():
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                lines = f.readlines()[-200:]  # 200 dòng cuối
        except Exception:
            lines = ["Không đọc được file log."]
    return jsonify({"logs": "".join(lines)})
