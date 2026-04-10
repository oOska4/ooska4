function openTab(evt, name) {
  document.querySelectorAll('.tabcontent').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tablink').forEach(l => l.classList.remove('active'));
  const section = document.getElementById(name);
  section.classList.add('active');
  void section.offsetWidth; // force reflow to retrigger animation
  evt.currentTarget.classList.add('active');
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('theme-btn').textContent = isLight ? 'Dark Mode' : 'Light Mode';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (saved === 'light' || (!saved && !prefersDark)) {
    document.body.classList.add('light');
    document.getElementById('theme-btn').textContent = 'Dark Mode';
  }

  document.querySelector('.tablink').click();
});
