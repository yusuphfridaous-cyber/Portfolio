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
