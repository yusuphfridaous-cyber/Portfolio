  (() => {
	const supportsFinePointer = window.matchMedia('(pointer: fine)').matches;
	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (!supportsFinePointer || prefersReducedMotion) {
		return;
	}

	const dot = document.createElement('span');
	const ring = document.createElement('span');
	dot.className = 'cursor-dot';
	ring.className = 'cursor-ring';
	document.body.append(dot, ring);
	document.body.classList.add('cursor-ready');

	let animationFrame;
	let pointerX = -100;
	let pointerY = -100;
	let ringX = pointerX;
	let ringY = pointerY;

	const render = () => {
		dot.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0)`;
		ringX += (pointerX - ringX) * 0.16;
		ringY += (pointerY - ringY) * 0.16;
		ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
		animationFrame = requestAnimationFrame(render);
	};

	document.addEventListener('pointermove', (event) => {
		pointerX = event.clientX;
		pointerY = event.clientY;
		document.body.classList.add('cursor-visible');
	});

	document.addEventListener('pointerover', (event) => {
		if (event.target.closest('a, button, input, textarea, select')) {
			document.body.classList.add('cursor-hover');
		}
	});

	document.addEventListener('pointerout', (event) => {
		if (event.target.closest('a, button, input, textarea, select')) {
			document.body.classList.remove('cursor-hover');
		}
	});

	document.addEventListener('mouseleave', () => {
		document.body.classList.remove('cursor-visible');
	});

	render();
	window.addEventListener('pagehide', () => cancelAnimationFrame(animationFrame));
})();

const themeBtn = document.getElementById("themeBtn");

if (themeBtn) {
themeBtn.addEventListener("click", function () {

    document.body.classList.toggle("light-mode");

    if (document.body.classList.contains("light-mode")) {
        themeBtn.textContent = "🌙 Dark Mode";
    } else {
        themeBtn.textContent = "☀️ Light Mode";
    }

});
}

const analyticsSiteCode = "YOUR-GOATCOUNTER-SITE-CODE";
window.analyticsSiteCode = analyticsSiteCode;

const activityStorageKey = "fridaous-site-activity";
const sessionStorageKey = "fridaous-site-session";

const getActivity = () => {
	try {
		return JSON.parse(localStorage.getItem(activityStorageKey) || "[]");
	} catch (error) {
		return [];
	}
};

const recordActivity = (type, details = {}) => {
	try {
		const activity = getActivity();
		activity.push({
			type,
			path: window.location.pathname.split("/").pop() || "home.html",
			label: details.label || "",
			timestamp: new Date().toISOString(),
			sessionId: sessionStorage.getItem(sessionStorageKey) || "unknown"
		});
		localStorage.setItem(activityStorageKey, JSON.stringify(activity.slice(-500)));
	} catch (error) {
		// Analytics must never interfere with the website experience.
	}
};

if (!sessionStorage.getItem(sessionStorageKey)) {
	sessionStorage.setItem(sessionStorageKey, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

if (window.location.pathname.split("/").pop() !== "admin.html") {
	recordActivity("page_view");
	document.addEventListener("click", (event) => {
		const target = event.target.closest("a, button");
		if (!target || target.id === "themeBtn") return;
		recordActivity("click", {
			label: target.textContent.trim().replace(/\s+/g, " ").slice(0, 80) || target.getAttribute("href") || "button"
		});
	});
	document.addEventListener("submit", (event) => {
		if (event.target.matches("form")) recordActivity("form_submit", { label: "Contact form" });
	});
}

window.siteAnalytics = {
	activityStorageKey,
	getActivity,
	recordActivity
};

const dashboardLink = document.getElementById("dashboardLink");

if (dashboardLink && analyticsSiteCode !== "YOUR-GOATCOUNTER-SITE-CODE") {
	dashboardLink.href = `https://${analyticsSiteCode}.goatcounter.com`;
	dashboardLink.textContent = "Open private visitor dashboard";
}

if (analyticsSiteCode !== "YOUR-GOATCOUNTER-SITE-CODE") {
	const analyticsScript = document.createElement("script");
	analyticsScript.async = true;
	analyticsScript.src = "https://gc.zgo.at/count.js";
	analyticsScript.dataset.goatcounter = `https://${analyticsSiteCode}.goatcounter.com/count`;
	document.head.appendChild(analyticsScript);
}
