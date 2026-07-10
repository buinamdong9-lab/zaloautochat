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
  const { message_content, send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id } = req.body;

  if (!message_content || send_hour === undefined || send_minute === undefined || !send_days || !recipient_id) {
    return res.status(400).json({ success: false, message: 'Missing required schedule fields' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO schedules (user_id, message_content, send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(userId, message_content, send_hour, send_minute, send_days, start_date || null, end_date || null, recipient_type || 'GROUP', recipient_id);

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
  const { message_content, send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id, is_active } = req.body;

  try {
    // Check ownership
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(scheduleId, userId) as any;
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    db.prepare(`
      UPDATE schedules
      SET message_content = COALESCE(?, message_content),
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
      send_hour,
      send_minute,
      send_days,
      start_date || null,
      end_date || null,
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

// Redirect route for the dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  
  // Initialize user schedules on startup
  SchedulerService.initSchedules();
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
