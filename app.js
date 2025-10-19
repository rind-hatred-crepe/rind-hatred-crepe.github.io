// Telegram WebApp initialization
const tg = window.Telegram.WebApp;
tg.expand();
tg.enableClosingConfirmation();

// Time slot mappings (must match backend SLOT_DISPLAY_MAPPING)
const SLOT_DISPLAY_MAPPING = {
    '1.0': '08:30',
    '2.0': '10:20',
    '3.0': '12:45',
    '4.0': '14:35',
    '5.0': '16:25',
    '6.0': '18:50',
    '7.0': '20:40'
};

// State
let appState = {
    selectedSlots: {},  // Format: {'DD/MM/YYYY': ['1.0', '2.0', ...]}
    heatmapData: {},    // Format: {'DD/MM/YYYY': {'1.0': 3, '2.0': 5, ...}}
    options: {},
    currentMonth: null,
    allDates: []
};

// Utility: Decompress gzip + base64 data
async function decompressData(base64String) {
    try {
        // Decode URL-safe base64
        const base64 = base64String.replace(/-/g, '+').replace(/_/g, '/');
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Decompress using DecompressionStream
        const stream = new Response(bytes).body.pipeThrough(
            new DecompressionStream('gzip')
        );
        const decompressed = await new Response(stream).arrayBuffer();
        const text = new TextDecoder().decode(decompressed);
        return JSON.parse(text);
    } catch (error) {
        console.error('Decompression error:', error);
        throw new Error('Failed to decompress data');
    }
}

// Utility: Compress data to gzip + base64
async function compressData(data) {
    try {
        const jsonString = JSON.stringify(data);
        const bytes = new TextEncoder().encode(jsonString);

        // Compress using CompressionStream
        const stream = new Response(bytes).body.pipeThrough(
            new CompressionStream('gzip')
        );
        const compressed = await new Response(stream).arrayBuffer();
        const compressedBytes = new Uint8Array(compressed);

        // Encode to URL-safe base64
        let binary = '';
        for (let i = 0; i < compressedBytes.length; i++) {
            binary += String.fromCharCode(compressedBytes[i]);
        }
        const base64 = btoa(binary);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (error) {
        console.error('Compression error:', error);
        throw new Error('Failed to compress data');
    }
}

// Parse URL parameters and initialize
async function initializeApp() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const appEl = document.getElementById('app');

    try {
        // Get compressed data from URL
        const urlParams = new URLSearchParams(window.location.search);
        const compressedData = urlParams.get('data');

        if (!compressedData) {
            throw new Error('No data provided');
        }

        const userData = await decompressData(compressedData);

        // Initialize state from user data
        appState.selectedSlots = userData.whitelisted_sessions || {};
        appState.heatmapData = userData.heatmap || {};
        appState.options = {
            stop_after_one_slot: userData.stop_after_one_slot || false,
            stop_at_midnight: userData.stop_at_midnight || false,
            back_to_back_only: userData.back_to_back_only || false,
            exclude_current_day: userData.exclude_current_day || false,
            daily_lesson_limit: userData.daily_lesson_limit || 1,
            credits_per_slot: userData.credits_per_slot || 1
        };

        // Generate list of next 4 months
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        appState.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        appState.allDates = [];
        for (let monthOffset = 0; monthOffset < 4; monthOffset++) {
            const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
            const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
            
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(month.getFullYear(), month.getMonth(), day);
                if (date >= today) {
                    appState.allDates.push(formatDate(date));
                }
            }
        }

        loadingEl.classList.add('hidden');
        appEl.classList.remove('hidden');
        initializeUI();
        renderCurrentMonth();
    } catch (error) {
        console.error('Initialization error:', error);
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Error loading data: ' + error.message;
        errorEl.classList.remove('hidden');
    }
}

// Initialize UI components
function initializeUI() {
    // View switcher
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            switchView(view);
        });
    });

    // Month navigation
    document.getElementById('prev-month-btn').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month-btn').addEventListener('click', () => changeMonth(1));

    // Options toggles
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
        const option = toggle.dataset.option;
        const slider = toggle.querySelector('.toggle-slider');
        
        if (appState.options[option]) {
            toggle.classList.add('!bg-tg-button');
            slider.classList.add('translate-x-[22px]');
        }
        
        toggle.addEventListener('click', () => {
            appState.options[option] = !appState.options[option];
            toggle.classList.toggle('!bg-tg-button');
            slider.classList.toggle('translate-x-[22px]');
        });
    });

    // Options selects
    document.getElementById('daily-lesson-limit').value = appState.options.daily_lesson_limit;
    document.getElementById('daily-lesson-limit').addEventListener('change', (e) => {
        appState.options.daily_lesson_limit = parseInt(e.target.value);
    });

    document.getElementById('credits-per-slot').value = appState.options.credits_per_slot;
    document.getElementById('credits-per-slot').addEventListener('change', (e) => {
        appState.options.credits_per_slot = parseInt(e.target.value);
    });

    // Confirm button
    document.getElementById('confirm-btn').addEventListener('click', confirmAndClose);

    // Telegram back button
    tg.BackButton.show();
    tg.BackButton.onClick(() => {
        const confirmed = confirm('Are you sure? Changes will not be saved if you go back without confirming.');
        if (confirmed) {
            tg.close();
        }
    });
}

function switchView(view) {
    document.querySelectorAll('.view-btn').forEach(btn => {
        const isActive = btn.dataset.view === view;
        if (isActive) {
            btn.classList.add('!bg-tg-bg', '!text-tg-text', 'shadow-sm');
            btn.classList.remove('bg-transparent', 'text-tg-hint');
        } else {
            btn.classList.remove('!bg-tg-bg', '!text-tg-text', 'shadow-sm');
            btn.classList.add('bg-transparent', 'text-tg-hint');
        }
    });

    document.getElementById('slots-view').classList.toggle('hidden', view !== 'slots');
    document.getElementById('options-view').classList.toggle('hidden', view !== 'options');
}

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatDateDisplay(dateString) {
    const [day, month, year] = dateString.split('/');
    const date = new Date(year, month - 1, day);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
        day: dayNames[date.getDay()],
        fullDate: `${parseInt(day)} ${monthNames[date.getMonth()]}`,
        dayOfWeek: date.getDay()
    };
}

function changeMonth(offset) {
    const newMonth = new Date(appState.currentMonth);
    newMonth.setMonth(newMonth.getMonth() + offset);
    
    const today = new Date();
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const maxMonth = new Date(today.getFullYear(), today.getMonth() + 3, 1);
    
    if (newMonth >= minMonth && newMonth <= maxMonth) {
        appState.currentMonth = newMonth;
        renderCurrentMonth();
    }
}

function getDatesForCurrentMonth() {
    const monthStart = new Date(appState.currentMonth);
    const monthEnd = new Date(appState.currentMonth.getFullYear(), appState.currentMonth.getMonth() + 1, 0);
    
    return appState.allDates.filter(dateStr => {
        const [day, month, year] = dateStr.split('/');
        const date = new Date(year, month - 1, day);
        return date >= monthStart && date <= monthEnd;
    });
}

function renderCurrentMonth() {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    document.getElementById('current-month-title').textContent = 
        `${monthNames[appState.currentMonth.getMonth()]} ${appState.currentMonth.getFullYear()}`;
    
    const today = new Date();
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const maxMonth = new Date(today.getFullYear(), today.getMonth() + 3, 1);
    
    document.getElementById('prev-month-btn').disabled = appState.currentMonth <= minMonth;
    document.getElementById('next-month-btn').disabled = appState.currentMonth >= maxMonth;
    
    renderDatesList(getDatesForCurrentMonth());
}

function renderDatesList(dates) {
    const table = document.getElementById('slot-matrix');
    const thead = table.querySelector('thead tr');
    const tbody = document.getElementById('matrix-body');

    thead.innerHTML = '<th class="p-1.5 text-center border border-tg-secondary-bg bg-tg-secondary-bg font-semibold text-[10px] text-tg-text sticky top-0 z-10 cursor-pointer select-none hover:bg-tg-hint/20 w-[45px] min-w-[45px] text-left pl-1" id="toggle-all-header" title="Click to toggle all slots in this month">Date</th>';
    tbody.innerHTML = '';
    
    document.getElementById('toggle-all-header').addEventListener('click', toggleAllMonth);

    // Create time slot headers with click handlers for column selection
    Object.entries(SLOT_DISPLAY_MAPPING).forEach(([slotId, slotTime]) => {
        const th = document.createElement('th');
        th.className = 'p-1.5 text-center border border-tg-secondary-bg bg-tg-secondary-bg font-semibold text-[10px] text-tg-text sticky top-0 z-10 cursor-pointer select-none hover:bg-tg-hint/20 whitespace-nowrap text-[9px]';
        th.textContent = slotTime;
        th.title = `Click to toggle all ${slotTime} slots`;
        th.addEventListener('click', () => toggleColumn(slotId));
        thead.appendChild(th);
    });

    dates.forEach(dateString => tbody.appendChild(createDateRow(dateString)));
}

function createDateRow(dateString) {
    const row = document.createElement('tr');
    row.className = 'table w-full [table-layout:fixed]';
    
    const dateDisplay = formatDateDisplay(dateString);
    const isWeekend = dateDisplay.dayOfWeek === 0 || dateDisplay.dayOfWeek === 6;
    
    if (isWeekend) {
        row.classList.add('weekend', 'bg-black/5');
    }
    const dateCell = document.createElement('td');
    dateCell.className = 'text-left font-medium cursor-pointer select-none w-[45px] hover:bg-tg-secondary-bg/50 pl-1 pr-1.5 py-1 border border-tg-secondary-bg';
    dateCell.title = `Click to toggle all slots for ${dateString}`;
    dateCell.addEventListener('click', () => toggleRow(dateString, isWeekend));
    
    dateCell.innerHTML = `
        <div class="text-[10px] text-tg-text whitespace-nowrap font-semibold">${dateDisplay.fullDate}</div>
        <div class="text-[9px] text-tg-hint">${dateDisplay.day}</div>
    `;
    row.appendChild(dateCell);

    Object.keys(SLOT_DISPLAY_MAPPING).forEach(slotId => {
        row.appendChild(createSlotCell(dateString, slotId, isWeekend));
    });

    return row;
}

function createSlotCell(dateString, slotId, isWeekend) {
    const cell = document.createElement('td');
    cell.className = 'relative cursor-pointer select-none p-0 border border-tg-secondary-bg';
    
    const isWeekendSlot = isWeekend && (slotId === '6.0' || slotId === '7.0');
    if (isWeekendSlot) {
        cell.classList.add('!bg-black/15');
    }
    
    const heat = getSlotHeat(dateString, slotId);
    if (heat > 0 && !isWeekendSlot) {
        const opacity = Math.min(0.05 + (heat - 1) * 0.03, 0.70);
        cell.classList.add(`bg-[rgb(244_67_54/${opacity})]`);
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = 'absolute inset-0 flex items-center justify-center transition-all duration-150 bg-transparent';
    
    const isSelected = appState.selectedSlots[dateString]?.includes(slotId);
    if (isSelected) {
        wrapper.classList.add('border-2', 'border-tg-button', 'rounded-[3px]', 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]', 'inset-[3px]');
        const icon = document.createElement('div');
        icon.className = 'text-xl text-tg-button leading-none font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]';
        icon.textContent = '✓';
        wrapper.appendChild(icon);
    }
    
    wrapper.addEventListener('mousedown', () => wrapper.classList.add('scale-95'));
    wrapper.addEventListener('mouseup', () => wrapper.classList.remove('scale-95'));
    wrapper.addEventListener('mouseleave', () => wrapper.classList.remove('scale-95'));
    wrapper.addEventListener('click', () => toggleSlot(dateString, slotId));
    
    cell.appendChild(wrapper);
    return cell;
}

function getSlotHeat(dateString, slotId) {
    return appState.heatmapData[dateString]?.[slotId] || 0;
}

function toggleSlot(dateString, slotId) {
    if (!appState.selectedSlots[dateString]) {
        appState.selectedSlots[dateString] = [];
    }
    
    const slots = appState.selectedSlots[dateString];
    const index = slots.indexOf(slotId);
    
    if (index > -1) {
        slots.splice(index, 1);
        if (slots.length === 0) {
            delete appState.selectedSlots[dateString];
        }
    } else {
        slots.push(slotId);
        slots.sort((a, b) => parseFloat(a) - parseFloat(b));
    }
    
    renderCurrentMonth();
}

function toggleRow(dateString, isWeekend) {
    const allSlots = Object.keys(SLOT_DISPLAY_MAPPING);
    
    if (!appState.selectedSlots[dateString]) {
        appState.selectedSlots[dateString] = [];
    }
    
    const slots = appState.selectedSlots[dateString];
    
    allSlots.forEach(slotId => {
        const index = slots.indexOf(slotId);
        if (index > -1) {
            slots.splice(index, 1);
        } else {
            slots.push(slotId);
        }
    });
    
    slots.sort((a, b) => parseFloat(a) - parseFloat(b));
    if (slots.length === 0) delete appState.selectedSlots[dateString];
    
    renderCurrentMonth();
}

function toggleColumn(slotId) {
    getDatesForCurrentMonth().forEach(dateString => {
        if (!appState.selectedSlots[dateString]) {
            appState.selectedSlots[dateString] = [];
        }
        
        const slots = appState.selectedSlots[dateString];
        const index = slots.indexOf(slotId);
        
        if (index > -1) {
            slots.splice(index, 1);
        } else {
            slots.push(slotId);
        }
        
        slots.sort((a, b) => parseFloat(a) - parseFloat(b));
        if (slots.length === 0) delete appState.selectedSlots[dateString];
    });
    
    renderCurrentMonth();
}

function toggleAllMonth() {
    const allSlots = Object.keys(SLOT_DISPLAY_MAPPING);
    
    getDatesForCurrentMonth().forEach(dateString => {
        if (!appState.selectedSlots[dateString]) {
            appState.selectedSlots[dateString] = [];
        }
        
        const slots = appState.selectedSlots[dateString];
        
        allSlots.forEach(slotId => {
            const index = slots.indexOf(slotId);
            if (index > -1) {
                slots.splice(index, 1);
            } else {
                slots.push(slotId);
            }
        });
        
        slots.sort((a, b) => parseFloat(a) - parseFloat(b));
        if (slots.length === 0) delete appState.selectedSlots[dateString];
    });
    
    renderCurrentMonth();
}

async function confirmAndClose() {
    try {
        const sortedSlots = {};
        const sortedDates = Object.keys(appState.selectedSlots).sort((a, b) => {
            const [dayA, monthA, yearA] = a.split('/').map(Number);
            const [dayB, monthB, yearB] = b.split('/').map(Number);
            const dateA = new Date(yearA, monthA - 1, dayA);
            const dateB = new Date(yearB, monthB - 1, dayB);
            return dateA - dateB;
        });
        
        sortedDates.forEach(date => {
            sortedSlots[date] = appState.selectedSlots[date];
        });
        
        const compressed = await compressData({
            action: 'save_config',
            whitelisted_sessions: sortedSlots,
            options: appState.options
        });

        tg.sendData(compressed);
    } catch (error) {
        console.error('Save error:', error);
        alert('Error saving data: ' + error.message);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
