"""
Script lấy danh sách nhóm Zalo - xuất ra file UTF-8.
"""
from zlapi import ZaloAPI
from dotenv import load_dotenv
import os

load_dotenv()

imei = os.getenv("ZALO_IMEI", "")
cookies = {
    "zpw_sek": os.getenv("ZPW_SEK", ""),
    "zpsid": os.getenv("ZPSID", ""),
    "__zi": os.getenv("ZI_COOKIE", ""),
}
cookies = {k: v for k, v in cookies.items() if v}

client = ZaloAPI(imei=imei, cookies=cookies)

threads = client.fetchAllGroups()
group_ids = list(threads.gridVerMap.keys())

lines = []
lines.append(f"Tim thay {len(group_ids)} nhom:\n")
lines.append(f"{'STT':<5} {'GROUP ID':<25} TEN NHOM")
lines.append("-" * 70)

for i, gid in enumerate(group_ids, 1):
    try:
        info = client.fetchGroupInfo(gid)
        if info and hasattr(info, 'gridInfoMap') and info.gridInfoMap:
            g = info.gridInfoMap.get(str(gid))
            name = getattr(g, 'name', '???') if g else '???'
        else:
            name = '(khong lay duoc)'
        lines.append(f"{i:<5} {gid:<25} {name}")
    except Exception as e:
        lines.append(f"{i:<5} {gid:<25} (loi: {e})")

output = "\n".join(lines)

# Ghi ra file UTF-8
with open("groups.txt", "w", encoding="utf-8") as f:
    f.write(output)

print("Da xuat danh sach nhom vao file: groups.txt")
