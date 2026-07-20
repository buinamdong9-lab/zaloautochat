import cron from 'node-cron';
import db from '../config/db';
import { ZaloService } from './zaloService';
import https from 'https';
import fs from 'fs';
import path from 'path';
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

export class SchedulerService {
  // Map of scheduleId -> cron task
  private static activeJobs: Map<number, cron.ScheduledTask> = new Map();
  private static activePollWatchers: Map<number, { interval: NodeJS.Timeout; timeout: NodeJS.Timeout }> = new Map();
  private static logDir = path.resolve(__dirname, '../../data');
  private static systemLogPath = path.join(SchedulerService.logDir, 'system.log');

  private static getTimestamp(): string {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  }

  private static ensureSystemLogFile() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      if (!fs.existsSync(this.systemLogPath)) {
        fs.writeFileSync(this.systemLogPath, '', 'utf8');
      }
    } catch (err) {
      console.error('Failed to initialize system log file:', err);
    }
  }

  private static appendSystemLog(line: string) {
    try {
      this.ensureSystemLogFile();
      fs.appendFileSync(this.systemLogPath, line + '\n', 'utf8');
    } catch (err) {
      console.error('Failed to write system log file:', err);
    }
  }

  public static logSystem(level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL', message: string) {
    const line = `[${this.getTimestamp()}][SYSTEM][${level}] ${message}`;
    console.log(`[SYSTEM][${level}] ${message}`);
    this.appendSystemLog(line);
  }

  /**
   * Write logs to SQLite database and data/system.log
   */
  public static log(userId: number, level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL', message: string) {
    const time = this.getTimestamp(); // YYYY-MM-DD HH:mm:ss format
    const line = `[${time}][User ${userId}][${level}] ${message}`;
    try {
      db.prepare('INSERT INTO logs (user_id, time, level, message) VALUES (?, ?, ?, ?)').run(userId, time, level, message);
      console.log(`[User ${userId}][${level}] ${message}`);
    } catch (err) {
      console.error('Failed to write log to DB:', err);
    }
    this.appendSystemLog(line);
  }

  /**
   * Add a record to the send history
   */
  public static addHistory(
    userId: number,
    scheduleId: number,
    status: 'success' | 'error',
    message: string,
    recipientId: string,
    error?: string
  ) {
    const time = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    try {
      db.prepare(
        'INSERT INTO history (user_id, schedule_id, time, status, message_content, recipient_id, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, scheduleId, time, status, message, recipientId, error || null);
    } catch (err) {
      console.error('Failed to write history to DB:', err);
    }
  }

  /**
   * Load and schedule all active jobs from database
   */
  public static initSchedules() {
    this.ensureSystemLogFile();
    this.logSystem('INFO', 'Initializing active schedules...');
    const activeSchedules = db.prepare('SELECT * FROM schedules WHERE is_active = 1').all() as any[];

    for (const schedule of activeSchedules) {
      try {
        this.scheduleJob(schedule);
      } catch (err) {
        this.logSystem('ERROR', `Failed to schedule job ${schedule.id}: ${(err as Error).message}`);
      }
    }
    this.logSystem('INFO', `Loaded ${this.activeJobs.size} active schedules.`);
  }

  /**
   * Schedule a single job
   */
  public static scheduleJob(schedule: any) {
    // If job already exists, stop it first
    this.stopJob(schedule.id);

    const {
      id,
      user_id,
      message_content,
      action_type,
      poll_id,
      poll_question_filter,
      poll_option,
      watch_end_hour,
      watch_end_minute,
      poll_watch_interval_seconds,
      send_hour,
      send_minute,
      send_days,
      start_date,
      end_date,
      recipient_type,
      recipient_id
    } = schedule;

    // Convert send_days: "mon,tue,wed" to cron numbers "1,2,3"
    // node-cron dayOfWeek: 0-6 (0 is Sunday, or name like Sunday, Monday)
    const dayMap: Record<string, string> = {
      sun: '0', mon: '1', tue: '2', wed: '3', thu: '4', fri: '5', sat: '6'
    };
    
    const cronDays = send_days
      ? send_days.split(',').map((d: string) => dayMap[d.trim().toLowerCase()] || '*').join(',')
      : '*';

    // Cron expression: minute hour day-of-month month day-of-week
    const cronExpression = `${send_minute} ${send_hour} * * ${cronDays}`;

    this.log(user_id, 'INFO', `Scheduling job ${id}: ${send_hour}:${send_minute} on days [${send_days}]`);

    const task = cron.schedule(
      cronExpression,
      async () => {
        // Check date bounds
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // YYYY-MM-DD

        if (start_date && todayStr < start_date) {
          this.log(user_id, 'INFO', `Skipping schedule ${id}: Current date (${todayStr}) is before start date (${start_date}).`);
          return;
        }

        if (end_date && todayStr > end_date) {
          this.log(user_id, 'INFO', `Schedule ${id} reached end date (${end_date}). Disabling schedule.`);
          db.prepare('UPDATE schedules SET is_active = 0 WHERE id = ?').run(id);
          this.stopJob(id);
          return;
        }

        this.log(user_id, 'INFO', `Triggered scheduler job ${id} for recipient ${recipient_id}`);
        try {
          if ((action_type || 'send_message') === 'watch_poll') {
            this.startPollWatcher(schedule);
          } else if ((action_type || 'send_message') === 'vote_poll') {
            const voteResult = await ZaloService.votePollAttendance(user_id, recipient_id, poll_option, poll_id, poll_question_filter);
            const detail = `Vote poll "${poll_option}"${poll_question_filter ? ` (${poll_question_filter})` : ''}`;
            if (voteResult?.skipped === true) {
              this.log(user_id, 'INFO', `✅ Poll already voted with "${poll_option}" for schedule ${id}; skipped duplicate vote.`);
            } else {
              this.log(user_id, 'INFO', `✅ Successfully voted poll for schedule ${id}`);
            }
            this.addHistory(user_id, id, 'success', detail, recipient_id);
          } else {
            await ZaloService.sendMessage(user_id, recipient_id, recipient_type, message_content);
            this.log(user_id, 'INFO', `✅ Successfully sent message for schedule ${id}`);
            this.addHistory(user_id, id, 'success', message_content, recipient_id);
          }
        } catch (err) {
          const errMsg = (err as Error).message;
          const isPollAction = ['vote_poll', 'watch_poll'].includes(action_type || 'send_message');
          const actionLabel = isPollAction ? 'vote poll' : 'send message';
          const historyMessage = isPollAction
            ? `Vote poll "${poll_option || ''}"`
            : message_content;
          this.log(user_id, 'ERROR', `❌ Failed to ${actionLabel} for schedule ${id}: ${errMsg}`);
          this.addHistory(user_id, id, 'error', historyMessage, recipient_id, errMsg);
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Ho_Chi_Minh'
      }
    );

    this.activeJobs.set(id, task);
  }

  private static startPollWatcher(schedule: any) {
    const {
      id,
      user_id,
      recipient_id,
      poll_question_filter,
      poll_option,
      watch_end_hour,
      watch_end_minute,
      poll_watch_interval_seconds
    } = schedule;

    this.stopPollWatcher(id);

    const now = new Date();
    const endHour = Number.isFinite(Number(watch_end_hour)) ? Number(watch_end_hour) : 8;
    const endMinute = Number.isFinite(Number(watch_end_minute)) ? Number(watch_end_minute) : 0;
    const endAt = new Date(now);
    endAt.setHours(
      endHour,
      endMinute,
      0,
      0
    );

    if (endAt <= now) {
      this.log(user_id, 'WARNING', `Poll watcher ${id} skipped because end time has already passed.`);
      return;
    }

    const intervalSeconds = Math.max(15, Number(poll_watch_interval_seconds) || 60);
    this.log(user_id, 'INFO', `Started poll watcher ${id} for group ${recipient_id} until ${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')} every ${intervalSeconds}s.`);

    const tick = async () => {
      await this.processPollWatcherTick(schedule);
    };

    tick().catch(err => {
      this.log(user_id, 'ERROR', `Poll watcher ${id} tick failed: ${(err as Error).message}`);
    });

    const interval = setInterval(() => {
      tick().catch(err => {
        this.log(user_id, 'ERROR', `Poll watcher ${id} tick failed: ${(err as Error).message}`);
      });
    }, intervalSeconds * 1000);

    const timeout = setTimeout(() => {
      this.stopPollWatcher(id);
      this.log(user_id, 'INFO', `Stopped poll watcher ${id}: watch window ended.`);
    }, endAt.getTime() - now.getTime());

    this.activePollWatchers.set(id, { interval, timeout });
  }

  private static async processPollWatcherTick(schedule: any) {
    const { id, user_id, recipient_id, poll_question_filter, poll_option } = schedule;
    const poll = await ZaloService.getLatestOpenPoll(user_id, recipient_id, poll_question_filter);
    if (!poll?.poll_id) return;

    const pollId = String(poll.poll_id);
    const existing = db.prepare('SELECT id FROM poll_watch_history WHERE schedule_id = ? AND poll_id = ?')
      .get(id, pollId) as any;
    if (existing) return;

    const voteResult = await ZaloService.votePollAttendance(user_id, recipient_id, poll_option, pollId, poll_question_filter);
    const status = voteResult?.skipped === true ? 'skipped' : 'success';
    const message = voteResult?.skipped === true
      ? `Poll ${pollId} already voted with "${poll_option}"; marked as processed.`
      : `Voted poll ${pollId} with "${poll_option}".`;

    db.prepare(`
      INSERT OR IGNORE INTO poll_watch_history (schedule_id, user_id, poll_id, processed_at, status, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, user_id, pollId, this.getTimestamp(), status, message);

    this.log(user_id, 'INFO', `✅ Poll watcher ${id}: ${message}`);
    this.addHistory(user_id, id, 'success', `Watch poll "${poll_option}" (${pollId})`, recipient_id);
  }

  private static stopPollWatcher(scheduleId: number) {
    const watcher = this.activePollWatchers.get(scheduleId);
    if (!watcher) return;

    clearInterval(watcher.interval);
    clearTimeout(watcher.timeout);
    this.activePollWatchers.delete(scheduleId);
  }

  /**
   * Stop and delete a scheduled job
   */
  public static stopJob(scheduleId: number): boolean {
    this.stopPollWatcher(scheduleId);
    if (this.activeJobs.has(scheduleId)) {
      const task = this.activeJobs.get(scheduleId)!;
      task.stop();
      this.activeJobs.delete(scheduleId);
      return true;
    }
    return false;
  }

  /**
   * Refresh a job configuration (re-schedule)
   */
  public static refreshJob(scheduleId: number) {
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as any;
    if (schedule && schedule.is_active === 1) {
      this.scheduleJob(schedule);
    } else {
      this.stopJob(scheduleId);
    }
  }

  /**
   * Stop all jobs
   */
  public static stopAll() {
    for (const [id, task] of this.activeJobs.entries()) {
      task.stop();
    }
    for (const id of this.activePollWatchers.keys()) {
      this.stopPollWatcher(id);
    }
    this.activeJobs.clear();
    console.log('⏰ Stopped all active scheduler jobs.');
  }

  /**
   * Start a cron job to check the health of all proxies in the pool every 30 minutes
   */
  public static initProxyChecker() {
    console.log('⏰ Initializing background proxy health checker...');
    
    // Run immediately on startup in background
    setTimeout(() => this.checkAllProxies(), 5000);

    // Cron job to run every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      console.log('⏰ Running scheduled proxy health check...');
      await this.checkAllProxies();
    });
  }

  /**
   * Check health of all active proxies and deactivate dead ones
   */
  public static async checkAllProxies(): Promise<{ total: number, deactivated: number }> {
    try {
      const activeProxies = db.prepare('SELECT * FROM proxies WHERE is_active = 1').all() as any[];
      if (activeProxies.length === 0) {
        console.log('[Proxy Checker] No active proxies in pool to check.');
        return { total: 0, deactivated: 0 };
      }

      console.log(`[Proxy Checker] Validating ${activeProxies.length} active proxies...`);
      let deactivatedCount = 0;

      for (const p of activeProxies) {
        const isHealthy = await this.checkProxyHealth(p.url);
        if (!isHealthy) {
          console.warn(`[Proxy Checker] Proxy ${p.url} is dead. Deactivating in pool.`);
          db.prepare('UPDATE proxies SET is_active = 0 WHERE id = ?').run(p.id);
          deactivatedCount++;
        }
      }

      console.log(`[Proxy Checker] Validation complete. Deactivated ${deactivatedCount} dead proxies.`);
      return { total: activeProxies.length, deactivated: deactivatedCount };
    } catch (err) {
      console.error('[Proxy Checker] Error during proxy pool validation:', err);
      throw err;
    }
  }

  /**
   * Helper to perform a fast HTTPS request through a proxy to verify connection
   */
  private static checkProxyHealth(proxyUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        let agent;
        const cleanUrl = proxyUrl.trim();
        if (cleanUrl.startsWith('socks4://') || cleanUrl.startsWith('socks5://') || cleanUrl.startsWith('socks://')) {
          agent = new SocksProxyAgent(cleanUrl);
        } else {
          agent = new HttpsProxyAgent(cleanUrl);
        }

        const req = https.get('https://api.ipify.org?format=json', {
          agent,
          timeout: 4000 // 4 seconds timeout for checker
        }, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
        });

        req.on('error', () => {
          resolve(false);
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      } catch (err) {
        resolve(false);
      }
    });
  }
}
