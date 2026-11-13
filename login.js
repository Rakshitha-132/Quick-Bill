"use strict";

const DEMO_SESSION_KEY = "quickbill.demo-session";

if (sessionStorage.getItem(DEMO_SESSION_KEY) === "authenticated") {
    window.location.replace("index.html");
}

document.getElementById("openDemo").addEventListener("click", () => {
    sessionStorage.setItem(DEMO_SESSION_KEY, "authenticated");
    window.location.replace("index.html");
});
