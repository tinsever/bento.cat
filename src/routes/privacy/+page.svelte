<script>
	import LegalPage from '#lib/components/LegalPage.svelte';
	import { OPERATOR as O } from '#lib/legal.js';
</script>

<LegalPage title="Privacy" lede="What bento.cat keeps about you, why, and what you can do about it.">
	<h2>The short version</h2>
	<ul>
		<li>No ads or tracking pixels. We count page views without identifying visitors and without storing anything in your browser. We don’t sell or rent anything about you.</li>
		<li>If you have a box, we keep what you put in it and the email you sign in with.</li>
		<li>If you’re signed in and have a box, the owners of boxes you open can see your box among their visitors. You can turn that off in your page settings.</li>
		<li>You can download everything in your box, or delete it, from the editor at any time.</li>
	</ul>

	<h2>Who is responsible</h2>
	<p>{[O.name, ...O.address].join(', ')}. Email <a href="mailto:{O.email}">{O.email}</a>. See the <a href="/imprint">imprint</a>. Write to that address for anything on this page.</p>

	<h2>When you open any page</h2>
	<p>Your browser sends your IP address, the page you asked for, the time and your browser’s user agent. Our host, Prepaid-Hoster.de, uses this to deliver the page and may keep it in short-lived server logs to keep the service running and secure. Each page also connects to our database provider (Convex) and our sign-in provider (Clerk) to load boxes and check whether you’re signed in, so they see your IP address too.</p>
	<p>Legal basis: our legitimate interest in running a working, secure website (Art. 6 (1) (f) GDPR).</p>

	<h3>What your browser stores</h3>
	<ul>
		<li><b>A temporary interaction key and reactions</b> in this tab’s memory, so purrs and sign-ups work. They disappear when the page reloads; we don’t save them in browser storage.</li>
		<li><b>The tiles you purred</b> in local storage, written only when you tap a purr, so a reload doesn’t count the same purr twice. It lists box addresses and tile names, contains no identifier and is never sent to us. Clearing your browser’s site data removes it.</li>
		<li><b>Sign-in cookies</b> set by Clerk, which keep you signed in.</li>
	</ul>
	<p>The list of purred tiles and sign-in cookies support the features you request (§ 25 (2) no. 2 TDDDG). We don’t use advertising or statistics cookies. If your browser still holds a statistics key from our earlier opt-in visit records, we use it once to delete the visits recorded under it, then remove it.</p>

	<h2>When you visit someone’s box</h2>
	<ul>
		<li><b>Anonymous page views.</b> Our server adds one to a box’s total, and to that box’s count for the current hour, when its page loads. Only the box, the hour and the counts are stored; no visitor key, account, IP address or individual view time is stored with them. Hourly counts are kept for 30 days and show the owner when people come by. This uses no browser storage and requires no opt-in. Repeat loads, the owner’s own views and automated requests may count too, so this is not a count of unique people. Totals help rank boxes on Explore and are shown to the owner.</li>
		<li><b>Visits by people with a box.</b> If you’re signed in and have a box of your own, we record that your box visited and when, at most once every half hour per box. For 30 days the owner can see your box’s name, address and picture among the people who came by. Turn off “Show my box when I visit” in your page settings to stop this; it also deletes the visits already recorded for your box. If you aren’t signed in, or have no box, we add only to the anonymous counts.</li>
		<li><b>Purrs.</b> We store your visitor key against the tile, so each visitor purrs once.</li>
		<li><b>Guestbook scribbles.</b> We store your drawing, the name you give and your visitor key. Scribbles are shown to everyone who visits the box.</li>
		<li><b>Joining a list.</b> If you leave your email on a box’s “subscribe” tile, we store it with your visitor key and show it only to that box’s owner, who can download it. The owner may get an email from us with your address when you join. The owner decides what to send you; ask them, or us, to take you off.</li>
	</ul>
	<p>Anonymous totals do not identify visitors. The request needed to serve the page is processed under our legitimate interest in running and understanding the use of the service (Art. 6 (1) (f) GDPR). Legal basis for visits by people with a box: our legitimate interest, and that of the box owners, in seeing which members of the community stop by, which you can object to at any time with the setting above (Art. 6 (1) (f) and Art. 21 GDPR). For interactions: providing the features you choose to use (Art. 6 (1) (b) GDPR).</p>

	<h3>Maps and music on a box</h3>
	<ul>
		<li><b>Maps.</b> If a box has a map tile, your browser loads the map pictures straight from OpenFreeMap, which sees your IP address.</li>
		<li><b>Spotify.</b> Music tiles show a cover only. Spotify’s player loads after you press Play, and from then on Spotify’s privacy policy applies.</li>
		<li><b>Links.</b> Following a link takes you to another site with its own privacy policy.</li>
	</ul>

	<h2>When you have a box</h2>
	<ul>
		<li><b>Your account.</b> Clerk handles sign-in. It keeps your email address and, if you use Google, the name and email Google shares. We keep a copy of your email and name so your box knows who owns it.</li>
		<li><b>Your box.</b> Everything you put in it: its address, name, bio, tiles, photos, videos and voice recordings. A box is public, so anyone with the link can see it, and it may appear on the Explore page. Uploaded files are stored with Convex and can be opened by anyone with their link.</li>
		<li><b>Link previews.</b> When you paste a link, our server fetches that page and keeps its title and a copy of its preview image and icon. If you add a GitHub tile, our server fetches the public contribution graph for that username from GitHub and refreshes it from time to time.</li>
		<li><b>Places.</b> When you search for a place for a map tile, what you type is sent to Photon, a search service run by komoot. If you choose to use your current location, your browser asks first, and the coordinates go to Photon to find the place’s name. We only keep the place you pick.</li>
		<li><b>Your microphone.</b> Only while you record a voice note, and only after your browser asks.</li>
		<li><b>Visit statistics.</b> The visit records described above, shown only to you.</li>
	</ul>
	<p>Legal basis: providing your box (Art. 6 (1) (b) GDPR).</p>

	<h2>Who else handles data for us</h2>
	<ul>
		<li><b>Clerk, Inc.</b> (USA): sign-in and account management.</li>
		<li><b>Convex, Inc.</b> (USA): database, file storage and server functions.</li>
		<li><b>Sendinblue SAS</b>, trading as Brevo (France): sends box owners an email when someone joins their list.</li>
		<li><b>Henrik Kramer e.K.</b>, trading as Prepaid-Hoster.de (Germany): hosts the website on servers in Frankfurt am Main.</li>
		<li><b>Google</b>: only if you choose “Continue with Google”.</li>
		<li><b>OpenFreeMap</b>: map pictures, loaded by your browser when a box shows a map.</li>
		<li><b>komoot GmbH</b> (Germany): place search in the editor.</li>
		<li><b>Spotify AB</b> (Sweden): only after you press Play on a music tile.</li>
	</ul>
	<p>Where a provider processes data on our behalf, we have a data processing agreement with them. Some providers are in the USA. Transfers there rely on the EU-U.S. Data Privacy Framework where the provider is certified, and on the EU Standard Contractual Clauses otherwise.</p>

	<h2>How long we keep things</h2>
	<ul>
		<li>Your account and box: until you delete your box.</li>
		<li>Anonymous page-view totals: until the box is deleted. Existing totals also include visits counted under the earlier opt-in system.</li>
		<li>Hourly page-view counts and visits by people with a box: 30 days, removed by an hourly cleanup job. Turning off “Show my box when I visit” deletes your box’s visits straight away. When a browser erases its old statistics key, we keep that key for 30 days as a marker that rejects late requests from other tabs.</li>
		<li>Purrs, scribbles and list sign-ups on a box: until the owner removes that tile (a day later, so an accidental removal can be undone) or deletes the box. Write to us if you want yours removed sooner.</li>
		<li>Removed or unused uploaded files: 24 hours, so you can undo an edit. Deleting your box queues deletion of its uploaded files without that waiting period.</li>
		<li>Server logs at our providers: usually a few days to a few weeks.</li>
	</ul>
	<p>Deleting your box removes the public page and our account copy immediately, then cleans up its uploaded files and visitor records in batches. Shared demo assets and files still used by another box are kept. We also request closure of your Clerk sign-in account. If that fails, the editor tells you, we record the failure and retry automatically. We keep a minimal deletion record containing the sign-in identifier and deletion status to prevent an old session from recreating the account and to finish any outstanding cleanup.</p>

	<h2>Your rights</h2>
	<p>You can ask us for a copy of the data we hold about you, have it corrected or deleted, restrict how we use it, or get it in a portable format. You can object to processing based on legitimate interest, and withdraw any consent you gave, at any time. The editor’s “Download your data” button gives you everything in your box straight away.</p>
	<p>Write to <a href="mailto:{O.email}">{O.email}</a>. You also have the right to complain to a data protection authority, for example the one where you live or the one responsible for us.</p>
	<p>We don’t make automated decisions about you, and we don’t build profiles.</p>

	<h2>Children</h2>
	<p>You need to be at least 16 to make a box. Visiting boxes is fine at any age.</p>

	<h2>Changes</h2>
	<p>If we change how we handle your data, we’ll update this page and the date at the top. If it’s a big change, we’ll tell box owners by email first.</p>
</LegalPage>
