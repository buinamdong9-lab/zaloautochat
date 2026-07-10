import { Zalo, ZaloAPI } from 'zca-js';
import { decrypt } from '../utils/crypto';
import db from '../config/db';
const { HttpsProxyAgent } = require('https-proxy-agent');

export class ZaloService {
  private static clients: Map<number, ZaloAPI> = new Map();

  /**
   * Get or create a Zalo API client for a user
   */
  public static async getClient(userId: number, forceRefresh = false): Promise<ZaloAPI> {
    if (!forceRefresh && this.clients.has(userId)) {
      return this.clients.get(userId)!;
    }

    const user = db.prepare('SELECT username, imei, encrypted_cookies, proxy FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    if (!user.imei || !user.encrypted_cookies) {
      throw new Error('Zalo credentials (IMEI and Cookies) are not configured yet.');
    }

    const key = process.env.ENCRYPTION_KEY || 'zalo-secret-key-32-chars-long!!!';
    const decryptedCookiesStr = decrypt(user.encrypted_cookies, key);

    let parsedCookies: any;
    try {
      // Try JSON first (can be SerializedCookie[] array or flat object)
      parsedCookies = JSON.parse(decryptedCookiesStr);
    } catch (e) {
      // Fallback: parse standard cookie string: "name1=val1; name2=val2"
      if (decryptedCookiesStr.includes('=')) {
        parsedCookies = {};
        decryptedCookiesStr.split(';').forEach(cookie => {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            if (name) parsedCookies[name] = value;
          }
        });
      } else {
        throw new Error('Failed to parse Zalo cookies. Ensure they are in valid cookie string format or JSON.');
      }
    }

    // Normalize to SerializedCookie[] array format expected by zca-js
    let cookieArray: any[] = [];
    if (Array.isArray(parsedCookies)) {
      cookieArray = parsedCookies;
    } else {
      cookieArray = Object.entries(parsedCookies).map(([name, value]) => ({
        key: name,
        value: value as string,
        domain: 'chat.zalo.me',
        path: '/'
      }));
    }

    const normalizedCookies = cookieArray.map(c => {
      const originalKey = c.key || c.name || '';
      const lowerKey = originalKey.toLowerCase();
      const key = lowerKey === 'zi_cookie' || lowerKey === '__zi' ? '__zi'
                : lowerKey === 'zpw_sek' ? 'zpw_sek'
                : lowerKey === 'zpsid' ? 'zpsid'
                : originalKey;
      return {
        key,
        value: c.value,
        domain: c.domain || 'chat.zalo.me',
        path: c.path || '/'
      };
    });

    const config: any = {};
    if (user.proxy) {
      try {
        console.log(`Setting up HTTPS Proxy for user ${userId} (${user.username}): ${user.proxy}`);
        config.agent = new HttpsProxyAgent(user.proxy);
      } catch (proxyErr) {
        console.error(`Invalid proxy URL format for user ${userId}:`, proxyErr);
      }
    }

    const zalo = new Zalo(config);
    try {
      const api = await zalo.login({
        cookie: normalizedCookies,
        imei: user.imei,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      this.clients.set(userId, api);
      return api;
    } catch (err) {
      console.error(`Failed to login Zalo for user ${userId} (${user.username}):`, err);
      throw new Error(`Zalo authentication failed: ${(err as Error).message}`);
    }
  }

  /**
   * Send a message to a thread (group or user)
   */
  public static async sendMessage(
    userId: number,
    recipientId: string,
    recipientType: 'GROUP' | 'USER',
    message: string
  ): Promise<any> {
    console.log(`Sending message to ${recipientType} '${recipientId}' for user ${userId}...`);
    let api = await this.getClient(userId);
    try {
      // Send message
      return await api.sendMessage(message, recipientId);
    } catch (err) {
      console.warn(`Initial send failed for user ${userId}, retrying with fresh client...`);
      try {
        api = await this.getClient(userId, true);
        return await api.sendMessage(message, recipientId);
      } catch (retryErr) {
        console.error(`Retry send failed for user ${userId}:`, retryErr);
        throw new Error((retryErr as Error).message);
      }
    }
  }

  /**
   * Get all friends of the authenticated Zalo account
   */
  public static async getFriends(userId: number): Promise<any[]> {
    const api = await this.getClient(userId);
    try {
      if (typeof (api as any).getAllFriends === 'function') {
        const friends = await (api as any).getAllFriends();
        if (!Array.isArray(friends)) return [];
        return friends.map((f: any) => ({
          id: f.userId || f.uid || f.id || '',
          name: f.displayName || f.zaloName || f.name || 'Bạn bè không tên'
        }));
      }
      return [];
    } catch (err) {
      console.error(`Failed to get friends list for user ${userId}:`, err);
      throw err;
    }
  }

  /**
   * Get group list
   */
  public static async getGroups(userId: number): Promise<any[]> {
    const api = await this.getClient(userId);
    try {
      if (typeof (api as any).getAllGroups === 'function') {
        const groupsRes = await (api as any).getAllGroups();
        const gridVerMap = groupsRes?.gridVerMap || {};
        const groupIds = Object.keys(gridVerMap);
        if (groupIds.length === 0) return [];

        if (typeof (api as any).getGroupInfo === 'function') {
          const infoRes = await (api as any).getGroupInfo(groupIds);
          const gridInfoMap = infoRes?.gridInfoMap || {};
          return groupIds.map(id => {
            const detail = gridInfoMap[id] || {};
            return {
              id,
              name: detail.name || detail.displayName || 'Nhóm không tên'
            };
          });
        }
        return groupIds.map(id => ({ id, name: 'Nhóm ' + id }));
      }
      if (typeof (api as any).getGroupList === 'function') {
        const groups = await (api as any).getGroupList();
        if (Array.isArray(groups)) {
          return groups.map((g: any) => ({
            id: g.id || g.threadId || g.groupId || '',
            name: g.name || g.displayName || 'Nhóm không tên'
          }));
        }
      }
      // Fallback or reflection check
      const apiKeys = Object.keys(api);
      const groupMethod = apiKeys.find(k => k.toLowerCase().includes('group') && typeof (api as any)[k] === 'function');
      if (groupMethod && groupMethod !== 'sendMessage' && groupMethod !== 'getGroupInfo') {
        console.log(`Found dynamic group retrieval method: ${groupMethod}`);
        const result = await (api as any)[groupMethod]();
        if (Array.isArray(result)) return result;
      }
      return [];
    } catch (err) {
      console.error(`Failed to get groups list for user ${userId}:`, err);
      throw err;
    }
  }

  /**
   * Clear client cache
   */
  public static logout(userId: number): void {
    this.clients.delete(userId);
  }
}
