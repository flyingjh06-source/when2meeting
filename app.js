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
    renderGroupHeatmap();
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
    alert('모임 데이터를 불러오는 중 오류가 발생했습니다.');
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
  document.getElementById('prev-month-btn').addEventListener('click', () => {
    pickerCurrentDate.setMonth(pickerCurrentDate.getMonth() - 1);
    renderPickerCalendar();
  });

  document.getElementById('next-month-btn').addEventListener('click', () => {
    pickerCurrentDate.setMonth(pickerCurrentDate.getMonth() + 1);
    renderPickerCalendar();
  });

  document.getElementById('clear-selected-btn').addEventListener('click', () => {
    selectedDates.clear();
    renderPickerCalendar();
  });
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
        toggleDateSelection(dayCell, dateStr, dragSelectMode);
      });

      dayCell.addEventListener('mouseenter', () => {
        if (isDragging) {
          toggleDateSelection(dayCell, dateStr, dragSelectMode);
        }
      });
    }

    grid.appendChild(dayCell);
  }
}

function toggleDateSelection(cell, dateStr, select) {
  if (select) {
    selectedDates.add(dateStr);
    cell.classList.add('selected');
  } else {
    selectedDates.delete(dateStr);
    cell.classList.remove('selected');
  }
}

// -------------------------------------------------------------
// EVENT VIEWS & USER REGISTRATION
// -------------------------------------------------------------
function showSignInForm() {
  document.getElementById('signin-section').classList.remove('hidden');
  document.getElementById('availability-input-section').classList.add('hidden');
}

async function signInUser() {
  document.getElementById('signin-section').classList.add('hidden');
  document.getElementById('availability-input-section').classList.remove('hidden');
  document.getElementById('active-user-name').textContent = activeUser.name;
  
  // Find existing availability
  const userRecord = groupAvailability.find(avail => avail.name.toLowerCase() === activeUser.name.toLowerCase());
  userAvailability.clear();
  
  if (userRecord && Array.isArray(userRecord.available_dates)) {
    userRecord.available_dates.forEach(date => userAvailability.add(date));
  }
  
  renderUserCalendarGrid();
}

function renderUserCalendarGrid() {
  const grid = document.getElementById('availability-calendar-grid');
  grid.innerHTML = '';

  // Sort proposed dates chronologically
  const sortedDates = [...eventData.dates].sort();

  sortedDates.forEach(dateStr => {
    const dateObj = new Date(dateStr);
    const dayCell = createDateSlotElement(dateObj, dateStr);

    if (userAvailability.has(dateStr)) {
      dayCell.classList.add('active');
    }

    // Drag-to-select handlers
    dayCell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      dragSelectMode = !userAvailability.has(dateStr);
      toggleUserAvailability(dayCell, dateStr, dragSelectMode);
    });

    dayCell.addEventListener('mouseenter', () => {
      if (isDragging) {
        toggleUserAvailability(dayCell, dateStr, dragSelectMode);
      }
    });

    grid.appendChild(dayCell);
  });
}

function toggleUserAvailability(cell, dateStr, select) {
  if (select) {
    userAvailability.add(dateStr);
    cell.classList.add('active');
  } else {
    userAvailability.delete(dateStr);
    cell.classList.remove('active');
  }
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
  const grid = document.getElementById('group-heatmap-grid');
  grid.innerHTML = '';

  const sortedDates = [...eventData.dates].sort();
  const totalParticipants = groupAvailability.length;

  sortedDates.forEach(dateStr => {
    const dateObj = new Date(dateStr);
    const cell = createDateSlotElement(dateObj, dateStr);
    
    // Calculate how many people are available
    const availableUsers = groupAvailability.filter(avail => avail.available_dates.includes(dateStr));
    const availableCount = availableUsers.length;
    
    // Map count to heatmap shading classes (0 to 5)
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

    // Hover tooltip events
    cell.addEventListener('mouseenter', (e) => {
      showTooltip(cell, dateStr, availableUsers);
    });

    cell.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    grid.appendChild(cell);
  });
}

function showTooltip(cell, dateStr, availableUsers) {
  const tooltip = document.getElementById('date-tooltip-card');
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
  const daysKo = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(dateStr);
  dateText.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${daysKo[d.getDay()]})`;

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

  tooltip.classList.remove('hidden');
}

function hideTooltip() {
  // We keep it visible or hide, standard behavior is hide when leaving heatmap grid entirely or hide immediately.
  // Actually, keeping it open at the last hovered date is nice, but let's hide it or let it fade.
  // Let's keep it visible so users can read it comfortably, or hide it on leaving.
  // To make it look extremely premium, we hide it only if we're not hovering any slot.
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

    // Interactive Hover Highlighting:
    // Hovering a participant highlights their specific dates on the main heatmap
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
  document.addEventListener('mouseup', () => {
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

  // Event View: Sign In Button
  const signinBtn = document.getElementById('signin-btn');
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      const name = document.getElementById('user-name').value.trim();
      const pass = document.getElementById('user-password').value;
      
      if (!name) {
        alert('이름을 입력해 주세요.');
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

  // Selection Helpers in Availability input
  document.getElementById('select-all-btn').addEventListener('click', () => {
    eventData.dates.forEach(d => userAvailability.add(d));
    renderUserCalendarGrid();
    saveUserAvailability();
  });

  document.getElementById('deselect-all-btn').addEventListener('click', () => {
    userAvailability.clear();
    renderUserCalendarGrid();
    saveUserAvailability();
  });
}

// Create Event
async function createEvent() {
  const title = document.getElementById('event-title').value.trim();
  
  if (!title) {
    alert('모임 이름을 입력해 주세요.');
    return;
  }
  
  if (selectedDates.size === 0) {
    alert('후보 날짜를 하나 이상 선택해 주세요.');
    return;
  }

  const datesArray = Array.from(selectedDates);

  try {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        dates: datesArray
      })
    });

    if (!res.ok) throw new Error('이벤트 생성 실패');

    const result = await res.json();
    // Redirect to the event view URL
    window.location.search = `?id=${result.id}`;
  } catch (error) {
    console.error('Error creating event:', error);
    alert('모임을 만드는 중 오류가 발생했습니다.');
  }
}

// Copy URL to Clipboard
function copyShareUrl() {
  const input = document.getElementById('share-url-input');
  input.select();
  input.setSelectionRange(0, 99999); // For mobile devices

  navigator.clipboard.writeText(input.value)
    .then(() => {
      showToast();
    })
    .catch(err => {
      console.error('Failed to copy text: ', err);
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

// Create single date slot grid node
function createDateSlotElement(dateObj, dateStr) {
  const monthsKo = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  const daysKo = ['일', '월', '화', '수', '목', '금', '토'];

  const slot = document.createElement('div');
  slot.className = 'date-slot';
  
  const monthEl = document.createElement('div');
  monthEl.className = 'slot-month';
  monthEl.textContent = monthsKo[dateObj.getMonth()];

  const dayEl = document.createElement('div');
  dayEl.className = 'slot-day';
  dayEl.textContent = dateObj.getDate();

  const weekdayEl = document.createElement('div');
  weekdayEl.className = 'slot-weekday';
  weekdayEl.textContent = `(${daysKo[dateObj.getDay()]})`;

  slot.appendChild(monthEl);
  slot.appendChild(dayEl);
  slot.appendChild(weekdayEl);

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
