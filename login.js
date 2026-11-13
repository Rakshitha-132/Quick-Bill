"use strict";

const DEMO_EMAIL = "demo@quickbill.app";
const DEMO_PASSWORD = "quickbill-demo";
const DEMO_SESSION_KEY = "quickbill.demo-session";

if (sessionStorage.getItem(DEMO_SESSION_KEY) === "authenticated") {
    window.location.replace("index.html");
}

document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const feedback = document.getElementById("loginFeedback");

    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        feedback.textContent = "Those details do not match the demo account. Use the credentials shown below.";
        feedback.classList.add("error");
        return;
    }

    sessionStorage.setItem(DEMO_SESSION_KEY, "authenticated");
    window.location.replace("index.html");
});
