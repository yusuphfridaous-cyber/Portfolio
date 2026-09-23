const signupTab = document.getElementById("signupTab");
const loginTab = document.getElementById("loginTab");
const signupForm = document.getElementById("signupForm");
const loginForm = document.getElementById("loginForm");
const signupToLogin = document.getElementById("signupToLogin");
const loginToSignup = document.getElementById("loginToSignup");
const authTabs = document.querySelector(".auth-tabs");
const authTitle = document.getElementById("authTitle");
const authIntro = document.getElementById("authIntro");
const authMessage = document.getElementById("authMessage");
const redirectTarget = new URLSearchParams(window.location.search).get("redirect");
const redirectPath = redirectTarget && redirectTarget.startsWith("/") && !redirectTarget.startsWith("//") && redirectTarget !== "/auth.html" ? redirectTarget : "/index.html";
const hasSignupUi = Boolean(signupForm && authTabs && signupTab && loginTab && authTitle && authIntro);

const showMessage = (message) => {
    authMessage.textContent = message;
    authMessage.hidden = false;
};

const setMode = (mode) => {
    if (!hasSignupUi) return;
    const signupMode = mode === "signup";
    signupForm.hidden = !signupMode;
    if (loginForm) loginForm.hidden = signupMode;
    authTabs.hidden = false;
    signupTab.classList.toggle("active", signupMode);
    loginTab.classList.toggle("active", !signupMode);
    signupTab.setAttribute("aria-selected", String(signupMode));
    loginTab.setAttribute("aria-selected", String(!signupMode));
    authTitle.textContent = signupMode ? "Welcome to my website" : "Welcome back";
    authIntro.textContent = signupMode ? "Create an account to enter the site." : "Log in to continue to the site.";
    if (authMessage) authMessage.hidden = true;
};

const submitAuth = async (form, endpoint) => {
    const data = Object.fromEntries(new FormData(form));
    if (endpoint === "/api/auth/signup") {
        if (data.password !== data.confirmPassword) {
            throw new Error("Passwords do not match.");
        }
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to access the website.");
    window.location.assign(redirectPath);
};

if (signupTab) signupTab.addEventListener("click", () => setMode("signup"));
if (loginTab) loginTab.addEventListener("click", () => setMode("login"));
if (signupToLogin) signupToLogin.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.href = "/login.html";
});
if (loginToSignup) loginToSignup.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.href = "/auth.html";
});
if (signupForm) signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await submitAuth(signupForm, "/api/auth/signup"); } catch (error) { showMessage(error.message); }
});
if (loginForm) loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await submitAuth(loginForm, "/api/auth/login"); } catch (error) { showMessage(error.message); }
});
if (hasSignupUi) setMode("signup");
