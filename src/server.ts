/**
 * -----------------------------------------------------------------------------
 * ZALO AUTO MESSENGER - EXPRESS API SERVICE SERVER
 * -----------------------------------------------------------------------------
 * @version 2.5.0
 * @author Dong Bui
 * @copyright (c) 2026 Dong Bui. All rights reserved.
 * @contact Hotline/Zalo: 0779356619 | Email: buinamdong9@gmail.com
 * @license Proprietary - Closed Source
 * -----------------------------------------------------------------------------
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from './config/db';
import { ZaloService } from './services/zaloService';
import { SchedulerService } from './services/scheduler';
import { encrypt, isUsingNative } from './utils/crypto';
import { QRManager } from './services/qrManager';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5200;
const JWT_SECRET = process.env.JWT_SECRET || 'zalo-jwt-secret-key-!!!';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'zalo-secret-key-32-chars-long!!!';

// 1. HTTP Security Headers (mitigate XSS, clickjacking, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow CDN fonts & styles
  crossOriginEmbedderPolicy: false
}));

// Disable X-Powered-By header to prevent fingerprinting
app.disable('x-powered-by');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 2. Rate Limiting to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit to 15 authentication attempts per 15 mins
  message: { success: false, message: 'Phát hiện nhiều yêu cầu đăng nhập/đăng ký từ IP của bạn. Vui lòng thử lại sau 15 phút.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit to 100 API requests per minute
  message: { success: false, message: 'Yêu cầu quá nhanh. Vui lòng thử lại sau.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// Interface for Express requests with User Info
interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
  };
}

// Authentication Middleware
function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Also support reading token from query parameters (for direct file downloads)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    req.user = user as any;
    next();
  });
}

// --- AUTHENTICATION ROUTES ---

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu phải ở dạng chuỗi ký tự.' });
  }

  const cleanUsername = username.trim();
  if (!cleanUsername || !password) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu không được để trống.' });
  }

  // Alphanumeric validation (3-20 chars)
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(cleanUsername)) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập phải dài từ 3-20 ký tự và chỉ chứa chữ cái, số hoặc dấu gạch dưới.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Mật khẩu phải chứa ít nhất 6 ký tự.' });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    
    // Make the first user the administrator, disable further public registrations
    const userCountResult = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
    if (userCountResult.count > 0) {
      return res.status(403).json({ success: false, message: 'Đăng ký tài khoản mới đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên để cấp tài khoản.' });
    }
    const isAdmin = 1;

    const result = db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(username, passwordHash, isAdmin);
    
    // Auto register a default schedule for convenience
    db.prepare(`
      INSERT INTO schedules (user_id, message_content, send_hour, send_minute, send_days, recipient_type, recipient_id, is_active)
      VALUES (?, 'Nhắc nhở điểm danh! 📋', 7, 0, 'mon,tue,wed,thu,fri', 'GROUP', 'your_group_id_here', 0)
    `).run(result.lastInsertRowid);

    return res.json({ success: true, message: 'Registration successful!' });
  } catch (err) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Định dạng tài khoản hoặc mật khẩu không hợp lệ.' });
  }

  const cleanUsername = username.trim();
  if (!cleanUsername || !password) {
    return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu không được để trống.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(400).json({ success: false, message: 'Invalid username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        timezone: user.timezone,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- USER CONFIGURATION ROUTES ---

app.get('/api/user/config', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const user = db.prepare('SELECT username, imei, encrypted_cookies, timezone, proxy FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    return res.json({
      success: true,
      config: {
        username: user.username,
        imei: user.imei || '',
        cookiesSet: !!user.encrypted_cookies,
        timezone: user.timezone,
        proxy: user.proxy || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/user/config', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { imei, cookies, timezone, proxy } = req.body;

  try {
    if (timezone) {
      db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, userId);
    }

    if (proxy !== undefined) {
      const cleanProxy = proxy.trim() ? proxy.trim() : null;
      db.prepare('UPDATE users SET proxy = ? WHERE id = ?').run(cleanProxy, userId);
      
      // Force reconnect Zalo client to apply new proxy settings
      ZaloService.logout(userId);
    }

    if (imei !== undefined && cookies !== undefined) {
      if (cookies.trim()) {
        // Encrypt the cookies using our C native module (or TS fallback)
        const encrypted = encrypt(cookies.trim(), ENCRYPTION_KEY);
        db.prepare('UPDATE users SET imei = ?, encrypted_cookies = ? WHERE id = ?').run(imei.trim(), encrypted, userId);
      } else {
        db.prepare('UPDATE users SET imei = ? WHERE id = ?').run(imei.trim(), userId);
      }
      
      // Logout the user client in cache to force re-authentication with new credentials
      ZaloService.logout(userId);
      SchedulerService.log(userId, 'INFO', 'Zalo credentials updated. Resetting session cache.');
    }

    return res.json({ success: true, message: 'Configuration saved successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- SCHEDULES CRUD ROUTES ---

app.get('/api/schedules', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const schedules = db.prepare('SELECT * FROM schedules WHERE user_id = ?').all(userId);
    return res.json({ success: true, schedules });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/schedules', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const {
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
  } = req.body;
  const cleanActionType = action_type === 'vote_poll' || action_type === 'watch_poll' ? action_type : 'send_message';

  if (send_hour === undefined || send_minute === undefined || !send_days || !recipient_id) {
    return res.status(400).json({ success: false, message: 'Missing required schedule fields' });
  }
  if (cleanActionType === 'send_message' && !message_content) {
    return res.status(400).json({ success: false, message: 'Message content is required' });
  }
  if ((cleanActionType === 'vote_poll' || cleanActionType === 'watch_poll') && !poll_option) {
    return res.status(400).json({ success: false, message: 'Poll option is required' });
  }
  if (cleanActionType === 'watch_poll') {
    const startMinutes = Number(send_hour) * 60 + Number(send_minute);
    const endMinutes = Number(watch_end_hour ?? 8) * 60 + Number(watch_end_minute ?? 0);
    if (endMinutes <= startMinutes) {
      return res.status(400).json({ success: false, message: 'Watch end time must be after start time' });
    }
    if (poll_watch_interval_seconds !== undefined && Number(poll_watch_interval_seconds) < 15) {
      return res.status(400).json({ success: false, message: 'Poll watch interval must be at least 15 seconds' });
    }
  }

  try {
    const result = db.prepare(`
      INSERT INTO schedules (
        user_id, message_content, action_type, poll_id, poll_question_filter, poll_option,
        watch_end_hour, watch_end_minute, poll_watch_interval_seconds,
        send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      userId,
      message_content || '',
      cleanActionType,
      poll_id ? String(poll_id).trim() : null,
      poll_question_filter ? String(poll_question_filter).trim() : null,
      poll_option ? String(poll_option).trim() : null,
      watch_end_hour !== undefined ? Number(watch_end_hour) : 8,
      watch_end_minute !== undefined ? Number(watch_end_minute) : 0,
      poll_watch_interval_seconds !== undefined ? Math.max(15, Number(poll_watch_interval_seconds) || 60) : 60,
      send_hour,
      send_minute,
      send_days,
      start_date || null,
      end_date || null,
      recipient_type || 'GROUP',
      recipient_id
    );

    const newScheduleId = result.lastInsertRowid as number;
    
    // Schedule the new job
    const newSchedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(newScheduleId);
    SchedulerService.scheduleJob(newSchedule);

    return res.json({ success: true, message: 'Schedule created successfully!', schedule: newSchedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.put('/api/schedules/:id', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const scheduleId = parseInt(req.params.id);
  const {
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
    recipient_id,
    is_active
  } = req.body;
  const cleanActionType = ['vote_poll', 'watch_poll', 'send_message'].includes(action_type) ? action_type : undefined;

  try {
    // Check ownership
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(scheduleId, userId) as any;
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });
    const nextActionType = cleanActionType || schedule.action_type || 'send_message';
    const nextPollOption = poll_option !== undefined ? String(poll_option).trim() : schedule.poll_option;
    const nextMessageContent = message_content !== undefined ? message_content : schedule.message_content;

    if ((nextActionType === 'vote_poll' || nextActionType === 'watch_poll') && !nextPollOption && is_active === undefined) {
      return res.status(400).json({ success: false, message: 'Poll option is required' });
    }
    if (nextActionType === 'send_message' && !nextMessageContent && is_active === undefined) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }
    if (nextActionType === 'watch_poll' && is_active === undefined) {
      const nextStartHour = send_hour !== undefined ? Number(send_hour) : Number(schedule.send_hour);
      const nextStartMinute = send_minute !== undefined ? Number(send_minute) : Number(schedule.send_minute);
      const nextEndHour = watch_end_hour !== undefined ? Number(watch_end_hour) : Number(schedule.watch_end_hour ?? 8);
      const nextEndMinute = watch_end_minute !== undefined ? Number(watch_end_minute) : Number(schedule.watch_end_minute ?? 0);
      if ((nextEndHour * 60 + nextEndMinute) <= (nextStartHour * 60 + nextStartMinute)) {
        return res.status(400).json({ success: false, message: 'Watch end time must be after start time' });
      }
      if (poll_watch_interval_seconds !== undefined && Number(poll_watch_interval_seconds) < 15) {
        return res.status(400).json({ success: false, message: 'Poll watch interval must be at least 15 seconds' });
      }
    }

    db.prepare(`
      UPDATE schedules
      SET message_content = COALESCE(?, message_content),
          action_type = COALESCE(?, action_type),
          poll_id = ?,
          poll_question_filter = ?,
          poll_option = ?,
          watch_end_hour = COALESCE(?, watch_end_hour),
          watch_end_minute = COALESCE(?, watch_end_minute),
          poll_watch_interval_seconds = COALESCE(?, poll_watch_interval_seconds),
          send_hour = COALESCE(?, send_hour),
          send_minute = COALESCE(?, send_minute),
          send_days = COALESCE(?, send_days),
          start_date = ?,
          end_date = ?,
          recipient_type = COALESCE(?, recipient_type),
          recipient_id = COALESCE(?, recipient_id),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      message_content,
      cleanActionType,
      poll_id !== undefined ? (poll_id ? String(poll_id).trim() : null) : schedule.poll_id,
      poll_question_filter !== undefined ? (poll_question_filter ? String(poll_question_filter).trim() : null) : schedule.poll_question_filter,
      poll_option !== undefined ? (poll_option ? String(poll_option).trim() : null) : schedule.poll_option,
      watch_end_hour !== undefined ? Number(watch_end_hour) : undefined,
      watch_end_minute !== undefined ? Number(watch_end_minute) : undefined,
      poll_watch_interval_seconds !== undefined ? Math.max(15, Number(poll_watch_interval_seconds) || 60) : undefined,
      send_hour,
      send_minute,
      send_days,
      start_date !== undefined ? (start_date || null) : schedule.start_date,
      end_date !== undefined ? (end_date || null) : schedule.end_date,
      recipient_type,
      recipient_id,
      is_active,
      scheduleId
    );

    // Refresh schedule job
    SchedulerService.refreshJob(scheduleId);

    return res.json({ success: true, message: 'Schedule updated successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.delete('/api/schedules/:id', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const scheduleId = parseInt(req.params.id);

  try {
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(scheduleId, userId);
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    // Stop job and delete
    SchedulerService.stopJob(scheduleId);
    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);

    return res.json({ success: true, message: 'Schedule deleted successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- ZALO SERVICE INTERACTIONS ---

app.post('/api/zalo/test-send', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { recipientId, recipientType, message } = req.body;

  if (!recipientId || !message) {
    return res.status(400).json({ success: false, message: 'Recipient ID and message content are required' });
  }

  try {
    SchedulerService.log(userId, 'INFO', `Triggered manual test-send to ${recipientType || 'GROUP'} '${recipientId}'`);
    await ZaloService.sendMessage(userId, recipientId, recipientType || 'GROUP', message);
    SchedulerService.log(userId, 'INFO', `✅ Manual test-send success to '${recipientId}'`);
    SchedulerService.addHistory(userId, 0, 'success', message, recipientId);
    return res.json({ success: true, message: 'Message sent successfully!' });
  } catch (err) {
    const errMsg = (err as Error).message;
    SchedulerService.log(userId, 'ERROR', `❌ Manual test-send failed: ${errMsg}`);
    SchedulerService.addHistory(userId, 0, 'error', message, recipientId, errMsg);
    return res.status(500).json({ success: false, message: errMsg });
  }
});

app.post('/api/zalo/test-poll-vote', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { groupId, pollId, questionFilter, pollOption } = req.body;

  if (!groupId || !pollOption) {
    return res.status(400).json({ success: false, message: 'Group ID and poll option are required' });
  }

  try {
    const historyMessage = `Test vote poll "${pollOption}"${questionFilter ? ` (${questionFilter})` : ''}`;
    SchedulerService.log(userId, 'INFO', `Triggered manual poll vote in group '${groupId}' with option '${pollOption}'`);
    const voteResult = await ZaloService.votePollAttendance(userId, groupId, pollOption, pollId, questionFilter);
    if (voteResult?.skipped === true) {
      SchedulerService.log(userId, 'INFO', `✅ Manual poll vote skipped: option '${pollOption}' was already selected in group '${groupId}'`);
      SchedulerService.addHistory(userId, 0, 'success', `${historyMessage} (already voted)`, groupId);
      return res.json({ success: true, skipped: true, message: 'Poll already voted with the selected option.' });
    }

    SchedulerService.log(userId, 'INFO', `✅ Manual poll vote success in group '${groupId}'`);
    SchedulerService.addHistory(userId, 0, 'success', historyMessage, groupId);
    return res.json({ success: true, message: 'Poll voted successfully!' });
  } catch (err) {
    const errMsg = (err as Error).message;
    SchedulerService.log(userId, 'ERROR', `❌ Manual poll vote failed: ${errMsg}`);
    SchedulerService.addHistory(userId, 0, 'error', `Test vote poll "${pollOption}"`, groupId, errMsg);
    return res.status(500).json({ success: false, message: errMsg });
  }
});

app.get('/api/zalo/friends', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const friends = await ZaloService.getFriends(userId);
    return res.json({ success: true, friends });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.get('/api/zalo/groups', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const groups = await ZaloService.getGroups(userId);
    return res.json({ success: true, groups });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- DOWNLOAD FILE ENDPOINTS ---

app.get('/api/zalo/download/groups', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const groups = await ZaloService.getGroups(userId);
    let content = `Tìm thấy ${groups.length} nhóm:\n\n`;
    content += `${'STT'.padEnd(5)} ${'GROUP ID'.padEnd(25)} TÊN NHÓM\n`;
    content += '-'.repeat(70) + '\n';
    
    groups.forEach((g: any, index: number) => {
      const gid = g.id || g.threadId || g.groupId || '';
      const name = g.name || g.displayName || '???';
      content += `${String(index + 1).padEnd(5)} ${String(gid).padEnd(25)} ${name}\n`;
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="groups.txt"');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ success: false, message: `Không lấy được danh sách nhóm: ${(err as Error).message}` });
  }
});

app.get('/api/zalo/download/friends', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const friends = await ZaloService.getFriends(userId);
    let content = `Tìm thấy ${friends.length} bạn bè:\n\n`;
    content += `${'STT'.padEnd(5)} ${'USER ID'.padEnd(25)} TÊN BẠN BÈ\n`;
    content += '-'.repeat(70) + '\n';

    friends.forEach((f: any, index: number) => {
      const uid = f.uid || f.userId || f.id || '';
      const name = f.name || f.displayName || '';
      content += `${String(index + 1).padEnd(5)} ${String(uid).padEnd(25)} ${name}\n`;
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="friends.txt"');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ success: false, message: `Không lấy được danh sách bạn bè: ${(err as Error).message}` });
  }
});

// --- SYSTEM HISTORY AND LOGS ---

app.get('/api/history', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const history = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId);
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.get('/api/logs', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(userId);
    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- STATUS & METRICS ---

app.get('/api/status', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const user = db.prepare('SELECT imei, encrypted_cookies FROM users WHERE id = ?').get(userId) as any;
    const scheduleCount = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE user_id = ? AND is_active = 1').get(userId) as any;

    return res.json({
      success: true,
      status: {
        credentialsSet: !!(user?.imei && user?.encrypted_cookies),
        activeSchedules: scheduleCount?.count || 0,
        cryptoMode: isUsingNative() ? 'C Native Addon (High Performance)' : 'TypeScript Fallback (Standard)'
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- QR LOGIN ENDPOINTS ---

app.post('/api/zalo/qr/init', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please log in again.' });
    }
    QRManager.startQRLogin(userId);
    return res.json({ success: true, message: 'Zalo QR login flow initialized successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.get('/api/zalo/qr/status', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const session = QRManager.getSession(userId);
    if (!session) {
      return res.json({ success: true, status: 'inactive' });
    }
    return res.json({
      success: true,
      status: session.status,
      qrImage: session.qrImage,
      displayName: session.displayName,
      avatar: session.avatar,
      error: session.error
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/zalo/qr/abort', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    QRManager.abortSession(userId);
    return res.json({ success: true, message: 'QR login process aborted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// --- ADMIN MANAGEMENT ROUTES ---

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.user!.id;
  try {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as any;
    if (user && user.is_admin === 1) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Administrator privileges required.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
}

app.get('/api/admin/users', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = db.prepare(`
      SELECT id, username, imei, timezone, is_admin, created_at, proxy,
             (CASE WHEN encrypted_cookies IS NOT NULL THEN 1 ELSE 0 END) as has_cookies
      FROM users
    `).all();
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { username, password, timezone, is_admin, proxy } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, timezone, is_admin, proxy) VALUES (?, ?, ?, ?, ?)')
      .run(username, passwordHash, timezone || 'Asia/Ho_Chi_Minh', is_admin ? 1 : 0, proxy ? proxy.trim() : null);
    return res.json({ success: true, message: 'User created successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.put('/api/admin/users/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetUserId = parseInt(req.params.id);
  const { password, timezone, is_admin, proxy } = req.body;

  try {
    if (password) {
      const passwordHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, targetUserId);
    }
    if (timezone) {
      db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, targetUserId);
    }
    if (is_admin !== undefined) {
      if (targetUserId === req.user!.id && is_admin === 0) {
        return res.status(400).json({ success: false, message: 'You cannot remove your own admin status.' });
      }
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, targetUserId);
    }
    if (proxy !== undefined) {
      db.prepare('UPDATE users SET proxy = ? WHERE id = ?').run(proxy ? proxy.trim() : null, targetUserId);
      ZaloService.logout(targetUserId); // Reset session cache to apply proxy
    }
    return res.json({ success: true, message: 'User updated successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const targetUserId = parseInt(req.params.id);

  if (targetUserId === req.user!.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  }

  try {
    const schedules = db.prepare('SELECT id FROM schedules WHERE user_id = ?').all(targetUserId) as any[];
    for (const s of schedules) {
      SchedulerService.stopJob(s.id);
    }
    ZaloService.logout(targetUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
    return res.json({ success: true, message: 'User deleted successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.get('/api/admin/schedules', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const schedules = db.prepare(`
      SELECT s.*, u.username
      FROM schedules s
      JOIN users u ON s.user_id = u.id
    `).all();
    return res.json({ success: true, schedules });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// Admin Proxy Pool API Endpoints
app.post('/api/admin/proxies/scan', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await SchedulerService.checkAllProxies();
    return res.json({
      success: true,
      message: `Quét proxy hoàn tất! Đã kiểm tra ${result.total} proxy, vô hiệu hóa ${result.deactivated} proxy chết.`,
      result
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Lỗi quét proxy: ${(err as Error).message}` });
  }
});

app.post('/api/admin/proxies/import', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { proxies } = req.body;
  if (!Array.isArray(proxies) || proxies.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty proxy list' });
  }
  
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO proxies (url, is_active) VALUES (?, 1)');
    
    // Perform batch insert in transaction for maximum performance
    const insertMany = db.transaction((proxyList: string[]) => {
      let count = 0;
      for (const url of proxyList) {
        if (typeof url === 'string' && url.trim()) {
          const result = insert.run(url.trim());
          if (result.changes > 0) count++;
        }
      }
      return count;
    });
    
    const importedCount = insertMany(proxies);
    return res.json({
      success: true,
      message: `Đã nhập thành công ${importedCount} proxy mới vào pool.`,
      importedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.get('/api/admin/proxies', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = (req.query.search as string) || '';

    const conditions: string[] = [];
    const params: any[] = [];

    if (search.trim()) {
      conditions.push('url LIKE ?');
      params.push(`%${search.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query total count
    const countQuery = `SELECT COUNT(*) as total FROM proxies ${whereClause}`;
    const totalResult = db.prepare(countQuery).get(...params) as { total: number };
    const total = totalResult ? totalResult.total : 0;

    // Query paginated data
    const offset = (page - 1) * limit;
    const dataQuery = `SELECT * FROM proxies ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const proxies = db.prepare(dataQuery).all(...params, limit, offset);

    return res.json({
      success: true,
      proxies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.post('/api/admin/proxies', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { url, is_active } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'Proxy URL is required' });
  }
  
  const cleanUrl = url.trim();
  try {
    db.prepare('INSERT INTO proxies (url, is_active) VALUES (?, ?)')
      .run(cleanUrl, is_active !== undefined ? (is_active ? 1 : 0) : 1);
    return res.json({ success: true, message: 'Proxy added successfully to pool!' });
  } catch (err) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ success: false, message: 'Proxy URL already exists in pool' });
    }
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.put('/api/admin/proxies/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const proxyId = parseInt(req.params.id);
  const { url, is_active } = req.body;
  
  try {
    const fields: string[] = [];
    const params: any[] = [];
    
    if (url !== undefined) {
      if (typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ success: false, message: 'Proxy URL cannot be empty' });
      }
      fields.push('url = ?');
      params.push(url.trim());
    }
    
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    
    params.push(proxyId);
    db.prepare(`UPDATE proxies SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return res.json({ success: true, message: 'Proxy updated successfully!' });
  } catch (err) {
    if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ success: false, message: 'Proxy URL already exists in pool' });
    }
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

app.delete('/api/admin/proxies/:id', authenticateToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const proxyId = parseInt(req.params.id);
  try {
    db.prepare('DELETE FROM proxies WHERE id = ?').run(proxyId);
    return res.json({ success: true, message: 'Proxy deleted successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// Redirect route for the dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  SchedulerService.logSystem('INFO', `Server running on http://localhost:${PORT}`);
  
  // Initialize user schedules on startup
  SchedulerService.initSchedules();
  SchedulerService.initProxyChecker();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully...');
  SchedulerService.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down gracefully...');
  SchedulerService.stopAll();
  process.exit(0);
});
