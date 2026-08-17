/* Dashboard frontend — polls memory every 2 seconds */

async function fetchAccounts() {
  const res = await fetch('/api/accounts');
  return res.json();
}

async function fetchMemory(accountId) {
  const res = await fetch(`/api/memory/${encodeURIComponent(accountId)}`);
  return res.json();
}

async function loadMemoryView() {
  const sel = document.getElementById('accountSelect');
  const accountId = sel.value;
  if (!accountId) return;
  try {
    const mem = await fetchMemory(accountId);
    document.getElementById('memoryView').textContent = JSON.stringify(mem, null, 2);
  } catch (e) {
    document.getElementById('memoryView').textContent = 'Error loading memory';
  }
}

async function setGoal() {
  const sel = document.getElementById('accountSelect');
  const accountId = sel.value;
  const goal = document.getElementById('goalInput').value.trim();
  const statusEl = document.getElementById('status');
  if (!accountId || !goal) {
    statusEl.textContent = 'Select an account and enter a goal.';
    return;
  }
  try {
    const res = await fetch('/api/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, goal }),
    });
    const data = await res.json();
    statusEl.textContent = data.message || 'Goal set!';
  } catch (e) {
    statusEl.textContent = 'Failed to set goal.';
  }
}

async function init() {
  const accounts = await fetchAccounts();
  const sel = document.getElementById('accountSelect');
  sel.innerHTML = accounts.map(a => `<option value="${a}">${a}</option>`).join('');
  if (accounts.length > 0) await loadMemoryView();
}

// Poll every 2 seconds
init();
setInterval(loadMemoryView, 2000);
