// API Base URL
const API_BASE = '/api';

// State Management
let currentView = 'creation'; // 'creation' or 'event'
let eventData = null;         // For the active event
let groupAvailability = [];   // All participants' availabilities
let selectedDates = new Set(); // For creation calendar ("YYYY-MM-DD")
let userAvailability = new Set(); // For active user availability ("YYYY-MM-DD")

// Active User
let activeUser = {
  name: '',
  password: ''
};

// Calendar Navigation State (for Creator Picker)
let pickerCurrentDate = new Date();

// Drag Select State
let isDragging = false;
let dragSelectMode = true; // true = selecting, false = deselecting
let dragStartDate = null;
let selectedDatesSnapshot = null;

let userDragStartIndex = -1;
let userAvailabilitySnapshot = null;

// Creation Mode State
let creationMode = 'datetime';   // 'datetime' or 'dateonly'
let creationDateMode = 'specific'; // 'specific' or 'days'
let selectedDays = new Set();    // For day-of-week mode (e.g. 'mon', 'tue')

// Document Elements
const creationView = document.getElementById('creation-view');
const eventView = document.getElementById('event-view');

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initCreationCalendar();
  setupEventListeners();
  
  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

// Router
function initRouter() {
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');
  
  if (eventId) {
    currentView = 'event';
    loadEventData(eventId);
  } else {
    currentView = 'creation';
    creationView.classList.remove('hidden');
    eventView.classList.add('hidden');
    renderPickerCalendar();
  }
}

// -------------------------------------------------------------
// EVENT LOAD & DATA SYNCHRONIZATION
// -------------------------------------------------------------
async function loadEventData(eventId) {
  try {
    // 1. Fetch Event Details
    const eventRes = await fetch(`${API_BASE}/events/${eventId}`);
    if (!eventRes.ok) {
      alert('모임을 찾을 수 없습니다. 메인 페이지로 이동합니다.');
      window.location.href = '/';
      return;
    }
    eventData = await eventRes.json();
    
    // 2. Fetch Group Availability
    await fetchGroupAvailability(eventId);

    // 3. Render Event Page details
    document.getElementById('display-event-title').textContent = eventData.title;
    
    // Copyable URL setup
    const shareUrlInput = document.getElementById('share-url-input');
    shareUrlInput.value = window.location.href;

    // Show Event View
    eventView.classList.remove('hidden');
    creationView.classList.add('hidden');

    // Render availability grids (heatmap is ready)
    if (eventData.mode === 'datetime') {
      document.querySelector('.heatmap-container').classList.add('hidden');
      document.getElementById('datetime-group-grid').classList.remove('hidden');
      renderDatetimeGroupGrid();
    } else {
      document.querySelector('.heatmap-container').classList.remove('hidden');
      document.getElementById('datetime-group-grid').classList.add('hidden');
      renderGroupHeatmap();
    }
    renderParticipantList();

    // Check if session storage has signed-in user for this event
    const storedUser = sessionStorage.getItem(`when2meeting_${eventId}`);
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      activeUser.name = parsed.name;
      activeUser.password = parsed.password;
      signInUser();
    } else {
      showSignInForm();
    }

    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error('Error loading event:', error);
    alert('모임 정보를 불러오는 중 오류가 발생했습니다.');
  }
}

async function fetchGroupAvailability(eventId) {
  const res = await fetch(`${API_BASE}/events/${eventId}/availability`);
  if (res.ok) {
    groupAvailability = await res.json();
  }
}

// -------------------------------------------------------------
// CREATOR DATE PICKER CALENDAR (Landing Page)
// -------------------------------------------------------------
function initCreationCalendar() {
  const btnPrev = document.getElementById('prev-month-btn');
  const btnNext = document.getElementById('next-month-btn');
  
  if (btnPrev) btnPrev.addEventListener('click', () => changePickerMonth(-1));
  if (btnNext) btnNext.addEventListener('click', () => changePickerMonth(1));

  const clearBtn = document.getElementById('clear-selected-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selectedDates.clear();
      selectedDays.clear();
      renderPickerCalendar();
      // Reset day-of-week buttons
      document.querySelectorAll('.dow-btn').forEach(b => b.classList.remove('active'));
    });
  }

  // Initialize mode toggles
  initModeToggles();
  // Populate time selectors
  populateTimeSelectors();
}

function initModeToggles() {
  // Mode toggle: datetime / dateonly
  const datetimeBtn = document.getElementById('mode-datetime-btn');
  const dateonlyBtn = document.getElementById('mode-dateonly-btn');
  if (datetimeBtn && dateonlyBtn) {
    datetimeBtn.addEventListener('click', () => {
      creationMode = 'datetime';
      datetimeBtn.classList.add('active');
      dateonlyBtn.classList.remove('active');
      document.getElementById('time-range-group').classList.remove('hidden');
    });
    dateonlyBtn.addEventListener('click', () => {
      creationMode = 'dateonly';
      dateonlyBtn.classList.add('active');
      datetimeBtn.classList.remove('active');
      document.getElementById('time-range-group').classList.add('hidden');
    });
  }

  // Date mode toggle: specific / days
  const specificBtn = document.getElementById('datemode-specific-btn');
  const daysBtn = document.getElementById('datemode-days-btn');
  if (specificBtn && daysBtn) {
    specificBtn.addEventListener('click', () => {
      creationDateMode = 'specific';
      specificBtn.classList.add('active');
      daysBtn.classList.remove('active');
      document.getElementById('day-of-week-group').classList.add('hidden');
      document.getElementById('creation-right-calendar').classList.remove('hidden');
    });
    daysBtn.addEventListener('click', () => {
      creationDateMode = 'days';
      daysBtn.classList.add('active');
      specificBtn.classList.remove('active');
      document.getElementById('day-of-week-group').classList.remove('hidden');
      document.getElementById('creation-right-calendar').classList.add('hidden');
    });
  }

  // Day of week buttons
  document.querySelectorAll('.dow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;
      if (selectedDays.has(day)) {
        selectedDays.delete(day);
        btn.classList.remove('active');
      } else {
        selectedDays.add(day);
        btn.classList.add('active');
      }
    });
  });
}

function populateTimeSelectors() {
  const startSel = document.getElementById('time-start-select');
  const endSel = document.getElementById('time-end-select');
  if (!startSel || !endSel) return;

  const times = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      const ampm = h < 12 ? '오전' : '오후';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${ampm} ${displayH}:${mm}`;
      times.push({ value, label });
    }
  }
  // Add midnight end option
  times.push({ value: '24:00', label: '자정 (다음날)' });

  times.forEach(t => {
    const opt1 = document.createElement('option');
    opt1.value = t.value;
    opt1.textContent = t.label;
    startSel.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = t.value;
    opt2.textContent = t.label;
    endSel.appendChild(opt2);
  });

  // Defaults: 9:00 AM ~ 10:00 PM
  startSel.value = '09:00';
  endSel.value = '22:00';
}

function changePickerMonth(delta) {
  pickerCurrentDate.setMonth(pickerCurrentDate.getMonth() + delta);
  renderPickerCalendar();
}

function renderPickerCalendar() {
  const grid = document.getElementById('calendar-picker-grid');
  grid.innerHTML = '';
  
  const year = pickerCurrentDate.getFullYear();
  const month = pickerCurrentDate.getMonth();
  
  // Set calendar title
  document.getElementById('calendar-month-year').textContent = `${year}년 ${month + 1}월`;

  // First day of month
  const firstDayIndex = new Date(year, month, 1).getDay();
  // Total days in month
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  // Disable past dates comparison target (today at 00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fill empty slots before first day
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day empty';
    grid.appendChild(emptyCell);
  }

  // Create date cells
  for (let day = 1; day <= totalDays; day++) {
    const cellDate = new Date(year, month, day);
    const dateStr = formatDate(cellDate);
    
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    dayCell.textContent = day;
    dayCell.dataset.date = dateStr;

    // Check if cell is in the past
    if (cellDate < today) {
      dayCell.classList.add('disabled');
    } else {
      if (selectedDates.has(dateStr)) {
        dayCell.classList.add('selected');
      }
      
      // Drag/Click selection logic
      dayCell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        dragSelectMode = !selectedDates.has(dateStr);
        dragStartDate = cellDate;
        selectedDatesSnapshot = new Set(selectedDates);
        updatePickerSelectionRange(cellDate, cellDate);
      });

      dayCell.addEventListener('mouseenter', () => {
        if (isDragging) {
          updatePickerSelectionRange(dragStartDate, cellDate);
        }
      });
    }

    grid.appendChild(dayCell);
  }
}

function updatePickerSelectionRange(startD, endD) {
  selectedDates = new Set(selectedDatesSnapshot);
  
  const t1 = startD.getTime();
  const t2 = endD.getTime();
  const minT = Math.min(t1, t2);
  const maxT = Math.max(t1, t2);
  
  let curr = new Date(minT);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const maxDate = new Date(maxT);
  maxDate.setHours(0,0,0,0);
  
  while (curr <= maxDate) {
    if (curr >= today) {
      const dStr = formatDate(curr);
      if (dragSelectMode) selectedDates.add(dStr);
      else selectedDates.delete(dStr);
    }
    // Add 1 day safely
    curr = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate() + 1);
  }
  
  document.querySelectorAll('#calendar-picker-grid .calendar-day:not(.empty)').forEach(cell => {
    const ds = cell.dataset.date;
    if (ds) {
      if (selectedDates.has(ds)) cell.classList.add('selected');
      else cell.classList.remove('selected');
    }
  });
}

// -------------------------------------------------------------
// EVENT VIEWS & USER REGISTRATION
// -------------------------------------------------------------
function showMainEventView() {
  document.getElementById('user-input-view').classList.add('hidden');
  document.getElementById('group-results-view').classList.remove('hidden');
  
  document.getElementById('back-to-main-container').classList.add('hidden');
  document.getElementById('participant-sidebar').classList.remove('hidden');

  if (activeUser.name) {
    document.getElementById('login-form-container').classList.add('hidden');
    document.getElementById('logged-in-menu-container').classList.remove('hidden');
  } else {
    document.getElementById('login-form-container').classList.remove('hidden');
    document.getElementById('logged-in-menu-container').classList.add('hidden');
  }

  const mainHeader = document.getElementById('main-app-header');
  if (mainHeader) mainHeader.classList.add('hidden');
}

function showUserInputView() {
  document.getElementById('group-results-view').classList.add('hidden');
  document.getElementById('user-input-view').classList.remove('hidden');
  
  document.getElementById('login-form-container').classList.add('hidden');
  document.getElementById('logged-in-menu-container').classList.add('hidden');
  document.getElementById('participant-sidebar').classList.add('hidden');
  document.getElementById('back-to-main-container').classList.remove('hidden');
}

function showSignInForm() {
  // Reset active user
  activeUser = { name: '', password: '' };
  // Show only the login form
  const loginContainer = document.getElementById('login-form-container');
  if (loginContainer) loginContainer.classList.remove('hidden');
  // Hide other left-panel sections
  const loggedMenu = document.getElementById('logged-in-menu-container');
  if (loggedMenu) loggedMenu.classList.add('hidden');
  const backBtn = document.getElementById('back-to-main-container');
  if (backBtn) backBtn.classList.add('hidden');
  // Keep group results (heatmap calendar) visible on the right
  const groupView = document.getElementById('group-results-view');
  if (groupView) groupView.classList.remove('hidden');
  // Hide user input view
  const userInput = document.getElementById('user-input-view');
  if (userInput) userInput.classList.add('hidden');
  // Show participant sidebar
  const sidebar = document.getElementById('participant-sidebar');
  if (sidebar) sidebar.classList.remove('hidden');
}


async function signInUser() {
  const activeNameEl = document.getElementById('active-user-name');
  const activeNameMainEl = document.getElementById('active-user-name-main');
  if (activeNameEl) activeNameEl.textContent = activeUser.name;
  if (activeNameMainEl) activeNameMainEl.textContent = activeUser.name;
  
  // Find existing availability
  const userRecord = groupAvailability.find(avail => avail.name.toLowerCase() === activeUser.name.toLowerCase());
  userAvailability.clear();
  
  if (userRecord && Array.isArray(userRecord.available_dates)) {
    userRecord.available_dates.forEach(d => userAvailability.add(d));
  }

  // === CRITICAL: Transition the UI after sign-in ===
  // Hide login form
  const loginContainer = document.getElementById('login-form-container');
  if (loginContainer) loginContainer.classList.add('hidden');
  // Show logged-in menu
  const loggedMenu = document.getElementById('logged-in-menu-container');
  if (loggedMenu) loggedMenu.classList.remove('hidden');
  // Make sure group results view is visible
  const groupView = document.getElementById('group-results-view');
  if (groupView) groupView.classList.remove('hidden');
  // Make sure participant sidebar is visible
  const sidebar = document.getElementById('participant-sidebar');
  if (sidebar) sidebar.classList.remove('hidden');
  // Hide back button (we are in main view)
  const backBtn = document.getElementById('back-to-main-container');
  if (backBtn) backBtn.classList.add('hidden');

  if (eventData.mode === 'datetime') {
    document.querySelector('#availability-input-section .custom-calendar-container').classList.add('hidden');
    document.getElementById('datetime-user-grid').classList.remove('hidden');
    renderDatetimeUserGrid();
  } else {
    document.querySelector('#availability-input-section .custom-calendar-container').classList.remove('hidden');
    document.getElementById('datetime-user-grid').classList.add('hidden');
    renderUserCalendarGrid();
  }
}

function renderUserCalendarGrid() {
  const sortedDates = [...eventData.dates].sort();
  
  renderEventCalendarLayout('availability-calendar-grid', sortedDates, (dateObj, dateStr) => {
    const dayCell = createDateSlotElement(dateObj, dateStr);

    if (userAvailability.has(dateStr)) {
      dayCell.classList.add('active');
    }

    dayCell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      dragSelectMode = !userAvailability.has(dateStr);
      dragStartDate = dateObj;
      userAvailabilitySnapshot = new Set(userAvailability);
      updateUserSelectionRange(dateObj, dateObj);
    });

    dayCell.addEventListener('mouseenter', () => {
      if (isDragging) {
        updateUserSelectionRange(dragStartDate, dateObj);
      }
    });

    return dayCell;
  });
}

function updateUserSelectionRange(startD, endD) {
  userAvailability = new Set(userAvailabilitySnapshot);
  
  const t1 = startD.getTime();
  const t2 = endD.getTime();
  
  const minT = Math.min(t1, t2);
  const maxT = Math.max(t1, t2);
  
  let curr = new Date(minT);
  curr.setHours(0,0,0,0);
  const mMax = new Date(maxT);
  mMax.setHours(0,0,0,0);
  
  while (curr <= mMax) {
    const dStr = formatDate(curr);
    if (eventData && eventData.dates && eventData.dates.includes(dStr)) {
      if (dragSelectMode) userAvailability.add(dStr);
      else userAvailability.delete(dStr);
    }
    // Add 1 day safely
    curr = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate() + 1);
  }
  
  const cells = document.querySelectorAll('#availability-calendar-grid .date-slot:not(.not-candidate)');
  cells.forEach(cell => {
    const ds = cell.dataset.dateString;
    if (ds) {
      if (userAvailability.has(ds)) {
        cell.classList.add('active');
      } else {
        cell.classList.remove('active');
      }
    }
  });
}

async function saveUserAvailability() {
  if (!activeUser.name) return;
  
  showSaveStatus('saving', '저장하는 중...');
  
  try {
    const res = await fetch(`${API_BASE}/events/${eventData.id}/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: activeUser.name,
        password: activeUser.password,
        available_dates: [...userAvailability]
      })
    });

    if (res.status === 401) {
      showSaveStatus('error', '저장 실패: 비밀번호 불일치');
      alert('해당 이름으로 등록된 일정의 비밀번호와 다릅니다.');
      return;
    }

    if (!res.ok) throw new Error();

    showSaveStatus('success', '모든 변경 사항이 저장되었습니다.');
    
    // Cache sign-in details
    sessionStorage.setItem(`when2meeting_${eventData.id}`, JSON.stringify(activeUser));
    
    // Refresh group data
    await fetchGroupAvailability(eventData.id);
    renderGroupHeatmap();
    renderParticipantList();
  } catch (e) {
    console.error(e);
    showSaveStatus('error', '저장 오류: 다시 시도해 주세요.');
  }
}

function showSaveStatus(type, message) {
  const container = document.getElementById('save-status');
  const textEl = document.getElementById('save-status-text');
  
  container.className = `save-status ${type}`;
  textEl.textContent = message;
  
  const icon = container.querySelector('.status-icon');
  if (type === 'saving') {
    icon.setAttribute('data-lucide', 'loader-2');
    icon.classList.add('spin');
  } else if (type === 'success') {
    icon.setAttribute('data-lucide', 'check-circle');
    icon.classList.remove('spin');
  } else {
    icon.setAttribute('data-lucide', 'alert-circle');
    icon.classList.remove('spin');
  }
  
  if (window.lucide) window.lucide.createIcons();
}

// -------------------------------------------------------------
// HEAT MAP & GROUP GRAPHICS
// -------------------------------------------------------------
function renderGroupHeatmap() {
  const sortedDates = [...eventData.dates].sort();
  const totalParticipants = groupAvailability.length;

  renderEventCalendarLayout('group-heatmap-grid', sortedDates, (dateObj, dateStr) => {
    const cell = createDateSlotElement(dateObj, dateStr);
    
    const availableUsers = groupAvailability.filter(avail => avail.available_dates.includes(dateStr));
    const availableCount = availableUsers.length;
    
    const countEl = document.createElement('div');
    countEl.className = 'slot-count';
    countEl.textContent = `${availableCount}명`;
    cell.appendChild(countEl);

    let cellClassIndex = 0;
    if (totalParticipants > 0 && availableCount > 0) {
      const percentage = availableCount / totalParticipants;
      if (percentage > 0.8) cellClassIndex = 5;
      else if (percentage > 0.6) cellClassIndex = 4;
      else if (percentage > 0.4) cellClassIndex = 3;
      else if (percentage > 0.2) cellClassIndex = 2;
      else cellClassIndex = 1;
    }
    
    cell.classList.add(`heatmap-cell-${cellClassIndex}`);
    cell.dataset.availableCount = availableCount;
    cell.dataset.dateString = dateStr;

    cell.addEventListener('mouseenter', () => showTooltip(cell, dateStr, availableUsers));
    cell.addEventListener('mouseleave', () => hideTooltip());

    return cell;
  });
}

function showTooltip(cell, dateStr, availableUsers) {
  const placeholder = document.getElementById('tooltip-placeholder');
  const content = document.getElementById('tooltip-content');
  const dateText = document.getElementById('tooltip-date');
  const ratioText = document.getElementById('tooltip-ratio');
  const yesList = document.getElementById('tooltip-list-yes');
  const noList = document.getElementById('tooltip-list-no');
  const yesCount = document.getElementById('tooltip-count-yes');
  const noCount = document.getElementById('tooltip-count-no');

  const totalParticipants = groupAvailability.length;
  const countYes = availableUsers.length;
  const countNo = totalParticipants - countYes;
  const percentage = totalParticipants > 0 ? Math.round((countYes / totalParticipants) * 100) : 0;

  // Format Date title in tooltip
  if (dateStr.includes('T') || dateStr.includes('오전') || dateStr.includes('오후') || dateStr.includes('요일')) {
    dateText.textContent = dateStr;
  } else {
    const daysKo = ['일', '월', '화', '수', '목', '금', '토'];
    const d = new Date(dateStr);
    dateText.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${daysKo[d.getDay()]})`;
  }

  ratioText.textContent = `${totalParticipants}명 중 ${countYes}명 가능 (${percentage}%)`;

  // Render lists
  yesList.innerHTML = '';
  noList.innerHTML = '';

  const availableNames = availableUsers.map(u => u.name);
  const unavailableNames = groupAvailability
    .filter(avail => !avail.available_dates.includes(dateStr))
    .map(u => u.name);

  yesCount.textContent = countYes;
  noCount.textContent = countNo;

  if (availableNames.length > 0) {
    availableNames.forEach(name => {
      const li = document.createElement('li');
      li.textContent = name;
      yesList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = '없음';
    li.className = 'empty-text';
    yesList.appendChild(li);
  }

  if (unavailableNames.length > 0) {
    unavailableNames.forEach(name => {
      const li = document.createElement('li');
      li.textContent = name;
      noList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = '없음';
    li.className = 'empty-text';
    noList.appendChild(li);
  }
  
  // Show content, hide placeholder
  if (placeholder) placeholder.classList.add('hidden');
  if (content) content.classList.remove('hidden');
}

function hideTooltip() {
  const placeholder = document.getElementById('tooltip-placeholder');
  const content = document.getElementById('tooltip-content');
  if (placeholder) placeholder.classList.remove('hidden');
  if (content) content.classList.add('hidden');
}

function renderParticipantList() {
  const list = document.getElementById('participant-list');
  const countEl = document.getElementById('participant-count');
  
  list.innerHTML = '';
  countEl.textContent = groupAvailability.length;

  if (groupAvailability.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'participant-instructions';
    emptyMsg.textContent = '아직 참여자가 없습니다.';
    list.appendChild(emptyMsg);
    return;
  }

  groupAvailability.forEach(participant => {
    const item = document.createElement('li');
    item.className = 'participant-item';
    
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'user');
    icon.className = 'btn-icon';
    icon.style.width = '0.85rem';
    icon.style.height = '0.85rem';

    const span = document.createElement('span');
    span.textContent = participant.name;

    item.appendChild(icon);
    item.appendChild(span);

    item.addEventListener('mouseenter', () => {
      const heatmapGrid = document.getElementById('group-heatmap-grid');
      heatmapGrid.classList.add('highlighting');
      
      const slots = heatmapGrid.querySelectorAll('.date-slot');
      slots.forEach(slot => {
        const slotDate = slot.dataset.dateString;
        if (participant.available_dates.includes(slotDate)) {
          slot.classList.add('highlighted');
        }
      });
    });

    item.addEventListener('mouseleave', () => {
      const heatmapGrid = document.getElementById('group-heatmap-grid');
      heatmapGrid.classList.remove('highlighting');
      
      const slots = heatmapGrid.querySelectorAll('.date-slot');
      slots.forEach(slot => {
        slot.classList.remove('highlighted');
      });
    });

    list.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons();
}

// -------------------------------------------------------------
// EVENT LISTENERS & GENERAL HELPERS
// -------------------------------------------------------------
function setupEventListeners() {
  // Global drag stop
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      if (currentView === 'event') {
        saveUserAvailability();
      }
    }
  });

  // Mobile Touch Drag Support
  window.addEventListener('touchstart', (e) => {
    const target = e.target;
    const cell = target.closest('.calendar-day, .date-slot, .time-slot');
    if (!cell) return;
    if (cell.classList.contains('empty') || cell.classList.contains('not-candidate')) return;
    
    e.preventDefault();
    isDragging = true;
    
    const isCreation = cell.classList.contains('calendar-day');
    const isDatetime = cell.classList.contains('time-slot');

    if (isDatetime) {
      const slotKey = cell.dataset.key;
      dragSelectMode = !userAvailability.has(slotKey);
      toggleDatetimeSlot(cell, slotKey, dragSelectMode);
      return;
    }

    const dateStr = isCreation ? cell.dataset.date : cell.dataset.dateString;
    const parts = dateStr.split('-');
    const cellDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    
    dragStartDate = cellDate;
    if (isCreation) {
      dragSelectMode = !selectedDates.has(dateStr);
      selectedDatesSnapshot = new Set(selectedDates);
      updatePickerSelectionRange(cellDate, cellDate);
    } else {
      dragSelectMode = !userAvailability.has(dateStr);
      userAvailabilitySnapshot = new Set(userAvailability);
      updateUserSelectionRange(cellDate, cellDate);
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;
    
    const cell = target.closest('.calendar-day, .date-slot, .time-slot');
    if (!cell) return;
    if (cell.classList.contains('empty') || cell.classList.contains('not-candidate')) return;
    
    const isCreation = cell.classList.contains('calendar-day');
    const isDatetime = cell.classList.contains('time-slot');

    if (isDatetime) {
      const slotKey = cell.dataset.key;
      toggleDatetimeSlot(cell, slotKey, dragSelectMode);
      return;
    }

    const dateStr = isCreation ? cell.dataset.date : cell.dataset.dateString;
    const parts = dateStr.split('-');
    const cellDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    
    if (isCreation) {
      updatePickerSelectionRange(dragStartDate, cellDate);
    } else {
      updateUserSelectionRange(dragStartDate, cellDate);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      if (currentView === 'event') {
        saveUserAvailability();
      }
    }
  });

  // Creation View: "Create Event" Button
  const createBtn = document.getElementById('create-event-btn');
  if (createBtn) {
    createBtn.addEventListener('click', createEvent);
  }

  // Event View: Copy Link Button
  const copyBtn = document.getElementById('copy-url-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', copyShareUrl);
  }

  // Event View: Sign In Button — bind directly (DOM is ready)
  const signinBtn = document.getElementById('signin-btn');
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      const name = document.getElementById('user-name').value.trim();
      const pass = document.getElementById('user-password').value;
      if (!name) {
        alert('이름을 입력해 주세요');
        return;
      }
      activeUser.name = name;
      activeUser.password = pass;
      signInUser();
    });
  }

  // Event View: Sign Out Button
  const signoutBtn = document.getElementById('signout-btn');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(`when2meeting_${eventData.id}`);
      activeUser = { name: '', password: '' };
      showSignInForm();
    });
  }


  const backToMainBtn = document.getElementById('back-to-main-btn');
  if (backToMainBtn) {
    backToMainBtn.addEventListener('click', showMainEventView);
  }

  // "내 가능한 시간 입력" button — bind directly (DOM is ready)
  const gotoInputBtn = document.getElementById('goto-input-btn');
  if (gotoInputBtn) {
    gotoInputBtn.addEventListener('click', showUserInputView);
  }

  const signoutBtnMain = document.getElementById('signout-btn-main');
  if (signoutBtnMain) {
    signoutBtnMain.addEventListener('click', () => {
      sessionStorage.removeItem(`when2meeting_${eventData.id}`);
      activeUser = { name: '', password: '' };
      showSignInForm();
    });
  }


  // Selection Helpers in Availability input (guard against missing elements)
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      eventData.dates.forEach(d => userAvailability.add(d));
      renderUserCalendarGrid();
      saveUserAvailability();
    });
  }

  const deselectAllBtn = document.getElementById('deselect-all-btn');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      userAvailability.clear();
      renderUserCalendarGrid();
      saveUserAvailability();
    });
  }
  
  // Paint Mode Toggles
  const btnAvail = document.getElementById('mode-available-btn');
  const btnUnavail = document.getElementById('mode-unavailable-btn');
  
  if (btnAvail && btnUnavail) {
    btnAvail.addEventListener('click', () => {
      currentPaintMode = 'available';
      btnAvail.classList.add('active');
      btnUnavail.classList.remove('active');
    });
    
    btnUnavail.addEventListener('click', () => {
      currentPaintMode = 'unavailable';
      btnUnavail.classList.add('active');
      btnAvail.classList.remove('active');
    });
  }
}

// Create Event
async function createEvent() {
  const title = document.getElementById('event-title').value.trim();
  
  if (!title) {
    alert('모임 이름을 입력해 주세요.');
    return;
  }

  let datesArray;
  if (creationDateMode === 'days') {
    if (selectedDays.size === 0) {
      alert('요일을 하나 이상 선택해 주세요.');
      return;
    }
    datesArray = Array.from(selectedDays);
  } else {
    if (selectedDates.size === 0) {
      alert('후보 날짜를 하나 이상 선택해 주세요.');
      return;
    }
    datesArray = Array.from(selectedDates);
  }

  const payload = {
    title: title,
    dates: datesArray,
    mode: creationMode,
    date_mode: creationDateMode
  };

  if (creationMode === 'datetime') {
    payload.time_start = document.getElementById('time-start-select').value;
    payload.time_end = document.getElementById('time-end-select').value;
    if (payload.time_start >= payload.time_end) {
      alert('종료 시간은 시작 시간보다 나중이어야 합니다.');
      return;
    }
  }

  try {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('이벤트 생성 실패');

    const result = await res.json();
    window.location.search = `?id=${result.id}`;
  } catch (error) {
    console.error('Error creating event:', error);
    alert('모임을 만드는 중 오류가 발생했습니다.');
  }
}

// Copy URL to Clipboard
function copyShareUrl() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => {
      showToast();
    })
    .catch(err => {
      console.error('Failed to copy text: ', err);
      // Fallback
      const input = document.getElementById('share-url-input');
      if (input) {
        input.value = window.location.href;
        input.classList.remove('hidden');
        input.select();
        document.execCommand('copy');
        input.classList.add('hidden');
        showToast();
      }
    });
}

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 150);
  }, 2000);
}


// -------------------------------------------------------------
// REUSABLE EVENT CALENDAR LAYOUT GENERATOR
// -------------------------------------------------------------
function renderEventCalendarLayout(containerId, candidateDates, createCellCallback) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  if (!candidateDates || candidateDates.length === 0) return;

  const sortedDates = [...candidateDates].sort();
  const minDate = new Date(sortedDates[0]);
  const maxDate = new Date(sortedDates[sortedDates.length - 1]);

  let currYear = minDate.getFullYear();
  let currMonth = minDate.getMonth();
  const endYear = maxDate.getFullYear();
  const endMonth = maxDate.getMonth();

  while (currYear < endYear || (currYear === endYear && currMonth <= endMonth)) {
    const wrapper = document.createElement('div');
    wrapper.className = 'event-month-wrapper';

    const title = document.createElement('div');
    title.className = 'event-month-title';
    title.textContent = `${currYear}년 ${currMonth + 1}월`;
    wrapper.appendChild(title);

    const header = document.createElement('div');
    header.className = 'event-weekday-header';
    ['일', '월', '화', '수', '목', '금', '토'].forEach(day => {
      const d = document.createElement('div');
      d.textContent = day;
      header.appendChild(d);
    });
    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'custom-calendar-grid';

    const firstDayIndex = new Date(currYear, currMonth, 1).getDay();
    const totalDays = new Date(currYear, currMonth + 1, 0).getDate();

    for (let i = 0; i < firstDayIndex; i++) {
      const empty = document.createElement('div');
      empty.className = 'date-slot not-candidate';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(currYear, currMonth, day);
      const dateStr = formatDate(cellDate);
      
      if (candidateDates.includes(dateStr)) {
        const cell = createCellCallback(cellDate, dateStr);
        grid.appendChild(cell);
      } else {
        const cell = document.createElement('div');
        cell.className = 'date-slot not-candidate';
        const dayEl = document.createElement('div');
        dayEl.className = 'slot-day';
        dayEl.textContent = day;
        cell.appendChild(dayEl);
        grid.appendChild(cell);
      }
    }

    wrapper.appendChild(grid);
    container.appendChild(wrapper);

    currMonth++;
    if (currMonth > 11) {
      currMonth = 0;
      currYear++;
    }
  }
}


// Create single date slot grid node
function createDateSlotElement(dateObj, dateStr) {
  const slot = document.createElement('div');
  slot.className = 'date-slot';
  slot.dataset.dateString = dateStr;
  
  const dayEl = document.createElement('div');
  dayEl.className = 'slot-day';
  dayEl.textContent = dateObj.getDate();

  slot.appendChild(dayEl);

  return slot;
}

// Date Formatter helper
function formatDate(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

// -------------------------------------------------------------
// DATETIME GRID (when2meet style)
// -------------------------------------------------------------
function generateTimeSlots(timeStart, timeEnd) {
  const slots = [];
  const start = timeStart.split(':').map(Number);
  const end = timeEnd.split(':').map(Number);
  let h = start[0], m = start[1];
  const endH = end[0], endM = end[1];

  while (h < endH || (h === endH && m < endM)) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
    m += 30;
    if (m >= 60) {
      m -= 60;
      h++;
    }
  }
  return slots;
}

function formatTimeLabel(timeStr) {
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h < 12 ? '오전' : '오후';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${ampm} ${h}:${m}`;
}

function renderDatetimeGroupGrid() {
  const container = document.getElementById('datetime-group-grid');
  container.innerHTML = '';

  const dates = [...eventData.dates].sort();
  const timeSlots = generateTimeSlots(eventData.time_start || '09:00', eventData.time_end || '22:00');
  const totalParticipants = groupAvailability.length;

  const grid = document.createElement('div');
  grid.className = 'time-grid';
  grid.style.gridTemplateColumns = `60px repeat(${dates.length}, minmax(40px, 1fr))`;

  const emptyCorner = document.createElement('div');
  grid.appendChild(emptyCorner);

  dates.forEach(d => {
    const header = document.createElement('div');
    header.className = 'time-grid-header';
    if (eventData.date_mode === 'days') {
      const daysMap = { sun: '일', mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토' };
      header.textContent = daysMap[d] || d;
    } else {
      const parts = d.split('-');
      header.innerHTML = `${parts[1]}/${parts[2]}<br>` + 
        ['일','월','화','수','목','금','토'][new Date(d).getDay()];
    }
    grid.appendChild(header);
  });

  timeSlots.forEach(time => {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'time-label';
    if (time.endsWith(':30')) {
      timeLabel.classList.add('half-hour');
      timeLabel.textContent = time; 
    } else {
      timeLabel.textContent = formatTimeLabel(time);
    }
    grid.appendChild(timeLabel);

    dates.forEach(d => {
      const slotKey = `${d}T${time}`;
      const cell = document.createElement('div');
      cell.className = 'time-slot';
      cell.dataset.key = slotKey;

      const availableUsers = groupAvailability.filter(avail => avail.available_dates.includes(slotKey));
      const availableCount = availableUsers.length;

      let heat = 0;
      if (totalParticipants > 0 && availableCount > 0) {
        const percentage = availableCount / totalParticipants;
        if (percentage > 0.8) heat = 5;
        else if (percentage > 0.6) heat = 4;
        else if (percentage > 0.4) heat = 3;
        else if (percentage > 0.2) heat = 2;
        else heat = 1;
      }
      cell.classList.add(`heat-${heat}`);

      let displayDate = d;
      if (eventData.date_mode === 'days') {
        const daysMap = { sun: '일요일', mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일', fri: '금요일', sat: '토요일' };
        displayDate = daysMap[d] || d;
      } else {
        const parts = d.split('-');
        displayDate = `${parts[0]}년 ${parts[1]}월 ${parts[2]}일 (${['일','월','화','수','목','금','토'][new Date(d).getDay()]})`;
      }
      const displayKey = `${displayDate} ${formatTimeLabel(time)}`;

      cell.addEventListener('mouseenter', () => showTooltip(cell, displayKey, availableUsers));
      cell.addEventListener('mouseleave', () => hideTooltip());

      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

function renderDatetimeUserGrid() {
  const container = document.getElementById('datetime-user-grid');
  container.innerHTML = '';

  const dates = [...eventData.dates].sort();
  const timeSlots = generateTimeSlots(eventData.time_start || '09:00', eventData.time_end || '22:00');

  const grid = document.createElement('div');
  grid.className = 'time-grid';
  grid.style.gridTemplateColumns = `60px repeat(${dates.length}, minmax(40px, 1fr))`;

  const emptyCorner = document.createElement('div');
  grid.appendChild(emptyCorner);

  dates.forEach(d => {
    const header = document.createElement('div');
    header.className = 'time-grid-header';
    if (eventData.date_mode === 'days') {
      const daysMap = { sun: '일', mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토' };
      header.textContent = daysMap[d] || d;
    } else {
      const parts = d.split('-');
      header.innerHTML = `${parts[1]}/${parts[2]}<br>` + 
        ['일','월','화','수','목','금','토'][new Date(d).getDay()];
    }
    grid.appendChild(header);
  });

  timeSlots.forEach(time => {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'time-label';
    if (time.endsWith(':30')) {
      timeLabel.classList.add('half-hour');
      timeLabel.textContent = time; 
    } else {
      timeLabel.textContent = formatTimeLabel(time);
    }
    grid.appendChild(timeLabel);

    dates.forEach(d => {
      const slotKey = `${d}T${time}`;
      const cell = document.createElement('div');
      cell.className = 'time-slot';
      cell.dataset.key = slotKey;
      
      if (userAvailability.has(slotKey)) {
        cell.classList.add('available');
      }

      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        dragSelectMode = !userAvailability.has(slotKey);
        toggleDatetimeSlot(cell, slotKey, dragSelectMode);
      });

      cell.addEventListener('mouseenter', (e) => {
        if (isDragging) {
          toggleDatetimeSlot(cell, slotKey, dragSelectMode);
        }
      });

      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

function toggleDatetimeSlot(cell, slotKey, add) {
  if (add) {
    userAvailability.add(slotKey);
    cell.classList.add('available');
  } else {
    userAvailability.delete(slotKey);
    cell.classList.remove('available');
  }
}
