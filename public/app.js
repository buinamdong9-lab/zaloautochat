/**
 * -----------------------------------------------------------------------------
 * ZALO AUTO MESSENGER - AUTOMATIC MESSAGE SENDER FOR ZALO CHAT GROUPS
 * -----------------------------------------------------------------------------
 * @version 2.5.0
 * @author Dong Bui
 * @copyright (c) 2026 Dong Bui. All rights reserved.
 * @contact Hotline/Zalo: 09xx.xxx.xxx | Email: contact@dongbui.com
 * @license Proprietary - Closed Source
 * -----------------------------------------------------------------------------
 */

// Beautiful Console Copyright Banner
console.log(
  '%c🤖 ZALO AUTO MESSENGER v2.5.0 %c\n\n' +
  '%c© 2026 Bản quyền thuộc về Đông Bùi. All Rights Reserved.%c\n' +
  '%cMọi hành vi sao chép, chỉnh sửa trái phép đều vi phạm bản quyền.%c\n\n' +
  '%c📞 Hotline/Zalo liên hệ: %c0779356619%c\n' +
  '%c✉️ Email hỗ trợ: %cbuinamdong9@gmail.com%c\n\n' +
  '%c🔒 Bảo mật: AES-256 Encrypted | SSL Secure | ISO 27001 Certified%c',
  'color: #ffffff; background: #8b5cf6; font-size: 16px; font-weight: bold; padding: 4px 8px; border-radius: 4px; border: 2px solid #0f0f1b;', '',
  'color: #0f0f1b; font-weight: bold; font-size: 13px;', '',
  'color: #ef4444; font-weight: 500; font-size: 12px; font-style: italic;', '',
  'color: #0f0f1b; font-weight: bold; font-size: 12px;', 'color: #7c3aed; font-weight: 800; font-size: 12px; text-decoration: underline;', '',
  'color: #0f0f1b; font-weight: bold; font-size: 12px;', 'color: #06b6d4; font-weight: 800; font-size: 12px;', '',
  'color: #10b981; font-weight: bold; font-size: 11px; background: #ffffff; padding: 2px 6px; border-radius: 4px; border: 2px solid #0f0f1b; box-shadow: 2px 2px 0px #0f0f1b;', ''
);

let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));
let activeTab = 'overview';
let statusPollInterval = null;
let schedulesData = [];
let qrPollInterval = null;
let adminUsersData = [];
let adminProxiesData = [];
let adminProxiesPage = 1;
let adminProxiesLimit = 50;
let adminProxiesSearch = '';
let adminProxiesTotalPages = 1;

// Zalo Contacts for Dropdown Select
let zaloGroups = [];
let zaloFriends = [];
let testRecipientManualMode = false;
let schedRecipientManualMode = false;

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Auth toggle click (removed signup)

  // Watch Terms Checkbox to hide warning immediately on check
  const agreeTermsCheckbox = document.getElementById('agree-terms');
  if (agreeTermsCheckbox) {
    agreeTermsCheckbox.addEventListener('change', () => {
      const warningEl = document.getElementById('terms-warning');
      if (warningEl) {
        if (agreeTermsCheckbox.checked) {
          warningEl.classList.add('hidden');
        } else {
          warningEl.classList.remove('hidden');
        }
      }
    });
  }

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

  // Proxy Form Submit (Admin only)
  const proxyForm = document.getElementById('proxy-form');
  if (proxyForm) {
    proxyForm.addEventListener('submit', handleProxySubmit);
  }

  // Tab navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(e.currentTarget.dataset.tab);
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

  // Initialize Searchable Dropdowns
  initializeSearchableSelect('sched-recipient-select', 'Gõ để tìm nhóm/bạn bè...');
  initializeSearchableSelect('test-recipient-select', 'Gõ để tìm nhóm/bạn bè...');
  initializeSearchableSelect('admin-user-proxy-select', 'Gõ để tìm proxy...');

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

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const agreeTerms = document.getElementById('agree-terms');
  const warningEl = document.getElementById('terms-warning');
  if (agreeTerms && !agreeTerms.checked) {
    if (warningEl) warningEl.classList.remove('hidden');
    showToast('Vui lòng đồng ý với Điều khoản dịch vụ và Chính sách bảo mật!', 'error');
    return;
  }
  if (warningEl) warningEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Đăng nhập thất bại');

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    token = data.token;
    user = data.user;
    showToast('Đăng nhập thành công!');
    checkAuth();
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
    fetchAdminProxies();
  }

  // Reload contacts on relevant tabs
  if (tabId === 'config' || tabId === 'schedules') {
    loadZaloContacts();
  }

  // Auto-close mobile sidebar when switching tabs
  closeMobileSidebar();
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
  const wrapper = document.getElementById('sched-recipient-select-searchable-wrapper');
  select.classList.remove('hidden');
  if (wrapper) wrapper.classList.remove('hidden');
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
  const wrapper = document.getElementById('sched-recipient-select-searchable-wrapper');

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
    if (wrapper) wrapper.classList.remove('hidden');
    manual.classList.add('hidden');
    manual.value = '';
    btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
  } else {
    schedRecipientManualMode = true;
    select.classList.add('hidden');
    if (wrapper) wrapper.classList.add('hidden');
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
  populateUserProxySelect('');
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
  populateUserProxySelect(u.proxy || '');
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
  } else {
    selectEl.innerHTML = list.map(item => `
      <option value="${item.id}">${escapeHtml(item.name)}</option>
    `).join('');
  }

  if (selectEl.dataset.searchableInitialized === 'true') {
    syncSearchableSelect(selectEl.id);
  }
}

function toggleTestRecipientMode() {
  testRecipientManualMode = !testRecipientManualMode;
  const select = document.getElementById('test-recipient-select');
  const manual = document.getElementById('test-recipient-id-manual');
  const btn = document.getElementById('btn-toggle-test-recipient');
  const wrapper = document.getElementById('test-recipient-select-searchable-wrapper');

  if (testRecipientManualMode) {
    select.classList.add('hidden');
    if (wrapper) wrapper.classList.add('hidden');
    manual.classList.remove('hidden');
    btn.innerHTML = '<i class="fa-solid fa-list"></i> Chọn sẵn';
    manual.required = true;
  } else {
    if (wrapper) {
      wrapper.classList.remove('hidden');
    } else {
      select.classList.remove('hidden');
    }
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
  const wrapper = document.getElementById('sched-recipient-select-searchable-wrapper');

  if (schedRecipientManualMode) {
    select.classList.add('hidden');
    if (wrapper) wrapper.classList.add('hidden');
    manual.classList.remove('hidden');
    btn.innerHTML = '<i class="fa-solid fa-list"></i> Chọn sẵn';
    manual.required = true;
  } else {
    if (wrapper) {
      wrapper.classList.remove('hidden');
    } else {
      select.classList.remove('hidden');
    }
    manual.classList.add('hidden');
    btn.innerHTML = '<i class="fa-solid fa-keyboard"></i> Nhập tay';
    manual.required = false;
  }
}

// --- ADMIN PROXY POOL LOGIC ---

// --- ADMIN PROXY POOL LOGIC ---

async function fetchAdminProxies() {
  try {
    const res = await fetch(`/api/admin/proxies?page=${adminProxiesPage}&limit=${adminProxiesLimit}&search=${encodeURIComponent(adminProxiesSearch)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      adminProxiesData = data.proxies;
      adminProxiesTotalPages = data.pagination.totalPages;
      adminProxiesPage = data.pagination.page;
      renderAdminProxies();
      renderAdminProxiesPagination(data.pagination);
    }
  } catch (err) {
    showToast('Lỗi tải danh sách proxy!', 'error');
  }
}

function renderAdminProxies() {
  const tbody = document.getElementById('admin-proxies-table-body');
  if (!tbody) return;

  if (adminProxiesData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center placeholder-text">Không có proxy nào trong pool.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminProxiesData.map(p => `
    <tr>
      <td>${p.id}</td>
      <td><code>${escapeHtml(p.url)}</code></td>
      <td><span class="status-badge ${p.is_active === 1 ? 'status-success' : 'status-error'}">${p.is_active === 1 ? 'Hoạt động' : 'Tắt'}</span></td>
      <td>${new Date(p.created_at).toLocaleDateString('vi-VN')}</td>
      <td>
        <div class="schedule-btns">
          <button class="btn btn-secondary btn-sm" onclick="openEditProxyModal(${p.id})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProxy(${p.id})"><i class="fa-solid fa-trash-can"></i> Xóa</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderAdminProxiesPagination(pagination) {
  const info = document.getElementById('proxies-pagination-info');
  const btnPrev = document.getElementById('btn-proxies-prev');
  const btnNext = document.getElementById('btn-proxies-next');
  const container = document.getElementById('admin-proxies-pagination');
  if (!info || !btnPrev || !btnNext || !container) return;

  if (pagination.total === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  info.textContent = `Trang ${pagination.page} / ${pagination.totalPages || 1} (Tổng số ${pagination.total} proxy)`;
  
  btnPrev.disabled = pagination.page <= 1;
  btnNext.disabled = pagination.page >= pagination.totalPages;
}

function changeProxiesPage(direction) {
  const targetPage = adminProxiesPage + direction;
  if (targetPage >= 1 && targetPage <= adminProxiesTotalPages) {
    adminProxiesPage = targetPage;
    fetchAdminProxies();
  }
}

let proxiesSearchTimeout = null;
function handleProxiesSearch(event) {
  if (proxiesSearchTimeout) clearTimeout(proxiesSearchTimeout);
  proxiesSearchTimeout = setTimeout(() => {
    adminProxiesSearch = event.target.value;
    adminProxiesPage = 1; // Reset to page 1 on new search
    fetchAdminProxies();
  }, 400);
}

function openAddProxyModal() {
  document.getElementById('proxy-modal-title').textContent = 'Thêm proxy mới vào pool';
  document.getElementById('admin-proxy-id').value = '';
  document.getElementById('admin-proxy-url').value = '';
  document.getElementById('admin-proxy-active').checked = true;
  document.getElementById('proxy-modal').classList.remove('hidden');
}

function openEditProxyModal(id) {
  const p = adminProxiesData.find(item => item.id === id);
  if (!p) return;

  document.getElementById('proxy-modal-title').textContent = 'Chỉnh sửa proxy';
  document.getElementById('admin-proxy-id').value = p.id;
  document.getElementById('admin-proxy-url').value = p.url;
  document.getElementById('admin-proxy-active').checked = p.is_active === 1;
  document.getElementById('proxy-modal').classList.remove('hidden');
}

function closeProxyModal() {
  document.getElementById('proxy-modal').classList.add('hidden');
}

async function handleProxySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('admin-proxy-id').value;
  const url = document.getElementById('admin-proxy-url').value.trim();
  const is_active = document.getElementById('admin-proxy-active').checked ? 1 : 0;

  const payload = { url, is_active };
  const method = id ? 'PUT' : 'POST';
  const endpoint = id ? `/api/admin/proxies/${id}` : '/api/admin/proxies';

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
    if (!res.ok) throw new Error(data.message || 'Lỗi lưu proxy');

    showToast('Đã lưu thông tin proxy!');
    closeProxyModal();
    fetchAdminProxies();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProxy(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa proxy này khỏi pool?')) return;

  try {
    const res = await fetch(`/api/admin/proxies/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    showToast('Đã xóa proxy thành công!');
    fetchAdminProxies();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function populateUserProxySelect(currentVal = '') {
  const select = document.getElementById('admin-user-proxy-select');
  const customContainer = document.getElementById('admin-user-proxy-custom-container');
  const customInput = document.getElementById('admin-user-proxy');

  if (!select) return;

  select.innerHTML = `
    <option value="">Không sử dụng proxy</option>
    <option value="custom">-- Nhập thủ công... --</option>
  `;

  try {
    // Fetch active proxies specifically for this user selection dropdown
    const res = await fetch('/api/admin/proxies?page=1&limit=10000', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      data.proxies.forEach(p => {
        if (p.is_active === 1 || p.url === currentVal) {
          const option = document.createElement('option');
          option.value = p.url;
          option.textContent = p.url;
          select.appendChild(option);
        }
      });
    }
  } catch (err) {
    console.error('Failed to fetch proxies for user dropdown:', err);
  }

  if (!currentVal) {
    select.value = '';
    customContainer.classList.add('hidden');
    customInput.value = '';
  } else {
    const exists = Array.from(select.options).some(opt => opt.value === currentVal);
    if (exists) {
      select.value = currentVal;
      customContainer.classList.add('hidden');
      customInput.value = currentVal;
    } else {
      select.value = 'custom';
      customContainer.classList.remove('hidden');
      customInput.value = currentVal;
    }
  }

  if (select.dataset.searchableInitialized === 'true') {
    syncSearchableSelect('admin-user-proxy-select');
  }
}

function handleUserProxySelectChange() {
  const select = document.getElementById('admin-user-proxy-select');
  const customContainer = document.getElementById('admin-user-proxy-custom-container');
  const customInput = document.getElementById('admin-user-proxy');

  if (!select) return;

  if (select.value === 'custom') {
    customContainer.classList.remove('hidden');
    customInput.value = '';
    customInput.focus();
  } else {
    customContainer.classList.add('hidden');
    customInput.value = select.value;
  }
}

async function triggerProxyScan() {
  const btn = document.getElementById('btn-scan-proxies');
  if (!btn) return;

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...';
  showToast('Đang bắt đầu quét toàn bộ proxy hoạt động trong pool...');

  try {
    const res = await fetch('/api/admin/proxies/scan', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi quét proxy');

    showToast(data.message);
    fetchAdminProxies();
    fetchAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function importProxiesFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      let proxies = [];

      if (Array.isArray(json)) {
        proxies = json.map(item => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object') return (item.url || item.proxy || '').trim();
          return null;
        }).filter(Boolean);
      } else if (json && typeof json === 'object') {
        const possibleArray = json.proxies || json.list || [];
        if (Array.isArray(possibleArray)) {
          proxies = possibleArray.map(item => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') return (item.url || item.proxy || '').trim();
            return null;
          }).filter(Boolean);
        }
      }

      if (proxies.length === 0) {
        throw new Error('File JSON không chứa danh sách proxy hợp lệ (Dạng mảng string hoặc mảng object có thuộc tính "url" hoặc "proxy")');
      }

      showToast(`Đang tải lên và xử lý ${proxies.length} proxy...`);

      const res = await fetch('/api/admin/proxies/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ proxies })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Lỗi nhập proxy');

      showToast(data.message);
      fetchAdminProxies();
    } catch (err) {
      showToast(`Lỗi đọc file: ${err.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

// ==========================================
// SEARCHABLE SELECT DROPDOWN HELPER FUNCTIONS (Neo-Brutalism)
// ==========================================

function initializeSearchableSelect(selectId, placeholder = 'Gõ để tìm kiếm...') {
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;

  // Prevent double initialization
  if (selectEl.dataset.searchableInitialized === 'true') return;
  selectEl.dataset.searchableInitialized = 'true';

  // Create wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select-wrapper';
  wrapper.id = `${selectId}-searchable-wrapper`;

  // Hide original select (non-intrusively, keeping form submissions intact)
  selectEl.style.display = 'none';
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  // Create input and arrow icon
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'searchable-select-input';
  searchInput.placeholder = placeholder;
  searchInput.autocomplete = 'off';
  searchInput.id = `${selectId}-search-input`;
  wrapper.appendChild(searchInput);

  const arrow = document.createElement('i');
  arrow.className = 'fa-solid fa-chevron-down searchable-select-arrow';
  wrapper.appendChild(arrow);

  // Create dropdown container
  const dropdown = document.createElement('div');
  dropdown.className = 'searchable-select-dropdown hidden';
  dropdown.id = `${selectId}-searchable-dropdown`;
  wrapper.appendChild(dropdown);

  // Show dropdown on click or focus
  searchInput.addEventListener('focus', () => {
    wrapper.classList.add('open');
    dropdown.classList.remove('hidden');
    rebuildSearchableDropdownItems(selectId);
  });

  searchInput.addEventListener('click', () => {
    wrapper.classList.add('open');
    dropdown.classList.remove('hidden');
  });

  // Filter items on type
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const items = dropdown.querySelectorAll('.searchable-select-item:not(.no-results)');
    let matches = 0;

    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(query)) {
        item.style.display = '';
        matches++;
      } else {
        item.style.display = 'none';
      }
    });

    const noResultsEl = dropdown.querySelector('.no-results');
    if (matches === 0) {
      if (!noResultsEl) {
        const noRes = document.createElement('div');
        noRes.className = 'searchable-select-item no-results';
        noRes.textContent = 'Không tìm thấy kết quả';
        dropdown.appendChild(noRes);
      }
    } else if (noResultsEl) {
      noResultsEl.remove();
    }
  });

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove('open');
      dropdown.classList.add('hidden');

      // Reset input value to currently selected option label
      const selectedOpt = selectEl.options[selectEl.selectedIndex];
      searchInput.value = selectedOpt ? selectedOpt.textContent : '';
    }
  });
}

function rebuildSearchableDropdownItems(selectId) {
  const selectEl = document.getElementById(selectId);
  const dropdown = document.getElementById(`${selectId}-searchable-dropdown`);
  const searchInput = document.getElementById(`${selectId}-search-input`);
  if (!selectEl || !dropdown) return;

  dropdown.innerHTML = '';
  const options = Array.from(selectEl.options);

  if (options.length === 0 || (options.length === 1 && options[0].value === '')) {
    const noRes = document.createElement('div');
    noRes.className = 'searchable-select-item no-results';
    noRes.textContent = options[0] ? options[0].textContent : 'Không có tùy chọn';
    dropdown.appendChild(noRes);
    return;
  }

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'searchable-select-item';
    if (opt.value === selectEl.value) {
      item.classList.add('selected');
    }
    item.textContent = opt.textContent;
    item.dataset.value = opt.value;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectEl.value = opt.value;

      // Dispatch change event to trigger Zalo config updates/form handling
      selectEl.dispatchEvent(new Event('change'));

      searchInput.value = opt.textContent;

      const wrapper = document.getElementById(`${selectId}-searchable-wrapper`);
      if (wrapper) wrapper.classList.remove('open');
      dropdown.classList.add('hidden');
    });

    dropdown.appendChild(item);
  });
}

function syncSearchableSelect(selectId) {
  const selectEl = document.getElementById(selectId);
  const searchInput = document.getElementById(`${selectId}-search-input`);
  if (!selectEl || !searchInput) return;

  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  searchInput.value = selectedOpt ? selectedOpt.textContent : '';

  // Re-build dropdown in background if it's currently visible
  const dropdown = document.getElementById(`${selectId}-searchable-dropdown`);
  if (dropdown && !dropdown.classList.contains('hidden')) {
    rebuildSearchableDropdownItems(selectId);
  }
}

// Mobile sidebar drawer controllers
function toggleMobileSidebar(event) {
  if (event) event.stopPropagation();
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    const isOpen = sidebar.classList.toggle('open');
    if (isOpen) {
      overlay.classList.remove('hidden');
      // trigger reflow then show transition
      setTimeout(() => overlay.classList.add('open'), 10);
    } else {
      overlay.classList.remove('open');
      setTimeout(() => overlay.classList.add('hidden'), 300);
    }
  }
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
  }
  if (overlay && overlay.classList.contains('open')) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.classList.add('hidden'), 300);
  }
}

// Terms of Service & Privacy Policy Modal controls
function openTermsModal(event) {
  if (event) event.preventDefault();
  const modal = document.getElementById('terms-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeTermsModal() {
  const modal = document.getElementById('terms-modal');
  if (modal) modal.classList.add('hidden');
}

function openPrivacyModal(event) {
  if (event) event.preventDefault();
  const modal = document.getElementById('privacy-modal');
  if (modal) modal.classList.remove('hidden');
}

function closePrivacyModal() {
  const modal = document.getElementById('privacy-modal');
  if (modal) modal.classList.add('hidden');
}
