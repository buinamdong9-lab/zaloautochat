"""
Sender Module - Gửi tin nhắn Zalo qua zlapi (internal API).

Không cần mở trình duyệt. Gọi trực tiếp API Zalo bằng cookies + IMEI.
Nhẹ, nhanh, phù hợp chạy trên server/Docker.
"""

import json
import logging
import random
import time

from zlapi import ZaloAPI
from zlapi.models import Message, ThreadType

import config

logger = logging.getLogger(__name__)


class ZaloSendError(Exception):
    """Lỗi khi gửi tin nhắn Zalo."""
    pass


class SessionExpiredError(ZaloSendError):
    """Session đã hết hạn, cần lấy cookies mới."""
    pass


def _create_client() -> ZaloAPI:
    """Tạo ZaloAPI client từ credentials trong config."""
    if not config.IMEI:
        raise SessionExpiredError(
            "Chưa cấu hình ZALO_IMEI. Xem README để biết cách lấy."
        )

    # Build cookies dict từ env vars
    import os
    from dotenv import load_dotenv
    load_dotenv(override=True)

    cookies = {}
    zpw_sek = os.getenv("ZPW_SEK", "")
    zpsid = os.getenv("ZPSID", "")
    zi_cookie = os.getenv("ZI_COOKIE", "")

    if zpw_sek:
        cookies["zpw_sek"] = zpw_sek
    if zpsid:
        cookies["zpsid"] = zpsid
    if zi_cookie:
        cookies["__zi"] = zi_cookie

    if not cookies:
        raise SessionExpiredError(
            "Chưa cấu hình cookies (ZPW_SEK, ZPSID). Xem README."
        )

    try:
        client = ZaloAPI(
            imei=config.IMEI,
            cookies=cookies,
        )
        logger.info("Da ket noi Zalo API thanh cong.")
        return client

    except Exception as e:
        error_msg = str(e).lower()
        if "session" in error_msg or "cookie" in error_msg or "login" in error_msg:
            raise SessionExpiredError(f"Session het han: {e}")
        raise ZaloSendError(f"Khong the ket noi Zalo: {e}") from e


def send_message(group_id: str = None, message: str = None) -> bool:
    """
    Gửi tin nhắn vào nhóm Zalo.

    Args:
        group_id: ID nhóm chat (mặc định lấy từ config)
        message: Nội dung tin nhắn (mặc định lấy từ config)

    Returns:
        True nếu gửi thành công
    """
    group_id = group_id or config.GROUP_ID
    message = message or config.MESSAGE_CONTENT

    if not group_id:
        raise ZaloSendError(
            "Chưa cấu hình GROUP_ID. Xem README để biết cách lấy."
        )

    recipient_type = getattr(config, "RECIPIENT_TYPE", "GROUP").upper()
    thread_type = ThreadType.USER if recipient_type == "USER" else ThreadType.GROUP
    recipient_label = "ca nhan" if recipient_type == "USER" else "nhom"

    logger.info(f"Dang gui tin nhan den {recipient_label} '{group_id}'...")
    logger.info(f"Noi dung: {message}")

    client = _create_client()

    try:
        client.send(
            Message(text=message),
            thread_id=group_id,
            thread_type=thread_type,
        )
        logger.info(f"✅ Gui tin nhan thanh cong den {recipient_label} '{group_id}'")
        return True

    except Exception as e:
        error_msg = str(e).lower()
        if any(kw in error_msg for kw in ["session", "cookie", "login", "auth", "token"]):
            raise SessionExpiredError(f"Session het han: {e}")
        raise ZaloSendError(f"Gui tin nhan that bai: {e}") from e


def send_message_with_retry(group_id: str = None, message: str = None) -> bool:
    """
    Gửi tin nhắn với cơ chế retry.

    Returns:
        True nếu gửi thành công
    """
    last_error = None

    for attempt in range(1, config.MAX_RETRIES + 1):
        try:
            logger.info(f"Lần thử {attempt}/{config.MAX_RETRIES}")
            return send_message(group_id, message)

        except SessionExpiredError:
            logger.error("❌ Session đã hết hạn! Cần lấy cookies mới.")
            raise

        except ZaloSendError as e:
            last_error = e
            if attempt < config.MAX_RETRIES:
                # Exponential backoff với jitter
                delay = config.RETRY_DELAY * (2 ** (attempt - 1))
                jitter = random.uniform(0, delay * 0.3)
                wait_time = delay + jitter
                logger.warning(
                    f"Thử lại sau {wait_time:.0f}s... "
                    f"(lần {attempt}/{config.MAX_RETRIES})"
                )
                time.sleep(wait_time)

    logger.error(f"❌ Thất bại sau {config.MAX_RETRIES} lần thử: {last_error}")
    raise last_error
