function toggleTheme() {
    const body = document.body;
    const themeButton = document.querySelector(".theme-toggle");
    body.classList.toggle("dark-theme");

    themeButton.textContent = body.classList.contains("dark-theme")
        ? "Light Mode"
        : "Dark Mode";
}

function openTab(evt, tabName) {
    const tabcontent = document.querySelectorAll(".tabcontent");
    const tablinks = document.querySelectorAll(".tablink");

    tabcontent.forEach(tab => tab.style.display = "none");
    tablinks.forEach(link => link.classList.remove("active"));

    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
}

document.addEventListener("DOMContentLoaded", () => {
    // Open the first tab by default
    document.querySelector(".tablink").click();

    // Auto set theme based on preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
        document.body.classList.add("dark-theme");
        document.querySelector(".theme-toggle").textContent = "Light Mode";
    }
});
