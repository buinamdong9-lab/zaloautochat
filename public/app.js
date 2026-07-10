let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));
let activeTab = 'overview';
let statusPollInterval = null;
let schedulesData = [];
let qrPollInterval = null;
let adminUsersData = [];

// Zalo Contacts for Dropdown Select
let zaloGroups = [];
let zaloFriends = [];
let testRecipientManualMode = false;
let schedRecipientManualMode = false;

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  
  // Auth toggle click
  document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
  
  // Auth Form Submit
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
  
  // Config Form Submit
  document.getElementById('zalo-config-form').addEventListener('submit', handleConfigSubmit);
  
  // Test Send Form Submit
  document.getElementById('test-send-form').addEventListener('submit', handleTestSendSubmit);
  
  // Schedule Form Submit
  document.getElementById('schedule-form').addEventListener('submit', handleScheduleSubmit);

  // User Form Submit (Admin only)
  const userForm = document.getElementById('user-form');
  if (userForm) {
    userForm.addEventListener('submit', handleUserSubmit);
  }

  // Tab navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(e.target.dataset.tab);
    });
  });

  // Toggle dropdown options when recipient type changes
  const testRecipType = document.getElementById('test-recipient-type');
  if (testRecipType) {
    testRecipType.addEventListener('change', updateRecipientDropdowns);
  }
  const schedRecipType = document.getElementById('sched-recipient-type');
  if (schedRecipType) {
    schedRecipType.addEventListener('change', updateRecipientDropdowns);
  }

  // Logout click
  document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
});

// Toast Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3300);
}

// Authenticated Download File Helper
function downloadFile(endpoint, filename) {
  if (!token) {
    showToast('Yêu cầu đăng nhập để tải xuống!', 'error');
    return;
  }
  const downloadUrl = `${endpoint}?token=${encodeURIComponent(token)}`;
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast(`Đang tải xuống ${filename}...`);
}

// Authentication handling
function checkAuth() {
  const authContainer = document.getElementById('auth-container');
  const dashContainer = document.getElementById('dashboard-container');
  
  if (token) {
    authContainer.classList.add('hidden');
    dashContainer.classList.remove('hidden');
    document.getElementById('current-user-name').textContent = user ? user.username : 'User';
    
    // Check role to display Admin Panel
    const navAdmin = document.getElementById('nav-admin');
    if (user && user.is_admin === 1) {
      navAdmin.classList.remove('hidden');
    } else {
      navAdmin.classList.add('hidden');
    }

    // Load Zalo groups/friends list in background
    loadZaloContacts();

    // Switch to last active tab or overview
    switchTab(activeTab);
    
    // Start Polling system status
    startPolling();
  } else {
    authContainer.classList.remove('hidden');
    dashContainer.classList.add('hidden');
    stopPolling();
  }
}

let isRegisterMode = false;
function toggleAuthMode(e) {
  e.preventDefault();
  isRegisterMode = !isRegisterMode;
  
  const title = document.querySelector('.auth-header h1');
  const subtitle = document.getElementById('auth-subtitle');
  const submitText = document.querySelector('#auth-submit-btn .btn-text');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  
  if (isRegisterMode) {
    title.textContent = 'Đăng ký tài khoản';
    subtitle.textContent = 'Tạo tài khoản mới để bắt đầu sử dụng';
    submitText.textContent = 'Đăng ký';
    toggleText.textContent = 'Đã có tài khoản?';
    toggleBtn.textContent = 'Đăng nhập ngay';
  } else {
    title.textContent = 'Zalo Auto Messenger';
    subtitle.textContent = 'Đăng nhập để quản lý lịch gửi tin tự động';
    submitText.textContent = 'Đăng nhập';
    toggleText.textContent = 'Chưa có tài khoản?';
    toggleBtn.textContent = 'Đăng ký ngay';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Authentication failed');

    if (isRegisterMode) {
      showToast('Đăng ký thành công! Hãy đăng nhập.');
      isRegisterMode = false;
      toggleAuthMode({ preventDefault: () => {} });
    } else {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      token = data.token;
      user = data.user;
      showToast('Đăng nhập thành công!');
      checkAuth();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  token = null;
  user = null;
  showToast('Đã đăng xuất.');
  checkAuth();
}

// Tab View Control
function switchTab(tabId) {
  activeTab = tabId;
  
  // Update sidebar active state
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    if (item.dataset.tab === tabId) item.classList.add('active');
    else item.classList.remove('active');
  });

  // Show corresponding tab pane
  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === `tab-${tabId}`) pane.classList.add('active');
    else pane.classList.remove('active');
  });

  // Update Header Title
  const titles = {
    overview: 'Tổng quan hệ thống',
    config: 'Cấu hình kết nối Zalo Web',
    schedules: 'Quản lý lịch gửi tin tự động',
    history: 'Lịch sử hoạt động',
    logs: 'Console Logs',
    admin: 'Quản trị hệ thống'
  };
  document.getElementById('tab-title').textContent = titles[tabId] || 'Dashboard';

  // Load data for specific tabs
  if (tabId === 'overview') {
    fetchStatus();
    fetchHistory(5); // Only fetch top 5 for overview
  } else if (tabId === 'config') {
    fetchConfig();
  } else if (tabId === 'schedules') {
    fetchSchedules();
  } else if (tabId === 'history') {
    fetchHistory();
  } else if (tabId === 'logs') {
    fetchLogs();
  } else if (tabId === 'admin') {
    fetchAdminUsers();
    fetchAdminSchedules();
  }
  
  // Reload contacts on relevant tabs
  if (tabId === 'config' || tabId === 'schedules') {
    loadZaloContacts();
  }
}

// Polling Helper
function startPolling() {
  if (statusPollInterval) clearInterval(statusPollInterval);
  fetchStatus();
  statusPollInterval = setInterval(() => {
    fetchStatus();
    if (activeTab === 'logs') fetchLogs();
  }, 10000); // Poll every 10s
}

function stopPolling() {
  if (statusPollInterval) clearInterval(statusPollInterval);
  statusPollInterval = null;
}

// --- API ACTIONS ---

async function fetchStatus() {
  if (!token) return;
  try {
    const res = await fetch('/api/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    // Update Overview items
    const zaloBadge = document.getElementById('metric-zalo-status');
    const statusText = document.getElementById('connection-status-text');
    
    if (data.status.credentialsSet) {
      zaloBadge.textContent = 'Đã kết nối';
      zaloBadge.className = 'status-badge status-success';
      statusText.textContent = 'Zalo Sẵn sàng';
    } else {
      zaloBadge.textContent = 'Chưa thiết lập';
      zaloBadge.className = 'status-badge status-error';
      statusText.textContent = 'Cần cấu hình Zalo';
    }
    
    document.getElementById('metric-active-schedules').textContent = data.status.activeSchedules;
    document.getElementById('metric-crypto-mode').textContent = data.status.cryptoMode;
    
  } catch (err) {
    console.error('Failed to fetch status');
  }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/user/config', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('zalo-imei').value = data.config.imei || '';
      document.getElementById('zalo-timezone').value = data.config.timezone || 'Asia/Ho_Chi_Minh';
      
      // If cookies set, display placeholder
      if (data.config.cookiesSet) {
        document.getElementById('zalo-cookies').placeholder = '[Đã cấu hình cookie ẩn. Dán cookie mới vào đây nếu muốn cập nhật]';
        document.getElementById('zalo-cookies').value = '';
        document.getElementById('zalo-cookies').required = false;
      } else {
        document.getElementById('zalo-cookies').placeholder = 'zpw_sek=xxx; zpsid=xxx; __zi=xxx...';
        document.getElementById('zalo-cookies').required = true;
      }
    }
  } catch (err) {
    showToast('Không tải được cấu hình!', 'error');
  }
}

async function handleConfigSubmit(e) {
  e.preventDefault();
  const imei = document.getElementById('zalo-imei').value.trim();
  const cookies = document.getElementById('zalo-cookies').value.trim();
  const timezone = document.getElementById('zalo-timezone').value;

  try {
    const res = await fetch('/api/user/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ imei, cookies, timezone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    
    showToast('Cấu hình lưu thành công!');
    fetchConfig();
    fetchStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleTestSendSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('test-send-btn');
  const recipientId = testRecipientManualMode
    ? document.getElementById('test-recipient-id-manual').value.trim()
    : document.getElementById('test-recipient-select').value;
  const recipientType = document.getElementById('test-recipient-type').value;
  const message = document.getElementById('test-message').value.trim();

  if (!recipientId) {
    showToast('Vui lòng chọn hoặc nhập ID người nhận!', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi thử...';
  
  try {
    const res = await fetch('/api/zalo/test-send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ recipientId, recipientType, message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi gửi tin');
    
    showToast('Gửi thử thành công!');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gửi thử ngay';
  }
}

async function fetchSchedules() {
  try {
    const res = await fetch('/api/schedules', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      schedulesData = data.schedules;
      renderSchedules();
    }
  } catch (err) {
    showToast('Lỗi tải danh sách lịch!', 'error');
  }
}

function renderSchedules() {
  const container = document.getElementById('schedules-list-container');
  if (schedulesData.length === 0) {
    container.innerHTML = `<p class="placeholder-text">Chưa cấu hình lịch trình gửi tin nào. Hãy nhấn "Tạo lịch mới" ở trên!</p>`;
    return;
  }

  container.innerHTML = schedulesData.map(s => {
    const daysArr = s.send_days.split(',');
    const daysLabel = daysArr.map(d => {
      const map = { mon: 'T2', tue: 'T3', wed: 'T4', thu: 'T5', fri: 'T6', sat: 'T7', sun: 'CN' };
      return map[d.trim().toLowerCase()] || d;
    }).join(', ');

    return `
      <div class="schedule-card glass">
        <div class="schedule-card-header">
          <div>
            <span class="schedule-time">${String(s.send_hour).padStart(2, '0')}:${String(s.send_minute).padStart(2, '0')}</span>
            <span class="schedule-days-badge">${daysLabel}</span>
          </div>
          <label class="switch">
            <input type="checkbox" ${s.is_active === 1 ? 'checked' : ''} onchange="toggleScheduleActive(${s.id}, this.checked)">
            <span class="slider"></span>
          </label>
        </div>
        <div class="schedule-msg">${escapeHtml(s.message_content)}</div>
        <div class="schedule-meta">
          <span><i class="fa-solid fa-paper-plane"></i> Gửi đến: <strong>${s.recipient_type}</strong></span>
          <span><i class="fa-solid fa-id-badge"></i> ID: <code>${s.recipient_id}</code></span>
          ${s.start_date ? `<span><i class="fa-solid fa-calendar-plus"></i> Từ ngày: ${s.start_date}</span>` : ''}
          ${s.end_date ? `<span><i class="fa-solid fa-calendar-minus"></i> Đến ngày: ${s.end_date}</span>` : ''}
        </div>
        <div class="schedule-actions">
          <div class="schedule-btns">
            <button class="btn btn-secondary btn-sm" onclick="openEditScheduleModal(${s.id})">
              <i class="fa-solid fa-pen-to-square"></i> Sửa
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteSchedule(${s.id})">
              <i class="fa-solid fa-trash"></i> Xóa
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleScheduleActive(id, isActive) {
  try {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ is_active: isActive ? 1 : 0 })
    });
    if (!res.ok) throw new Error();
    showToast(`Đã ${isActive ? 'bật' : 'tắt'} lịch trình thành công!`);
    fetchStatus();
  } catch (err) {
    showToast('Lỗi thay đổi trạng thái lịch trình!', 'error');
    fetchSchedules(); // reload state
  }
}

async function deleteSchedule(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa lịch trình này?')) return;
  try {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    showToast('Đã xóa lịch trình thành công!');
    fetchSchedules();
    fetchStatus();
  } catch (err) {
    showToast('Lỗi xóa lịch trình!', 'error');
  }
}

// Modal handling
function openAddScheduleModal() {
  document.getElementById('modal-title').textContent = 'Tạo lịch gửi tin mới';
  document.getElementById('schedule-id').value = '';
  document.getElementById('sched-message').value = '';
  document.getElementById('sched-hour').value = 7;
  document.getElementById('sched-minute').value = 0;
  document.getElementById('sched-recipient-type').value = 'GROUP';
  
  // Reset recipient mode to select
  schedRecipientManualMode = false;
  const select = document.getElementById('sched-recipient-select');
  const manual = document.getElementById('sched-recipient-id-manual');
  const btn = document.getElementById('btn-toggle-sched-recipient');
  select.classList.remove('hidden');
  manual.classList.add('hidden');
  manual.value = '';
  btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
  
  // Populate dropdown based on type
  updateRecipientDropdowns();

  document.getElementById('sched-start-date').value = '';
  document.getElementById('sched-end-date').value = '';
  
  // check weekdays by default
  document.querySelectorAll('input[name="sched-days"]').forEach(box => {
    box.checked = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(box.value);
  });
  
  document.getElementById('schedule-modal').classList.remove('hidden');
}

function openEditScheduleModal(id) {
  const s = schedulesData.find(item => item.id === id);
  if (!s) return;

  document.getElementById('modal-title').textContent = 'Chỉnh sửa lịch gửi tin';
  document.getElementById('schedule-id').value = s.id;
  document.getElementById('sched-message').value = s.message_content;
  document.getElementById('sched-hour').value = s.send_hour;
  document.getElementById('sched-minute').value = s.send_minute;
  document.getElementById('sched-recipient-type').value = s.recipient_type;
  
  // Update dropdown options
  updateRecipientDropdowns();
  
  const select = document.getElementById('sched-recipient-select');
  const manual = document.getElementById('sched-recipient-id-manual');
  const btn = document.getElementById('btn-toggle-sched-recipient');
  
  // Find option in select
  let found = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === s.recipient_id) {
      select.selectedIndex = i;
      found = true;
      break;
    }
  }
  
  if (found) {
    schedRecipientManualMode = false;
    select.classList.remove('hidden');
    manual.classList.add('hidden');
    manual.value = '';
    btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
  } else {
    schedRecipientManualMode = true;
    select.classList.add('hidden');
    manual.classList.remove('hidden');
    manual.value = s.recipient_id;
    btn.innerHTML = '<i class="fa-solid fa-list"></i> Chọn sẵn';
  }

  document.getElementById('sched-start-date').value = s.start_date || '';
  document.getElementById('sched-end-date').value = s.end_date || '';

  const activeDays = s.send_days.split(',').map(d => d.trim().toLowerCase());
  document.querySelectorAll('input[name="sched-days"]').forEach(box => {
    box.checked = activeDays.includes(box.value);
  });

  document.getElementById('schedule-modal').classList.remove('hidden');
}

function closeScheduleModal() {
  document.getElementById('schedule-modal').classList.add('hidden');
}

async function handleScheduleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('schedule-id').value;
  const message_content = document.getElementById('sched-message').value.trim();
  const send_hour = parseInt(document.getElementById('sched-hour').value);
  const send_minute = parseInt(document.getElementById('sched-minute').value);
  const recipient_type = document.getElementById('sched-recipient-type').value;
  const recipient_id = schedRecipientManualMode
    ? document.getElementById('sched-recipient-id-manual').value.trim()
    : document.getElementById('sched-recipient-select').value;
  const start_date = document.getElementById('sched-start-date').value;
  const end_date = document.getElementById('sched-end-date').value;

  if (!recipient_id) {
    showToast('Vui lòng chọn hoặc nhập ID người nhận!', 'error');
    return;
  }

  const selectedDays = [];
  document.querySelectorAll('input[name="sched-days"]:checked').forEach(box => {
    selectedDays.push(box.value);
  });

  if (selectedDays.length === 0) {
    showToast('Vui lòng chọn ít nhất một ngày trong tuần!', 'error');
    return;
  }
  
  const send_days = selectedDays.join(',');

  const payload = {
    message_content, send_hour, send_minute, send_days, start_date, end_date, recipient_type, recipient_id
  };

  const method = id ? 'PUT' : 'POST';
  const endpoint = id ? `/api/schedules/${id}` : '/api/schedules';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi lưu lịch');

    showToast('Lịch gửi tin đã lưu!');
    closeScheduleModal();
    fetchSchedules();
    fetchStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Fetch History logs
async function fetchHistory(limit = 0) {
  try {
    const res = await fetch('/api/history', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const history = limit > 0 ? data.history.slice(0, limit) : data.history;
      
      if (limit > 0) {
        // Overview recent logs
        const container = document.getElementById('recent-history-container');
        if (history.length === 0) {
          container.innerHTML = '<p class="placeholder-text">Chưa có hoạt động gửi tin nào gần đây.</p>';
          return;
        }
        
        container.innerHTML = history.map(h => `
          <div class="user-badge" style="background:transparent;border:none;margin-bottom:8px;padding:0">
            <span>[${h.time}] Gửi đến <code>${h.recipient_id}</code>: 
              <span class="status-badge ${h.status === 'success' ? 'status-success' : 'status-error'}" style="padding: 1px 6px">${h.status}</span>
            </span>
          </div>
        `).join('');
      } else {
        // Full history table
        const tbody = document.getElementById('history-table-body');
        if (history.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center placeholder-text">Chưa có lịch sử hoạt động nào.</td></tr>`;
          return;
        }

        tbody.innerHTML = history.map(h => `
          <tr>
            <td>${h.time}</td>
            <td><strong>${h.recipient_id}</strong></td>
            <td>${escapeHtml(h.message_content)}</td>
            <td><span class="status-badge ${h.status === 'success' ? 'status-success' : 'status-error'}">${h.status}</span></td>
            <td class="history-err-text">${h.error_message ? escapeHtml(h.error_message) : '-'}</td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    showToast('Không tải được lịch sử gửi tin!', 'error');
  }
}

// Fetch logs
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const consoleEl = document.getElementById('log-console');
      if (data.logs.length === 0) {
        consoleEl.innerHTML = '<div class="log-line info">Chưa ghi nhận hoạt động log nào...</div>';
        return;
      }

      consoleEl.innerHTML = data.logs.map(l => {
        const lowerLvl = l.level.toLowerCase();
        return `<div class="log-line ${lowerLvl}">[${l.time}] [${l.level}] ${escapeHtml(l.message)}</div>`;
      }).join('');
      
      // Auto scroll console to bottom
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  } catch (err) {
    console.error('Failed to load system logs');
  }
}

// Utilities
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- QR CODE LOGIN LOGIC ---

async function openQRLoginModal() {
  document.getElementById('qr-loading').classList.remove('hidden');
  document.getElementById('qr-image').classList.add('hidden');
  document.getElementById('qr-overlay').classList.add('hidden');
  document.getElementById('qr-status-desc').textContent = 'Đang khởi tạo mã QR đăng nhập Zalo...';
  document.getElementById('qr-modal').classList.remove('hidden');

  try {
    const res = await fetch('/api/zalo/qr/init', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    
    // Start Polling QR code state
    if (qrPollInterval) clearInterval(qrPollInterval);
    qrPollInterval = setInterval(pollQRStatus, 2000);
  } catch (err) {
    showToast('Lỗi khởi tạo QR code!', 'error');
    closeQRLoginModal();
  }
}

async function closeQRLoginModal() {
  document.getElementById('qr-modal').classList.add('hidden');
  if (qrPollInterval) {
    clearInterval(qrPollInterval);
    qrPollInterval = null;
  }
  try {
    await fetch('/api/zalo/qr/abort', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Failed to abort QR login session');
  }
}

async function pollQRStatus() {
  if (!token) return;
  try {
    const res = await fetch('/api/zalo/qr/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const qrLoading = document.getElementById('qr-loading');
    const qrImage = document.getElementById('qr-image');
    const qrOverlay = document.getElementById('qr-overlay');
    const qrOverlayContent = document.getElementById('qr-overlay-content');
    const statusDesc = document.getElementById('qr-status-desc');

    if (data.status === 'generated' && data.qrImage) {
      qrLoading.classList.add('hidden');
      qrImage.classList.remove('hidden');
      qrOverlay.classList.add('hidden');
      
      let imgSrc = data.qrImage;
      if (!imgSrc.startsWith('data:')) {
        imgSrc = 'data:image/png;base64,' + imgSrc;
      }
      qrImage.src = imgSrc;
      statusDesc.textContent = 'Mở ứng dụng Zalo trên điện thoại quét mã QR để đăng nhập.';
    } else if (data.status === 'scanned') {
      qrLoading.classList.add('hidden');
      qrImage.classList.add('hidden');
      qrOverlay.classList.remove('hidden');
      qrOverlayContent.innerHTML = `
        <img src="${data.avatar || 'https://chat.zalo.me/images/avatar-default.png'}" class="qr-avatar" />
        <h4 style="margin-bottom:6px">${escapeHtml(data.displayName || 'Tài khoản Zalo')}</h4>
        <p style="font-size:12px;color:var(--text-secondary)">Đã quét mã! Vui lòng xác nhận đăng nhập trên điện thoại của bạn.</p>
      `;
      statusDesc.textContent = 'Chờ xác nhận từ ứng dụng Zalo trên điện thoại...';
    } else if (data.status === 'success') {
      qrLoading.classList.add('hidden');
      qrImage.classList.add('hidden');
      qrOverlay.classList.remove('hidden');
      qrOverlayContent.innerHTML = `
        <div style="font-size:32px;color:var(--emerald);margin-bottom:12px"><i class="fa-solid fa-circle-check"></i></div>
        <h4>Đăng nhập thành công!</h4>
      `;
      statusDesc.textContent = 'Đang đồng bộ phiên làm việc Zalo...';
      
      // Stop polling
      if (qrPollInterval) {
        clearInterval(qrPollInterval);
        qrPollInterval = null;
      }
      showToast('Đăng nhập Zalo tự động thành công!');
      
      setTimeout(() => {
        closeQRLoginModal();
        fetchConfig();
        fetchStatus();
      }, 1500);
    } else if (data.status === 'expired') {
      qrOverlay.classList.remove('hidden');
      qrOverlayContent.innerHTML = `
        <div style="font-size:32px;color:var(--rose);margin-bottom:12px"><i class="fa-solid fa-clock"></i></div>
        <h4>Mã QR đã hết hạn</h4>
        <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openQRLoginModal()">Thử lại</button>
      `;
      if (qrPollInterval) clearInterval(qrPollInterval);
    } else if (data.status === 'declined' || data.status === 'error') {
      qrOverlay.classList.remove('hidden');
      qrOverlayContent.innerHTML = `
        <div style="font-size:32px;color:var(--rose);margin-bottom:12px"><i class="fa-solid fa-circle-xmark"></i></div>
        <h4>Đăng nhập bị từ chối</h4>
        <p style="font-size:12px;color:var(--text-secondary);margin-top:6px">${escapeHtml(data.error || 'Vui lòng quét lại.')}</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openQRLoginModal()">Thử lại</button>
      `;
      if (qrPollInterval) clearInterval(qrPollInterval);
    }
  } catch (err) {
    console.error('Failed to poll QR status:', err);
  }
}

// --- ADMIN MANAGEMENT LOGIC ---

async function fetchAdminUsers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      adminUsersData = data.users;
      renderAdminUsers();
    }
  } catch (err) {
    showToast('Lỗi tải danh sách người dùng!', 'error');
  }
}

function renderAdminUsers() {
  const tbody = document.getElementById('admin-users-table-body');
  if (adminUsersData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center placeholder-text">Không có người dùng nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminUsersData.map(u => `
    <tr>
      <td>${u.id}</td>
      <td><strong>${escapeHtml(u.username)}</strong></td>
      <td><span class="badge-role ${u.is_admin === 1 ? 'badge-role-admin' : 'badge-role-user'}">${u.is_admin === 1 ? 'Admin' : 'User'}</span></td>
      <td><code>${u.imei ? escapeHtml(u.imei) : '-'}</code></td>
      <td><span class="status-badge ${u.has_cookies === 1 ? 'status-success' : 'status-error'}">${u.has_cookies === 1 ? 'Đã cài' : 'Chưa cài'}</span></td>
      <td><code>${u.proxy ? escapeHtml(u.proxy) : '-'}</code></td>
      <td>${escapeHtml(u.timezone)}</td>
      <td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
      <td>
        <div class="schedule-btns">
          <button class="btn btn-secondary btn-sm" onclick="openEditUserModal(${u.id})"><i class="fa-solid fa-user-pen"></i> Sửa</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})"><i class="fa-solid fa-user-minus"></i> Xóa</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function fetchAdminSchedules() {
  try {
    const res = await fetch('/api/admin/schedules', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      const tbody = document.getElementById('admin-schedules-table-body');
      const schedules = data.schedules;
      if (schedules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center placeholder-text">Không có lịch gửi tin nào trong hệ thống.</td></tr>`;
        return;
      }

      tbody.innerHTML = schedules.map(s => {
        const daysArr = s.send_days.split(',');
        const daysLabel = daysArr.map(d => {
          const map = { mon: 'T2', tue: 'T3', wed: 'T4', thu: 'T5', fri: 'T6', sat: 'T7', sun: 'CN' };
          return map[d.trim().toLowerCase()] || d;
        }).join(', ');

        return `
          <tr>
            <td>${s.id}</td>
            <td><strong style="color:var(--cyan)">${escapeHtml(s.username)}</strong></td>
            <td><strong>${String(s.send_hour).padStart(2, '0')}:${String(s.send_minute).padStart(2, '0')}</strong></td>
            <td><span class="schedule-days-badge">${daysLabel}</span></td>
            <td><code>${s.recipient_id}</code> (${s.recipient_type})</td>
            <td>${escapeHtml(s.message_content)}</td>
            <td><span class="status-badge ${s.is_active === 1 ? 'status-success' : 'status-error'}">${s.is_active === 1 ? 'Hoạt động' : 'Tắt'}</span></td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    showToast('Lỗi tải danh sách lịch gửi tin hệ thống!', 'error');
  }
}

function openAddUserModal() {
  document.getElementById('user-modal-title').textContent = 'Tạo tài khoản người dùng mới';
  document.getElementById('admin-user-id').value = '';
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-username').disabled = false;
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-password').required = true;
  document.getElementById('admin-password-help').classList.add('hidden');
  document.getElementById('admin-user-timezone').value = 'Asia/Ho_Chi_Minh';
  document.getElementById('admin-user-proxy').value = '';
  document.getElementById('admin-is-admin').checked = false;
  document.getElementById('user-modal').classList.remove('hidden');
}

function openEditUserModal(id) {
  const u = adminUsersData.find(item => item.id === id);
  if (!u) return;

  document.getElementById('user-modal-title').textContent = 'Chỉnh sửa tài khoản người dùng';
  document.getElementById('admin-user-id').value = u.id;
  document.getElementById('admin-username').value = u.username;
  document.getElementById('admin-username').disabled = true; // Cannot edit username
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-password').required = false;
  document.getElementById('admin-password-help').classList.remove('hidden');
  document.getElementById('admin-user-timezone').value = u.timezone || 'Asia/Ho_Chi_Minh';
  document.getElementById('admin-user-proxy').value = u.proxy || '';
  document.getElementById('admin-is-admin').checked = u.is_admin === 1;
  document.getElementById('user-modal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.add('hidden');
}

async function handleUserSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('admin-user-id').value;
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  const timezone = document.getElementById('admin-user-timezone').value;
  const proxy = document.getElementById('admin-user-proxy').value.trim();
  const is_admin = document.getElementById('admin-is-admin').checked;

  const payload = { timezone, is_admin, proxy };
  if (password) payload.password = password;
  if (!id) payload.username = username; // Only send username on create

  const method = id ? 'PUT' : 'POST';
  const endpoint = id ? `/api/admin/users/${id}` : '/api/admin/users';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi lưu thông tin');

    showToast('Đã lưu thông tin người dùng!');
    closeUserModal();
    fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(id) {
  if (id === user.id) {
    showToast('Bạn không thể tự xóa tài khoản của chính mình!', 'error');
    return;
  }
  if (!confirm('Bạn có chắc chắn muốn xóa tài khoản người dùng này? Toàn bộ cấu hình Zalo và lịch trình gửi của họ cũng sẽ bị xóa.')) return;

  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    showToast('Đã xóa tài khoản thành công!');
    fetchAdminUsers();
    fetchAdminSchedules();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- RECIPIENT SELECT FILLERS ---

async function loadZaloContacts() {
  if (!token) return;
  try {
    // Load groups list
    const groupsRes = await fetch('/api/zalo/groups', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (groupsRes.ok) {
      const groupsData = await groupsRes.json();
      if (groupsData.success) {
        zaloGroups = groupsData.groups || [];
      }
    }

    // Load friends list
    const friendsRes = await fetch('/api/zalo/friends', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (friendsRes.ok) {
      const friendsData = await friendsRes.json();
      if (friendsData.success) {
        zaloFriends = friendsData.friends || [];
      }
    }

    // Populate UI dropdown selects
    updateRecipientDropdowns();
  } catch (err) {
    console.error('Failed to load Zalo contacts:', err);
  }
}

function updateRecipientDropdowns() {
  // Config quick test send dropdown
  const testTypeSelect = document.getElementById('test-recipient-type');
  const testSelect = document.getElementById('test-recipient-select');
  if (testTypeSelect && testSelect) {
    const testType = testTypeSelect.value;
    populateSelectWithOptions(testSelect, testType === 'GROUP' ? zaloGroups : zaloFriends, testType);
  }

  // Schedule modal dropdown
  const schedTypeSelect = document.getElementById('sched-recipient-type');
  const schedSelect = document.getElementById('sched-recipient-select');
  if (schedTypeSelect && schedSelect) {
    const schedType = schedTypeSelect.value;
    populateSelectWithOptions(schedSelect, schedType === 'GROUP' ? zaloGroups : zaloFriends, schedType);
  }
}

function populateSelectWithOptions(selectEl, list, type) {
  if (!selectEl) return;
  if (list.length === 0) {
    selectEl.innerHTML = `<option value="">-- Không có danh sách ${type === 'GROUP' ? 'Nhóm' : 'Bạn bè'} (Vui lòng thiết lập Zalo) --</option>`;
    return;
  }
  selectEl.innerHTML = list.map(item => `
    <option value="${item.id}">${escapeHtml(item.name)}</option>
  `).join('');
}

function toggleTestRecipientMode() {
  testRecipientManualMode = !testRecipientManualMode;
  const select = document.getElementById('test-recipient-select');
  const manual = document.getElementById('test-recipient-id-manual');
  const btn = document.getElementById('btn-toggle-test-recipient');

  if (testRecipientManualMode) {
    select.classList.add('hidden');
    manual.classList.remove('hidden');
    btn.innerHTML = '<i class="fa-solid fa-list"></i> Chọn sẵn';
    manual.required = true;
  } else {
    select.classList.remove('hidden');
    manual.classList.add('hidden');
    btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
    manual.required = false;
  }
}

function toggleSchedRecipientMode() {
  schedRecipientManualMode = !schedRecipientManualMode;
  const select = document.getElementById('sched-recipient-select');
  const manual = document.getElementById('sched-recipient-id-manual');
  const btn = document.getElementById('btn-toggle-sched-recipient');

  if (schedRecipientManualMode) {
    select.classList.add('hidden');
    manual.classList.remove('hidden');
    btn.innerHTML = '<i class="fa-solid fa-list"></i> Chọn sẵn';
    manual.required = true;
  } else {
    select.classList.remove('hidden');
    manual.classList.add('hidden');
    btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
    manual.required = false;
  }
}
