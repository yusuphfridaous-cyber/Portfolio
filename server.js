const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
}

const publicDirectory = __dirname;
const port = Number(process.env.PORT) || 3000;
const adminPassword = process.env.ADMIN_PASSWORD;
const usersFile = path.join(__dirname, "users.json");
const analyticsFile = path.join(__dirname, "analytics.json");
const sessions = new Map();
const siteSessions = new Map();
const pendingVerifications = new Map();
const loginAttempts = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpPassword = (process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");
const mailTransporter = process.env.SMTP_HOST && process.env.SMTP_USER && smtpPassword ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: process.env.SMTP_USER, pass: smtpPassword }
}) : null;
const emailProvider = ((process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER.toLowerCase()) || (mailTransporter ? "smtp" : "resend")).toLowerCase();
const emailVerificationConfigured = emailProvider === "resend"
    ? Boolean(process.env.RESEND_API_KEY)
    : Boolean(mailTransporter);
const verificationFromAddress = process.env.EMAIL_FROM || process.env.SMTP_USER || "onboarding@resend.dev";
const accessNotificationRecipient = process.env.EMAIL_NOTIFICATION_TO || process.env.SMTP_USER;
const monitoredPages = new Set(["/about.html", "/projects.html", "/contact.html"]);

const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

const sendJson = (response, statusCode, payload, headers = {}) => {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
    response.end(JSON.stringify(payload));
};

const getCookies = (request) => Object.fromEntries((request.headers.cookie || "").split("; ").filter(Boolean).map((cookie) => {
    const separator = cookie.indexOf("=");
    return [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
}));

const getSession = (request) => {
    const sessionId = getCookies(request).admin_session;
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
        if (sessionId) sessions.delete(sessionId);
        return null;
    }
    return session;
};

const readRequestBody = (request) => new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10_000) request.destroy();
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
});

const readUsers = () => {
    try {
        return JSON.parse(fs.readFileSync(usersFile, "utf8"));
    } catch (error) {
        return [];
    }
};

const writeUsers = (users) => fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

const readAnalytics = () => {
    try { return JSON.parse(fs.readFileSync(analyticsFile, "utf8")); }
    catch (error) { return []; }
};

const writeAnalytics = (events) => fs.writeFileSync(analyticsFile, JSON.stringify(events.slice(-2000), null, 2));

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
});

const verifyPassword = (password, storedHash) => new Promise((resolve) => {
    const [salt, expectedHex] = storedHash.split(":");
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) return resolve(false);
        const expected = Buffer.from(expectedHex, "hex");
        resolve(expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey));
    });
});

const hashVerificationCode = (email, code) => crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");

const sendVerificationEmail = (email, code) => {
    if (emailProvider === "resend") {
        if (!process.env.RESEND_API_KEY) throw new Error("Resend is not configured.");
        return fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                from: verificationFromAddress,
                to: [email],
                subject: "Your website verification code",
                text: `Your verification code is ${code}. It expires in 10 minutes.`,
                html: `<p>Your verification code is:</p><p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p><p>This code expires in 10 minutes.</p>`
            })
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Resend returned ${response.status}.`);
            return response.json();
        });
    }
    if (!mailTransporter) throw new Error("SMTP is not configured.");
    return mailTransporter.sendMail({
        from: verificationFromAddress,
        to: email,
        subject: "Your website verification code",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
        html: `<p>Your verification code is:</p><p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p><p>This code expires in 10 minutes.</p>`
    });
};

const sendAccessNotification = (page, user) => {
    if (!accessNotificationRecipient) return Promise.resolve();
    const visitor = user ? `${user.name} (${user.email})` : "an authenticated visitor";
    const subject = `Website access: ${page.replace(".html", "")}`;
    const text = `${visitor} opened ${page} at ${new Date().toISOString()}.`;
    if (emailProvider === "resend" && process.env.RESEND_API_KEY) {
        return fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: verificationFromAddress, to: [accessNotificationRecipient], subject, text })
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Resend returned ${response.status}.`);
            return response.json();
        });
    }
    if (!mailTransporter) return Promise.resolve();
    return mailTransporter.sendMail({ from: verificationFromAddress, to: accessNotificationRecipient, subject, text });
};

const createSessionCookie = (name, value, request) => {
    const isHttps = request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
    return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax${isHttps ? "; Secure" : ""}`;
};

const createSiteSession = (userId, rememberMe = false) => {
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = rememberMe ? Date.now() + 30 * 24 * 60 * 60 * 1000 : Date.now() + sessionDuration;
    siteSessions.set(sessionId, { userId, expiresAt });
    return sessionId;
};

const getSiteSession = (request) => {
    const sessionId = getCookies(request).site_session;
    const session = siteSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
        if (sessionId) siteSessions.delete(sessionId);
        return null;
    }
    return session;
};

const publicFiles = new Set([
    "/index.html", "/auth.html", "/login.html", "/auth.js", "/login.js", "/script.js", "/style.css",
    "/Fridaous Yusuph.jpeg", "/image-removebg-preview.png", "/IMG-20260818-WA0115.jpg", "/mine.png"
]);

const passwordsMatch = (providedPassword) => {
    if (!adminPassword || typeof providedPassword !== "string") return false;
    const provided = Buffer.from(providedPassword);
    const expected = Buffer.from(adminPassword);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
};

const isRateLimited = (ip) => {
    const attempt = loginAttempts.get(ip);
    if (!attempt || attempt.resetAt < Date.now()) {
        loginAttempts.set(ip, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
        return false;
    }
    return attempt.count >= 10;
};

const recordFailedAttempt = (ip) => {
    const attempt = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
};

const serveFile = (request, response, pathname) => {
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const siteSession = getSiteSession(request);
    if (requestedPath.split("/").some((segment) => segment.startsWith("."))) {
        response.writeHead(404);
        response.end("Not found");
        return;
    }
    if (requestedPath === "/admin.html" && !getSession(request)) {
        response.writeHead(302, { Location: "/login.html?admin=1" });
        response.end();
        return;
    }
    if (!publicFiles.has(requestedPath) && requestedPath !== "/admin.html" && !siteSession) {
        response.writeHead(302, { Location: `/auth.html?redirect=${encodeURIComponent(requestedPath)}` });
        response.end();
        return;
    }
    const filePath = path.resolve(publicDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    if (siteSession && request.method === "GET" && monitoredPages.has(requestedPath)) {
        const user = readUsers().find((candidate) => candidate.id === siteSession.userId);
        sendAccessNotification(requestedPath.slice(1), user).catch((error) => console.error("Access notification failed:", error.message));
    }

    fs.readFile(filePath, (error, file) => {
        if (error) {
            response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(error.code === "ENOENT" ? "Not found" : "Server error");
            return;
        }
        response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
        response.end(file);
    });
};

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const clientIp = request.socket.remoteAddress || "unknown";

    if (requestUrl.pathname === "/api/admin/login" && request.method === "POST") {
        if (isRateLimited(clientIp)) {
            sendJson(response, 429, { error: "Too many attempts. Try again later." });
            return;
        }
        let body;
        try {
            body = JSON.parse(await readRequestBody(request));
        } catch (error) {
            sendJson(response, 400, { error: "Invalid request." });
            return;
        }
        if (!passwordsMatch(body.password)) {
            recordFailedAttempt(clientIp);
            sendJson(response, 401, { error: "Incorrect password." });
            return;
        }
        const sessionId = crypto.randomBytes(32).toString("hex");
        sessions.set(sessionId, { expiresAt: Date.now() + sessionDuration });
        loginAttempts.delete(clientIp);
        sendJson(response, 200, { authenticated: true }, { "Set-Cookie": createSessionCookie("admin_session", sessionId, request) });
        return;
    }

    if (requestUrl.pathname === "/api/auth/signup" && request.method === "POST") {
        let body;
        try {
            body = JSON.parse(await readRequestBody(request));
        } catch (error) {
            sendJson(response, 400, { error: "Invalid request." });
            return;
        }
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
        if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
            sendJson(response, 400, { error: "Use a name, valid email, and password of at least 8 characters." });
            return;
        }
        if (password !== confirmPassword) {
            sendJson(response, 400, { error: "Passwords do not match." });
            return;
        }
        if (!emailVerificationConfigured) {
            sendJson(response, 503, { error: "Email verification is not configured yet. Add SMTP settings or Resend credentials to .env." });
            return;
        }
        const users = readUsers();
        if (users.some((user) => user.email === email)) {
            sendJson(response, 409, { error: "An account with that email already exists." });
            return;
        }
        const code = crypto.randomInt(100000, 1000000).toString();
        console.log(`[VERIFY] code for ${email}: ${code}`);
        pendingVerifications.set(email, {
            name,
            email,
            passwordHash: await hashPassword(password),
            codeHash: hashVerificationCode(email, code),
            attempts: 0,
            expiresAt: Date.now() + 10 * 60 * 1000
        });
        try {
            await sendVerificationEmail(email, code);
        } catch (error) {
            pendingVerifications.delete(email);
            console.error("Verification email failed:", error.message);
            sendJson(response, 502, {
                error: `We could not send the verification email: ${error.message || "Check the email address and try again."}`
            });
            return;
        }
        sendJson(response, 202, { verificationRequired: true, email });
        return;
    }

    if (requestUrl.pathname === "/api/auth/verify" && request.method === "POST") {
        let body;
        try {
            body = JSON.parse(await readRequestBody(request));
        } catch (error) {
            sendJson(response, 400, { error: "Invalid request." });
            return;
        }
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const code = typeof body.code === "string" ? body.code.trim() : "";
        const pending = pendingVerifications.get(email);
        if (!pending || pending.expiresAt < Date.now()) {
            pendingVerifications.delete(email);
            sendJson(response, 400, { error: "That code has expired. Please sign up again." });
            return;
        }
        if (pending.attempts >= 5 || code.length !== 6 || hashVerificationCode(email, code) !== pending.codeHash) {
            pending.attempts += 1;
            if (pending.attempts >= 5) pendingVerifications.delete(email);
            sendJson(response, 400, { error: "That verification code is not correct." });
            return;
        }
        const users = readUsers();
        const user = { id: crypto.randomUUID(), name: pending.name, email, passwordHash: pending.passwordHash, createdAt: new Date().toISOString() };
        users.push(user);
        writeUsers(users);
        pendingVerifications.delete(email);
        const sessionId = createSiteSession(user.id);
        sendJson(response, 201, { authenticated: true, user: { name: user.name, email } }, { "Set-Cookie": createSessionCookie("site_session", sessionId, request) });
        return;
    }

    if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
        let body;
        try {
            body = JSON.parse(await readRequestBody(request));
        } catch (error) {
            sendJson(response, 400, { error: "Invalid request." });
            return;
        }
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const rememberMe = body.rememberMe === true || body.rememberMe === "true";
        const user = readUsers().find((candidate) => candidate.email === email);
        if (!user || !(await verifyPassword(body.password || "", user.passwordHash))) {
            sendJson(response, 401, { error: "Incorrect email or password." });
            return;
        }
        const sessionId = createSiteSession(user.id, rememberMe);
        sendJson(response, 200, { authenticated: true, user: { name: user.name, email: user.email } }, { "Set-Cookie": createSessionCookie("site_session", sessionId, request) });
        return;
    }

    if (requestUrl.pathname === "/api/auth/session" && request.method === "GET") {
        const session = getSiteSession(request);
        const user = session && readUsers().find((candidate) => candidate.id === session.userId);
        sendJson(response, user ? 200 : 401, user ? { authenticated: true, user: { name: user.name, email: user.email } } : { authenticated: false });
        return;
    }

    if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
        const sessionId = getCookies(request).site_session;
        siteSessions.delete(sessionId);
        sendJson(response, 200, { authenticated: false }, { "Set-Cookie": "site_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" });
        return;
    }

    if (requestUrl.pathname === "/api/admin/session" && request.method === "GET") {
        const authenticated = Boolean(getSession(request));
        sendJson(response, authenticated ? 200 : 401, { authenticated });
        return;
    }

    if (requestUrl.pathname === "/api/analytics/track" && request.method === "POST") {
        let body;
        try { body = JSON.parse(await readRequestBody(request)); } catch (error) { sendJson(response, 400, { error: "Invalid request." }); return; }
        const allowedTypes = new Set(["page_view", "click", "form_submit"]);
        if (!allowedTypes.has(body.type)) { sendJson(response, 400, { error: "Invalid activity type." }); return; }
        const events = readAnalytics();
        events.push({ type: body.type, page: String(body.page || "unknown").slice(0, 120), label: String(body.label || "").slice(0, 80), timestamp: new Date().toISOString(), sessionId: String(body.sessionId || "unknown").slice(0, 80) });
        writeAnalytics(events);
        sendJson(response, 202, { recorded: true });
        return;
    }

    if (requestUrl.pathname === "/api/admin/analytics" && request.method === "GET") {
        if (!getSession(request)) { sendJson(response, 401, { error: "Admin authentication required." }); return; }
        sendJson(response, 200, { activity: readAnalytics() });
        return;
    }

    if (requestUrl.pathname === "/api/admin/users" && request.method === "GET") {
        if (!getSession(request)) {
            sendJson(response, 401, { error: "Admin authentication required." });
            return;
        }
        const users = readUsers().map(({ name, email, createdAt }) => ({ name, email, createdAt }));
        sendJson(response, 200, { users });
        return;
    }

    if (requestUrl.pathname === "/api/admin/logout" && request.method === "POST") {
        const sessionId = getCookies(request).admin_session;
        sessions.delete(sessionId);
        sendJson(response, 200, { authenticated: false }, { "Set-Cookie": "admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" });
        return;
    }

    serveFile(request, response, requestUrl.pathname);
});

server.listen(port, () => {
    console.log(`Site running at http://localhost:${port}`);
});

setInterval(() => {
    for (const [sessionId, session] of sessions) {
        if (session.expiresAt < Date.now()) sessions.delete(sessionId);
    }
    for (const [sessionId, session] of siteSessions) {
        if (session.expiresAt < Date.now()) siteSessions.delete(sessionId);
    }
    for (const [email, verification] of pendingVerifications) {
        if (verification.expiresAt < Date.now()) pendingVerifications.delete(email);
    }
}, 60 * 60 * 1000).unref();
