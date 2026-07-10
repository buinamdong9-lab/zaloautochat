"""
Script lấy danh sách bạn bè Zalo (Tên và User ID).
Chạy: python get_friends.py
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

print("Dang ket noi Zalo...")
try:
    client = ZaloAPI(imei=imei, cookies=cookies)
    print("Ket noi thanh cong!\n")

    print("Dang lay danh sach ban be...")
    # fetchAllFriends() tra ve danh sach object hoac dict
    friends_response = client.fetchAllFriends()
    
    # Kiem tra va phan tich du lieu tra ve
    friends_list = []
    
    # Truong hop 1: Tra ve list truc tiep
    if isinstance(friends_response, list):
        friends_list = friends_response
    # Truong hop 2: Tra ve mot class object co chua list hoac map
    elif hasattr(friends_response, 'friends'):
        friends_list = friends_response.friends
    elif hasattr(friends_response, 'gridInfoMap'):
        friends_list = list(friends_response.gridInfoMap.values())
    elif isinstance(friends_response, dict):
        friends_list = list(friends_response.values())
    else:
        # Neu khong thuoc cac truong hop tren, thu quet cac thuoc tinh
        for attr in dir(friends_response):
            if not attr.startswith('_'):
                val = getattr(friends_response, attr)
                if isinstance(val, (list, dict)) and len(val) > 0:
                    friends_list = list(val.values()) if isinstance(val, dict) else val
                    break

    if not friends_list:
        # Fallback log ra de kiem tra cau truc
        print("Khong tu dong phan tich duoc danh sach ban be.")
        print(f"Kieu tra ve: {type(friends_response)}")
        print(f"Du lieu: {str(friends_response)[:500]}")
        
        # Luu log raw de nghien cuu
        with open("friends_raw.txt", "w", encoding="utf-8") as f:
            f.write(str(friends_response))
    else:
        print(f"Tim thay {len(friends_list)} ban be. Dang xuat ra file...")
        
        lines = []
        lines.append(f"Tim thay {len(friends_list)} ban be:\n")
        lines.append(f"{'STT':<5} {'USER ID':<25} TEN BAN BE")
        lines.append("-" * 70)
        
        for i, friend in enumerate(friends_list, 1):
            # Trich xuat id va name tuy theo kieu doi tuong
            uid = ""
            name = ""
            
            if isinstance(friend, dict):
                uid = friend.get('uid') or friend.get('userId') or friend.get('id') or ""
                name = friend.get('name') or friend.get('displayName') or ""
            else:
                uid = getattr(friend, 'uid', '') or getattr(friend, 'userId', '') or getattr(friend, 'id', '') or ""
                name = getattr(friend, 'name', '') or getattr(friend, 'displayName', '') or str(friend)
            
            lines.append(f"{i:<5} {uid:<25} {name}")
            
        output = "\n".join(lines)
        with open("friends.txt", "w", encoding="utf-8") as f:
            f.write(output)
        print("Da ghi danh sach ban be vao file: friends.txt")

except Exception as e:
    print(f"Loi: {e}")
    import traceback
    traceback.print_exc()
