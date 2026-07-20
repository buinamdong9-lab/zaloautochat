/**
 * -----------------------------------------------------------------------------
 * ZALO AUTO MESSENGER - ZALO INTEGRATION SERVICE ENGINE
 * -----------------------------------------------------------------------------
 * @version 2.5.0
 * @author Dong Bui
 * @copyright (c) 2026 Dong Bui. All rights reserved.
 * @contact Hotline/Zalo: 0779356619 | Email: buinamdong9@gmail.com
 * @license Proprietary - Closed Source
 * -----------------------------------------------------------------------------
 */

import { Zalo, ZaloAPI, ThreadType } from 'zca-js';
import { decrypt } from '../utils/crypto';
import db from '../config/db';
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

export class ZaloService {
  private static clients: Map<number, ZaloAPI> = new Map();

  private static normalizePollText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private static compactPollText(value: string): string {
    return this.normalizePollText(value).replace(/[^a-z0-9]/g, '');
  }

  private static pollTextInitials(value: string): string {
    const words = this.normalizePollText(value)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    if (words.length <= 1) return this.compactPollText(value);
    return words.map(word => word[0]).join('');
  }

  private static levenshteinDistance(left: string, right: string): number {
    const dp = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));

    for (let i = 0; i <= left.length; i++) dp[i][0] = i;
    for (let j = 0; j <= right.length; j++) dp[0][j] = j;

    for (let i = 1; i <= left.length; i++) {
      for (let j = 1; j <= right.length; j++) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[left.length][right.length];
  }

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
        const proxyUrl = user.proxy.trim();
        console.log(`Setting up Proxy for user ${userId} (${user.username}): ${proxyUrl}`);
        if (proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks://')) {
          config.agent = new SocksProxyAgent(proxyUrl);
        } else {
          config.agent = new HttpsProxyAgent(proxyUrl);
        }
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
    const threadType = recipientType === 'GROUP' ? ThreadType.Group : ThreadType.User;
    let api = await this.getClient(userId);
    try {
      // Send message with correct ThreadType (Group or User)
      return await api.sendMessage(message, recipientId, threadType);
    } catch (err) {
      console.warn(`Initial send failed for user ${userId}, retrying with fresh client...`);
      try {
        api = await this.getClient(userId, true);
        return await api.sendMessage(message, recipientId, threadType);
      } catch (retryErr) {
        console.error(`Retry send failed for user ${userId}:`, retryErr);
        const errMsg = (retryErr as Error).message || '';
        const isProxyError = errMsg.includes('ECONNRESET') || 
                             errMsg.includes('ETIMEDOUT') || 
                             errMsg.includes('ECONNREFUSED') || 
                             errMsg.includes('proxy') || 
                             errMsg.includes('tunneling socket') || 
                             errMsg.includes('socks');
        
        if (isProxyError) {
          console.warn(`[Failover] Proxy error detected: "${errMsg}". Attempting auto-failover...`);
          const failoverSuccess = await this.handleProxyFailover(userId);
          if (failoverSuccess) {
            try {
              console.log(`[Failover] Retrying send message with new proxy...`);
              api = await this.getClient(userId, true);
              return await api.sendMessage(message, recipientId, threadType);
            } catch (failoverSendErr) {
              console.error(`[Failover] Send message failed after proxy failover:`, failoverSendErr);
              throw new Error((failoverSendErr as Error).message);
            }
          }
        }
        
        throw new Error((retryErr as Error).message);
      }
    }
  }

  /**
   * Vote on a Zalo group poll. If pollId is not supplied, the newest matching
   * open poll is discovered from the group's board list.
   */
  public static async votePollAttendance(
    userId: number,
    groupId: string,
    pollOption: string,
    pollId?: string | number | null,
    questionFilter?: string | null
  ): Promise<any> {
    const api = await this.getClient(userId);
    const pollApi = api as any;

    if (typeof pollApi.votePoll !== 'function') {
      throw new Error('Current zca-js client does not expose votePoll().');
    }

    const pollIdNumber = await this.resolvePollId(pollApi, groupId, pollId, questionFilter);
    if (!pollIdNumber) {
      throw new Error(`No open group poll was found in group ${groupId}.`);
    }
    const pollDetail = await this.getPollDetailForVote(pollApi, pollIdNumber);

    if (pollDetail?.closed) {
      throw new Error(`Poll ${pollIdNumber} is already closed.`);
    }

    const optionIds = this.resolvePollOptionIds(pollDetail, pollOption);
    if (this.isPollAlreadyVoted(pollDetail, optionIds)) {
      console.log(`Poll ${pollIdNumber} already has selected option(s) ${optionIds.join(', ')} for user ${userId}. Skipping vote.`);
      return {
        skipped: true,
        reason: 'already_voted',
        pollId: pollIdNumber,
        optionIds
      };
    }

    console.log(`Voting poll ${pollIdNumber} with option(s) ${optionIds.join(', ')} for user ${userId}...`);
    return await pollApi.votePoll(pollIdNumber, optionIds);
  }

  public static async getLatestOpenPoll(
    userId: number,
    groupId: string,
    questionFilter?: string | null
  ): Promise<any | null> {
    const api = await this.getClient(userId);
    const pollApi = api as any;
    const pollId = await this.resolvePollId(pollApi, groupId, null, questionFilter, false);
    if (!pollId) return null;
    return await this.getPollDetailForVote(pollApi, pollId);
  }

  private static async resolvePollId(
    api: any,
    groupId: string,
    pollId?: string | number | null,
    questionFilter?: string | null,
    throwWhenMissing = true
  ): Promise<number | null> {
    if (pollId !== undefined && pollId !== null && String(pollId).trim()) {
      const parsed = Number(String(pollId).trim());
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid poll ID: ${pollId}`);
      }
      return parsed;
    }

    if (typeof api.getListBoard !== 'function') {
      throw new Error('Missing poll_id and current zca-js client does not expose getListBoard().');
    }

    const boards = await api.getListBoard({ page: 1, count: 20 }, groupId);
    const items = Array.isArray(boards?.items) ? boards.items : [];
    const normalizedFilter = questionFilter ? this.normalizePollText(questionFilter) : '';

    const matchingPoll = items
      .map((item: any) => item?.data)
      .filter((poll: any) => poll && poll.poll_id && Array.isArray(poll.options))
      .filter((poll: any) => !poll.closed)
      .find((poll: any) => {
        if (!normalizedFilter) return true;
        return this.normalizePollText(String(poll.question || '')).includes(normalizedFilter);
      });

    if (!matchingPoll) {
      if (!throwWhenMissing) return null;
      const suffix = questionFilter ? ` matching "${questionFilter}"` : '';
      throw new Error(`No open group poll${suffix} was found in group ${groupId}.`);
    }

    return Number(matchingPoll.poll_id);
  }

  private static async getPollDetailForVote(api: any, pollId: number): Promise<any> {
    if (typeof api.getPollDetail === 'function') {
      return await api.getPollDetail(pollId);
    }
    return { poll_id: pollId, options: [] };
  }

  private static resolvePollOptionIds(pollDetail: any, pollOption: string): number[] {
    const rawOptions = pollOption
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (rawOptions.length === 0) {
      throw new Error('Poll option is required.');
    }

    const pollOptions = Array.isArray(pollDetail?.options) ? pollDetail.options : [];
    const resolvedIds = rawOptions.map(rawOption => {
      const numericOptionId = Number(rawOption);
      if (Number.isFinite(numericOptionId)) return numericOptionId;

      const normalizedTarget = this.normalizePollText(rawOption);
      const exact = pollOptions.find((option: any) => this.normalizePollText(String(option.content || '')) === normalizedTarget);
      if (exact) return Number(exact.option_id);

      const partial = pollOptions.find((option: any) => this.normalizePollText(String(option.content || '')).includes(normalizedTarget));
      if (partial) return Number(partial.option_id);

      const compactTarget = this.compactPollText(rawOption);
      const targetInitials = this.pollTextInitials(rawOption);
      const abbreviation = pollOptions.find((option: any) => {
        const content = String(option.content || '');
        const compactContent = this.compactPollText(content);
        const contentInitials = this.pollTextInitials(content);
        return compactContent === targetInitials || contentInitials === compactTarget || contentInitials === targetInitials;
      });
      if (abbreviation) return Number(abbreviation.option_id);

      const fuzzyMatches = pollOptions
        .map((option: any) => ({
          option,
          compactContent: this.compactPollText(String(option.content || ''))
        }))
        .map(({ option, compactContent }: any) => ({
          option,
          distance: this.levenshteinDistance(compactTarget, compactContent),
          maxLength: Math.max(compactTarget.length, compactContent.length)
        }))
        .filter(({ distance, maxLength }: any) => maxLength >= 4 && distance <= Math.max(1, Math.floor(maxLength * 0.25)))
        .sort((a: any, b: any) => a.distance - b.distance);

      if (fuzzyMatches.length === 1 || (fuzzyMatches.length > 1 && fuzzyMatches[0].distance < fuzzyMatches[1].distance)) {
        return Number(fuzzyMatches[0].option.option_id);
      }

      if (fuzzyMatches.length > 1) {
        const ambiguous = fuzzyMatches.map((match: any) => match.option.content).join(', ');
        throw new Error(`Poll option "${rawOption}" is ambiguous. Close matches: ${ambiguous}`);
      }

      const available = pollOptions.map((option: any) => option.content).filter(Boolean).join(', ');
      throw new Error(`Poll option "${rawOption}" was not found. Available options: ${available || 'unknown'}`);
    });

    return Array.from(new Set(resolvedIds));
  }

  private static isPollAlreadyVoted(pollDetail: any, optionIds: number[]): boolean {
    const pollOptions = Array.isArray(pollDetail?.options) ? pollDetail.options : [];
    if (pollOptions.length === 0) return false;

    const votedOptionIds = pollOptions
      .filter((option: any) => option?.voted)
      .map((option: any) => Number(option.option_id));

    if (votedOptionIds.length === 0) return false;

    const targetIds = new Set(optionIds.map(Number));
    return votedOptionIds.length === targetIds.size && votedOptionIds.every((id: number) => targetIds.has(id));
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

  /**
   * Attempt auto-failover to another active proxy in the pool when user's proxy fails
   */
  private static async handleProxyFailover(userId: number): Promise<boolean> {
    try {
      // Get the user's current failed proxy
      const user = db.prepare('SELECT username, proxy FROM users WHERE id = ?').get(userId) as any;
      if (!user) return false;
      
      const failedProxy = user.proxy;
      if (failedProxy) {
        console.log(`[Failover] User ${user.username} (ID ${userId}) proxy failed: ${failedProxy}. Marking proxy as inactive in pool.`);
        // Mark the failed proxy as inactive in the pool
        db.prepare('UPDATE proxies SET is_active = 0 WHERE url = ?').run(failedProxy);
      }
      
      // Get a random active proxy from the pool
      const newProxyRow = db.prepare('SELECT url FROM proxies WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1').get() as any;
      if (newProxyRow && newProxyRow.url) {
        const newProxy = newProxyRow.url;
        console.log(`[Failover] Found new active proxy in pool: ${newProxy}. Assigning to user ${user.username}.`);
        // Assign new proxy to user
        db.prepare('UPDATE users SET proxy = ? WHERE id = ?').run(newProxy, userId);
        // Reset client cache
        this.logout(userId);
        return true;
      } else {
        console.warn(`[Failover] No active proxies available in the pool for user ${user.username}.`);
        return false;
      }
    } catch (err) {
      console.error('[Failover] Error handling proxy failover:', err);
      return false;
    }
  }
}
