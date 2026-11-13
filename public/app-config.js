// Where this page's game server lives, and the public address invite links use.
// On the website both are this page's own origin, so this file changes nothing.
// The iOS app (mobile/) ships its own copy of the page inside the app, so its
// build overwrites this file with the live server's address.
window.GN_SERVER = '';               // '' = same origin as this page
window.GN_PUBLIC = location.origin;  // where an invite link sends a friend
