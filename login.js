const loginForm = document.getElementById("loginForm");
const authMessage = document.getElementById("authMessage");
const redirectTarget = new URLSearchParams(window.location.search).get("redirect");
const isAdminLogin = new URLSearchParams(window.location.search).get("admin") === "1";
const redirectPath = isAdminLogin ? "/admin.html" : (redirectTarget && redirectTarget.startsWith("/") && !redirectTarget.startsWith("//") && redirectTarget !== "/auth.html" && redirectTarget !== "/login.html" ? redirectTarget : "/index.html");

const showMessage = (message) => {
    authMessage.textContent = message;
    authMessage.hidden = false;
};

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm));

    try {
        const response = await fetch(isAdminLogin ? "/api/admin/login" : "/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.error || "Unable to log in.");
        }

        window.location.assign(redirectPath);
    } catch (error) {
        showMessage(error.message);
    }
});
