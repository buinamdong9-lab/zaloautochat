import cron from 'node-cron';
import db from '../config/db';
import { ZaloService } from './zaloService';

export class SchedulerService {
  // Map of scheduleId -> cron task
  private static activeJobs: Map<number, cron.ScheduledTask> = new Map();

  /**
   * Write logs directly to SQLite database
   */
  public static log(userId: number, level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL', message: string) {
    const time = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // YYYY-MM-DD HH:mm:ss format
    try {
      db.prepare('INSERT INTO logs (user_id, time, level, message) VALUES (?, ?, ?, ?)').run(userId, time, level, message);
      console.log(`[User ${userId}][${level}] ${message}`);
    } catch (err) {
      console.error('Failed to write log to DB:', err);
    }
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
    console.log('⏰ Initializing active schedules...');
    const activeSchedules = db.prepare('SELECT * FROM schedules WHERE is_active = 1').all() as any[];

    for (const schedule of activeSchedules) {
      try {
        this.scheduleJob(schedule);
      } catch (err) {
        console.error(`Failed to schedule job ${schedule.id}:`, err);
      }
    }
    console.log(`⏰ Loaded ${this.activeJobs.size} active schedules.`);
  }

  /**
   * Schedule a single job
   */
  public static scheduleJob(schedule: any) {
    // If job already exists, stop it first
    this.stopJob(schedule.id);

    const { id, user_id, message_content, send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id } = schedule;

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
          await ZaloService.sendMessage(user_id, recipient_id, recipient_type, message_content);
          this.log(user_id, 'INFO', `✅ Successfully sent message for schedule ${id}`);
          this.addHistory(user_id, id, 'success', message_content, recipient_id);
        } catch (err) {
          const errMsg = (err as Error).message;
          this.log(user_id, 'ERROR', `❌ Failed to send message for schedule ${id}: ${errMsg}`);
          this.addHistory(user_id, id, 'error', message_content, recipient_id, errMsg);
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Ho_Chi_Minh'
      }
    );

    this.activeJobs.set(id, task);
  }

  /**
   * Stop and delete a scheduled job
   */
  public static stopJob(scheduleId: number): boolean {
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
    this.activeJobs.clear();
    console.log('⏰ Stopped all active scheduler jobs.');
  }
}
