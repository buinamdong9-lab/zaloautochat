"""
Scheduler Module - Lập lịch gửi tin nhắn tự động.

Sử dụng APScheduler với CronTrigger để chạy job hàng ngày
vào khung giờ cố định.
"""

import logging
import signal
import sys
from datetime import datetime

# pyrefly: ignore [missing-import]
from apscheduler.schedulers.blocking import BlockingScheduler
# pyrefly: ignore [missing-import]
from apscheduler.triggers.cron import CronTrigger
# pyrefly: ignore [missing-import]
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR

import config
from sender import send_message_with_retry, SessionExpiredError

logger = logging.getLogger(__name__)


def _send_job():
    """Job gửi tin nhắn - được APScheduler gọi."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info(f"{'='*50}")
    logger.info(f"⏰ Job bắt đầu lúc {now}")
    logger.info(f"   Nhóm ID: {config.GROUP_ID}")
    logger.info(f"   Nội dung: {config.MESSAGE_CONTENT}")
    logger.info(f"{'='*50}")

    try:
        send_message_with_retry()
        logger.info(f"✅ Job hoàn thành lúc {datetime.now().strftime('%H:%M:%S')}")
    except SessionExpiredError as e:
        logger.critical(f"🔴 SESSION HẾT HẠN: {e}")
        logger.critical("   Cần lấy cookies mới! Xem README.")
    except Exception as e:
        logger.error(f"❌ Job thất bại: {e}")


def _job_listener(event):
    """Listener cho APScheduler events."""
    if event.exception:
        logger.error(f"❌ Job lỗi: {event.exception}")


def _signal_handler(signum, frame):
    """Xử lý SIGTERM/SIGINT để graceful shutdown."""
    sig_name = signal.Signals(signum).name
    logger.info(f"📡 Nhận tín hiệu {sig_name}, đang dừng...")
    sys.exit(0)


def start_scheduler():
    """Khởi động scheduler gửi tin nhắn tự động hàng ngày."""
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    logger.info("=" * 60)
    logger.info("🚀 ZALO AUTO MESSENGER - SCHEDULER")
    logger.info("=" * 60)
    logger.info(f"   Nhóm ID   : {config.GROUP_ID}")
    logger.info(f"   Tin nhắn  : {config.MESSAGE_CONTENT}")
    logger.info(f"   Giờ gửi   : {config.SEND_HOUR:02d}:{config.SEND_MINUTE:02d}")
    logger.info(f"   Timezone  : {config.TIMEZONE}")
    logger.info(f"   Retries   : {config.MAX_RETRIES}")
    logger.info("=" * 60)

    # Validate credentials
    if not config.IMEI or not config.COOKIES:
        logger.critical("❌ Chưa cấu hình ZALO_IMEI và ZALO_COOKIES!")
        logger.critical("   Xem README để biết cách lấy.")
        sys.exit(1)

    if not config.GROUP_ID:
        logger.critical("❌ Chưa cấu hình GROUP_ID!")
        sys.exit(1)

    # Tạo scheduler
    scheduler = BlockingScheduler(
        timezone=config.TIMEZONE,
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": 3600,
        },
    )

    scheduler.add_listener(_job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    # Job gửi tin nhắn hàng ngày
    scheduler.add_job(
        _send_job,
        trigger=CronTrigger(
            hour=config.SEND_HOUR,
            minute=config.SEND_MINUTE,
            timezone=config.TIMEZONE,
        ),
        id="zalo_send_message",
        name=f"Gửi tin Zalo lúc {config.SEND_HOUR:02d}:{config.SEND_MINUTE:02d}",
        replace_existing=True,
    )

    # Health check mỗi giờ
    scheduler.add_job(
        _health_check,
        trigger=CronTrigger(minute=0, timezone=config.TIMEZONE),
        id="health_check",
        name="Health check",
        replace_existing=True,
    )

    next_run = scheduler.get_job("zalo_send_message").next_run_time
    logger.info(f"📅 Lần gửi tiếp theo: {next_run.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    logger.info("⏳ Đang chạy... (Ctrl+C để dừng)")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("🛑 Scheduler đã dừng.")


def _health_check():
    """Log trạng thái mỗi giờ."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info(f"💓 Health check [{now}] | Nhóm: {config.GROUP_ID}")
