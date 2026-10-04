<script>
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PUBLIC_GOOGLE_SIGN_IN_ENABLED } from '$app/env/public';
	import { mutation, reason } from '#lib/api.js';
	import { auth, whenAuthed } from '#lib/auth.svelte.js';
	import { editorUrl } from '#lib/login-return.js';
	import { clerkMessage, resendCode, sendCode, verifyCode, withGoogle } from '#lib/signin.js';
	import { Cat, I, catLogo, fmtSec, handleCheck, toast } from '#lib/engine/util.js';

	const CLAIM_KEY = 'bento.cat/claim';
	const DIGITS = 6;
	const shake = el => el?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 280 });

	// wait → email → code → done, or pick when you're signed in without a box.
	let step = $state('wait');
	let claim = $state('');
	let email = $state('');
	let mode = 'signIn';
	let busy = $state(false);
	let err = $state('');
	let doneTitle = $state('');

	let emailForm = $state();
	let emailInput = $state();
	let codeEl = $state();
	let inputs = $state([]);
	let codeState = $state('');
	let left = $state(30);
	let resendT;

	let pick = $state('');
	let pickRes = $state({ state: 'empty', msg: '' });
	let pickForm = $state();
	let pickT, pickSeq = 0;

	const until = (ok, ms = 12000) => new Promise(resolve => {
		const t0 = Date.now();
		const loop = () => (ok() || Date.now() - t0 > ms ? resolve(ok()) : setTimeout(loop, 80));
		loop();
	});

	async function goEmail() {
		step = 'email';
		err = '';
		await tick();
		emailInput?.focus();
	}

	async function submitEmail(e) {
		e.preventDefault();
		const v = email.trim();
		if (!/^\S+@\S+\.\S+$/.test(v)) { emailInput.focus(); return shake(emailForm); }
		busy = true;
		err = '';
		try {
			mode = await sendCode(v);
			email = v;
			await goCode();
		} catch (x) {
			err = clerkMessage(x);
			shake(emailForm);
		} finally {
			busy = false;
		}
	}

	async function google() {
		busy = true;
		try { await withGoogle(page.url.searchParams.get('open')); } catch (x) { err = clerkMessage(x); busy = false; }
	}

	/* ---------- six digits ---------- */

	async function goCode() {
		step = 'code';
		codeState = '';
		err = '';
		await tick();
		inputs.forEach(i => (i.value = ''));
		inputs[0]?.focus();
		countdown(30);
	}

	function countdown(s) {
		clearTimeout(resendT);
		left = s;
		const run = () => { if (left > 0) { resendT = setTimeout(() => { left--; run(); }, 1000); } };
		run();
	}

	async function again() {
		try {
			await resendCode(mode);
			toast('Sent another. Peek in spam too.');
			countdown(30);
		} catch (x) { err = clerkMessage(x); }
	}

	function fill(start, digits) {
		digits.split('').forEach((d, k) => { if (inputs[start + k]) inputs[start + k].value = d; });
		const next = inputs.find(i => !i.value);
		if (next) next.focus();
		else submitCode();
	}

	function onDigit(i, e) {
		const d = e.target.value.replace(/\D/g, '');
		e.target.value = '';
		if (codeState === 'bad') { codeState = ''; err = ''; }
		if (d) fill(i, d.slice(0, DIGITS - i));
	}

	function onKey(i, e) {
		if (e.key === 'Backspace' && !inputs[i].value && i > 0) { inputs[i - 1].value = ''; inputs[i - 1].focus(); e.preventDefault(); }
		if (e.key === 'ArrowLeft' && i > 0) inputs[i - 1].focus();
		if (e.key === 'ArrowRight' && i < DIGITS - 1) inputs[i + 1].focus();
	}

	function onPaste(e) {
		e.preventDefault();
		const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, DIGITS);
		if (d) fill(0, d);
	}

	async function submitCode() {
		const code = inputs.map(i => i.value).join('');
		if (code.length < DIGITS || busy) return;
		busy = true;
		inputs.forEach(i => i.blur());
		try {
			await verifyCode(mode, code);
			codeState = 'ok';
			Cat.mood('happy');
			await afterSignIn();
		} catch (x) {
			// A wrong code tints the boxes paw pink, gives them a shake and clears them.
			codeState = 'bad';
			err = clerkMessage(x);
			Cat.mood('open');
			shake(codeEl);
			setTimeout(() => { inputs.forEach(i => (i.value = '')); inputs[0]?.focus(); }, 420);
		} finally {
			busy = false;
		}
	}

	// The cat shuts its eyes while you type a code.
	const codeFocus = () => { if (codeState !== 'ok') Cat.mood('closed'); };
	const codeBlur = () => setTimeout(() => { if (!codeEl?.contains(document.activeElement) && codeState !== 'ok') Cat.mood('open'); });

	/* ---------- after signing in ---------- */

	async function afterSignIn() {
		const ready = await until(() => auth.me?.signedIn && auth.me.ready);
		if (!ready) { err = 'Signed in, but your box is taking a while. Refresh in a moment.'; step = 'email'; return; }
		if (auth.me.box) return open(`Welcome back${auth.me.box.name ? ', ' + auth.me.box.name.split(' ')[0] : ''}`);
		if (claim) {
			const r = await handleCheck(claim, null);
			if (r.state === 'free') return claimIt(claim);
		}
		return goPick(claim ? `bento.cat/${claim} just got taken. Pick another?` : '');
	}

	async function claimIt(handle) {
		try {
			const r = await mutation('boxes:claim', { handle });
			sessionStorage.removeItem(CLAIM_KEY);
			return open(r.existing ? `bento.cat/${r.handle} is still yours` : `bento.cat/${r.handle} is yours`);
		} catch (x) {
			return goPick(reason(x));
		}
	}

	async function open(title) {
		doneTitle = title;
		step = 'done';
		Cat.mood('happy');
		setTimeout(() => goto(editorUrl(page.url.searchParams.get('open')), { replaceState: true }), 900);
	}

	async function goPick(msg = '') {
		step = 'pick';
		err = msg;
		pick = claim || pick;
		Cat.mood('open');
		if (pick) checkPick();
		await tick();
		pickForm?.querySelector('input')?.focus();
	}

	async function checkPick() {
		const n = ++pickSeq;
		const r = await handleCheck(pick, null);
		if (n === pickSeq) pickRes = r;
		return r;
	}

	function onPick() {
		pick = pick.toLowerCase().replace(/\s/g, '');
		err = '';
		clearTimeout(pickT);
		pickT = setTimeout(checkPick, 220);
	}

	async function submitPick(e) {
		e.preventDefault();
		clearTimeout(pickT);
		const r = await checkPick();
		if (r.state !== 'free') { pickForm.querySelector('input').focus(); return shake(pickForm); }
		busy = true;
		await claimIt(pick.trim());
		busy = false;
	}

	onMount(() => {
		const q = page.url.searchParams;
		const fromUrl = (q.get('claim') || '').trim().toLowerCase();
		if (fromUrl) sessionStorage.setItem(CLAIM_KEY, fromUrl);
		claim = fromUrl || (q.get('step') === 'after' ? sessionStorage.getItem(CLAIM_KEY) || '' : '');
		if (!fromUrl && q.get('step') !== 'after') sessionStorage.removeItem(CLAIM_KEY);

		whenAuthed().then(async me => {
			if (me?.signedIn) return afterSignIn();
			if (claim) {
				const r = await handleCheck(claim, null);
				if (r.state !== 'free') claim = '';
			}
			goEmail();
		});
		return () => { clearTimeout(resendT); clearTimeout(pickT); Cat.mood('open'); };
	});
</script>

<svelte:head><title>{claim ? `Claim bento.cat/${claim}` : 'Log in'} — bento.cat</title></svelte:head>

<div class="auth">
	<a class="auth-brand" href="/">{@html catLogo(26)}<span>bento.cat</span></a>
	<div class="auth-card" class:wait={step === 'wait'}>
		{@html catLogo(64, { live: true })}

		{#if step === 'wait'}
			<div class="auth-h"><h2>One moment</h2><p>Checking if you’re already in.</p></div>
		{:else if step === 'email'}
			<div class="auth-h">
				<h2>{claim ? `Claim bento.cat/${claim}` : 'Welcome back'}</h2>
				<p>{claim ? 'Where should we send your sign-in code?' : 'We’ll email you six digits. No passwords to forget.'}</p>
			</div>
			<form class="auth-form" novalidate bind:this={emailForm} onsubmit={submitEmail}>
				<input bind:this={emailInput} bind:value={email} type="email" name="email" placeholder="you@example.com" aria-label="Email address" autocomplete="email" disabled={busy} />
				<button class="btn btn-dark wide" disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
			</form>
			{#if err}<p class="auth-err" role="alert">{err}</p>{/if}
			{#if PUBLIC_GOOGLE_SIGN_IN_ENABLED !== 'false'}
				<div class="or"><span>or</span></div>
				<button class="btn btn-line wide" onclick={google} disabled={busy}>{@html I.google()} Continue with Google</button>
			{/if}
			{#if !claim}<p class="auth-alt">New here? Same field. We’ll make you a box.</p>{/if}
		{:else if step === 'code'}
			<div class="auth-h"><h2>Check your email</h2><p>We sent six digits to {email}</p></div>
			<div class="code six" class:ok={codeState === 'ok'} class:bad={codeState === 'bad'} bind:this={codeEl} onfocusin={codeFocus} onfocusout={codeBlur}>
				{#each Array(DIGITS) as _, i}
					<input bind:this={inputs[i]} inputmode="numeric" autocomplete="one-time-code" aria-label="Digit {i + 1}" disabled={busy || codeState === 'ok'} oninput={e => onDigit(i, e)} onkeydown={e => onKey(i, e)} onpaste={onPaste} />
				{/each}
			</div>
			{#if err}<p class="auth-err" role="alert">{err}</p>{/if}
			<p class="resend">
				{#if left > 0}No email? Send another in {fmtSec(left)}{:else}No email? <button class="link-btn" onclick={again}>Send another</button>{/if}
			</p>
			<button class="auth-back" onclick={goEmail}>Use a different email</button>
		{:else if step === 'pick'}
			<div class="auth-h"><h2>Pick your address</h2><p>This is where your box will live. You can change it later.</p></div>
			<form class="auth-form" novalidate bind:this={pickForm} onsubmit={submitPick}>
				<label class="auth-handle" data-state={pickRes.state}>
					<span>bento.cat/</span>
					<input bind:value={pick} oninput={onPick} placeholder="yourname" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Pick your address" disabled={busy} />
					<i class="claim-ok">{@html I.check('#161616', 14, 2.2)}</i>
				</label>
				<button class="btn btn-dark wide" disabled={busy}>{busy ? 'Claiming…' : 'Claim it'}</button>
			</form>
			<p class="auth-note" data-state={err ? 'taken' : pickRes.state}>
				{#if err}{err}{:else if pickRes.state === 'empty'}Letters, numbers, dots and dashes.{:else}{pickRes.msg}{#if pickRes.alt}{' '}<button type="button" class="chip-btn" onclick={() => { pick = pickRes.alt; checkPick(); }}>{pickRes.alt}</button>{/if}{/if}
			</p>
		{:else if step === 'done'}
			<div class="auth-h"><h2>{doneTitle}</h2><p>Opening your box…</p></div>
		{/if}
	</div>
	<!-- Clerk's bot check renders here during sign-up. -->
	<div id="clerk-captcha"></div>
	<p class="auth-foot">By signing in you agree to our <a href="/terms">terms</a> and to be nice to the cats. Read our <a href="/privacy">privacy policy</a>.</p>
</div>
