"""
Zalo Auto Messenger - Entry Point

Usage:
    python main.py web      Mở giao diện web quản lý (mặc định)
    python main.py run      Chạy scheduler (không có giao diện)
    python main.py test     Gửi 1 tin nhắn test ngay lập tức
"""

import argparse
import logging
import sys

import config


def setup_logging():
    """Cấu hình logging ra console và file."""
    config.LOGS_DIR.mkdir(exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

    # Console
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.DEBUG)
    formatter = logging.Formatter(config.LOG_FORMAT, datefmt=config.LOG_DATE_FORMAT)
    console.setFormatter(formatter)
    root_logger.addHandler(console)

    # File
    log_file = config.LOGS_DIR / "zalo_messenger.log"
    file_handler = logging.FileHandler(str(log_file), encoding="utf-8", mode="a")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


def cmd_web():
    """Chạy web dashboard."""
    from web import app
    logger = logging.getLogger(__name__)
    port = 5100
    logger.info(f"[WEB] Mo giao dien web tai http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)


def cmd_run():
    """Chạy scheduler (headless, không có giao diện)."""
    from scheduler import start_scheduler
    start_scheduler()


def cmd_test():
    """Gửi tin nhắn test ngay lập tức."""
    from sender import send_message_with_retry, SessionExpiredError, ZaloSendError

    logger = logging.getLogger(__name__)
    logger.info("🧪 TEST - Gửi tin nhắn ngay")
    logger.info(f"   Nhóm ID: {config.GROUP_ID}")
    logger.info(f"   Tin nhắn: {config.MESSAGE_CONTENT}")

    try:
        send_message_with_retry()
        logger.info("✅ Test thành công!")
    except SessionExpiredError as e:
        logger.error(f"❌ {e}")
        sys.exit(1)
    except ZaloSendError as e:
        logger.error(f"❌ Test thất bại: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Zalo Auto Messenger - Tự động gửi tin nhắn Zalo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ví dụ:
  python main.py web      Mở giao diện web quản lý (port 5100)
  python main.py run      Chạy scheduler headless
  python main.py test     Gửi 1 tin test ngay lập tức
        """,
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="web",
        choices=["web", "run", "test"],
        help="Lệnh: web (mặc định), run, test",
    )

    args = parser.parse_args()
    setup_logging()

    {"web": cmd_web, "run": cmd_run, "test": cmd_test}[args.command]()


if __name__ == "__main__":
    main()
